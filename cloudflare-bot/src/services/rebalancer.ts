import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import DLMM, { StrategyType } from "@meteora-ag/dlmm";
import bs58 from "bs58";
import BN from "bn.js";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import {
  Env,
  RebalancerConfig,
  PositionState,
  RebalanceAction,
  BinDistribution,
} from "../types";
import { ValueTracker, createValueTracker } from "./valueTracker";
import logger from "../utils/logger";

/**
 * 安全地将 BN 或其他类型转换为数字
 */
function toNumber(value: any): number {
  if (!value) return 0;
  if (value instanceof BN) return value.toNumber();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.startsWith('0x')) return parseInt(value, 16);
    return parseFloat(value) || 0;
  }
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

/**
 * BidAskRebalancer - Cloudflare Workers 版本
 * 对标原版 bidAskRebalancer.ts
 */
export class BidAskRebalancer {
  private connection: Connection;
  private wallet: Keypair | null = null;
  private poolAddress: string;
  private dlmmPool: DLMM | null = null;
  private config: RebalancerConfig;
  private env: Env;
  private valueTracker: ValueTracker;
  private tokenXDecimals: number = 9;
  private tokenYDecimals: number = 6;

  constructor(env: Env, config: RebalancerConfig) {
    this.env = env;
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.poolAddress = config.poolAddress;
    this.valueTracker = createValueTracker(env);

    this.initializeWallet();
  }

  /**
   * 初始化钱包
   * 支持两种格式:
   * 1. Base58 编码的私钥 (88 字符左右)
   * 2. 助记词 (12/24 个单词，空格分隔)
   */
  private initializeWallet(): void {
    try {
      const keyInput = this.env.WALLET_PRIVATE_KEY;
      
      if (!keyInput) {
        logger.warn("未配置钱包私钥/助记词，将以只读模式运行");
        return;
      }

      const trimmedInput = keyInput.trim();
      
      // 检测是否为助记词 (包含空格的多个单词)
      if (trimmedInput.includes(' ')) {
        // 助记词模式
        logger.info("检测到助记词格式，正在派生密钥...");
        
        if (!bip39.validateMnemonic(trimmedInput)) {
          throw new Error("无效的助记词");
        }
        
        const seed = bip39.mnemonicToSeedSync(trimmedInput, '');
        const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
        this.wallet = Keypair.fromSeed(derivedSeed);
        logger.info(`钱包地址 (助记词派生): ${this.wallet.publicKey.toBase58()}`);
      } else {
        // Base58 私钥模式
        logger.info("检测到 Base58 私钥格式...");
        const secretKey = bs58.decode(trimmedInput);
        this.wallet = Keypair.fromSecretKey(secretKey);
        logger.info(`钱包地址: ${this.wallet.publicKey.toBase58()}`);
      }
    } catch (error) {
      logger.error("初始化钱包失败:", error);
      this.wallet = null;
    }
  }

  /**
   * 初始化 DLMM 池
   */
  async initialize(): Promise<void> {
    logger.info("正在初始化 DLMM 池...");
    const poolPubkey = new PublicKey(this.poolAddress);
    this.dlmmPool = await DLMM.create(this.connection, poolPubkey);

    this.tokenXDecimals = this.dlmmPool.tokenX.mint.decimals;
    this.tokenYDecimals = this.dlmmPool.tokenY.mint.decimals;

    logger.info(`Token X: ${this.dlmmPool.tokenX.publicKey.toBase58()} (精度: ${this.tokenXDecimals})`);
    logger.info(`Token Y: ${this.dlmmPool.tokenY.publicKey.toBase58()} (精度: ${this.tokenYDecimals})`);
    logger.info(`Bin Step: ${this.dlmmPool.lbPair.binStep}`);
    logger.info("初始化完成");
  }

  /**
   * 获取当前所有仓位状态
   */
  async getPositions(): Promise<PositionState[]> {
    if (!this.dlmmPool) throw new Error("DLMM 池未初始化");
    if (!this.wallet) throw new Error("钱包未初始化");

    await this.dlmmPool.refetchStates();

    const { userPositions, activeBin } = await this.dlmmPool.getPositionsByUserAndLbPair(
      this.wallet.publicKey
    );

    if (this.config.verbose) {
      logger.info(`当前活跃 Bin ID: ${activeBin.binId}, 价格: ${activeBin.pricePerToken}`);
    }

    const positions: PositionState[] = [];

    for (const pos of userPositions) {
      const posData = pos.positionData;
      const binData = posData.positionBinData;

      let totalX = 0;
      let totalY = 0;
      const binDistribution: BinDistribution[] = [];

      binData.forEach(bin => {
        const xAmount = typeof bin.positionXAmount === 'string'
          ? parseFloat(bin.positionXAmount)
          : bin.positionXAmount;
        const yAmount = typeof bin.positionYAmount === 'string'
          ? parseFloat(bin.positionYAmount)
          : bin.positionYAmount;

        const pricePerLamport = typeof bin.price === 'string'
          ? parseFloat(bin.price)
          : bin.price;
        const price = parseFloat(this.dlmmPool!.fromPricePerLamport(pricePerLamport));

        totalX += xAmount;
        totalY += yAmount;

        binDistribution.push({
          binId: bin.binId,
          price,
          xAmount,
          yAmount,
        });
      });

      binDistribution.sort((a, b) => a.price - b.price);

      const feeX = typeof posData.feeX === 'string'
        ? parseFloat(posData.feeX)
        : (posData.feeX?.toNumber?.() ?? posData.feeX ?? 0);
      const feeY = typeof posData.feeY === 'string'
        ? parseFloat(posData.feeY)
        : (posData.feeY?.toNumber?.() ?? posData.feeY ?? 0);

      positions.push({
        publicKey: pos.publicKey.toBase58(),
        lowerBinId: toNumber(posData.lowerBinId),
        upperBinId: toNumber(posData.upperBinId),
        totalXAmount: totalX,
        totalYAmount: totalY,
        binCount: binData.length,
        binDistribution,
        feeX,
        feeY,
      });
    }

    return positions;
  }

  /**
   * 判断分布是否为递增（价格越高数量越多）
   */
  private isAscendingDistribution(distribution: BinDistribution[], token: 'x' | 'y'): boolean {
    if (distribution.length < 2) return false;

    const midIndex = Math.floor(distribution.length / 2);
    const firstHalf = distribution.slice(0, midIndex);
    const secondHalf = distribution.slice(midIndex);

    const getAmount = (bin: BinDistribution) => token === 'x' ? bin.xAmount : bin.yAmount;

    const firstHalfAvg = firstHalf.reduce((sum, bin) => sum + getAmount(bin), 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, bin) => sum + getAmount(bin), 0) / secondHalf.length;

    return secondHalfAvg > firstHalfAvg * 1.1;
  }

  /**
   * 判断分布是否为递减（价格越高数量越少）
   */
  private isDescendingDistribution(distribution: BinDistribution[], token: 'x' | 'y'): boolean {
    if (distribution.length < 2) return false;

    const midIndex = Math.floor(distribution.length / 2);
    const firstHalf = distribution.slice(0, midIndex);
    const secondHalf = distribution.slice(midIndex);

    const getAmount = (bin: BinDistribution) => token === 'x' ? bin.xAmount : bin.yAmount;

    const firstHalfAvg = firstHalf.reduce((sum, bin) => sum + getAmount(bin), 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, bin) => sum + getAmount(bin), 0) / secondHalf.length;

    return firstHalfAvg > secondHalfAvg * 1.1;
  }

  /**
   * 检查仓位是否需要重新平衡
   */
  checkRebalanceNeeded(position: PositionState): RebalanceAction | null {
    const { totalXAmount, totalYAmount, binDistribution } = position;
    const positionId = position.publicKey.slice(0, 8);

    // 情况1：价格上穿区间，全部变成 USDC（X=0）
    if (totalXAmount === 0 && totalYAmount > 0) {
      const isAskResult = this.isAscendingDistribution(binDistribution, 'y');

      if (isAskResult) {
        logger.info(`仓位 ${positionId}... 价格上穿，USDC 分布递增（Ask 结果），需要重新部署 Bid 策略`);
        return {
          position,
          action: "bid",
          amount: Math.floor(totalYAmount),
        };
      } else {
        if (this.config.verbose) {
          logger.info(`仓位 ${positionId}... 价格上穿，但 USDC 分布已是递减（Bid 策略），无需调整`);
        }
        return null;
      }
    }

    // 情况2：价格下穿区间，全部变成 SOL（Y=0）
    if (totalYAmount === 0 && totalXAmount > 0) {
      const isBidResult = this.isDescendingDistribution(binDistribution, 'x');

      if (isBidResult) {
        logger.info(`仓位 ${positionId}... 价格下穿，SOL 分布递减（Bid 结果），需要重新部署 Ask 策略`);
        return {
          position,
          action: "ask",
          amount: Math.floor(totalXAmount),
        };
      } else {
        if (this.config.verbose) {
          logger.info(`仓位 ${positionId}... 价格下穿，但 SOL 分布已是递增（Ask 策略），无需调整`);
        }
        return null;
      }
    }

    return null;
  }

  /**
   * 执行重新平衡
   */
  async executeRebalance(action: RebalanceAction): Promise<boolean> {
    if (!this.dlmmPool) throw new Error("DLMM 池未初始化");
    if (!this.wallet) throw new Error("钱包未初始化");

    const { position, action: actionType, amount } = action;
    const positionKey = new PublicKey(position.publicKey);

    logger.info(`开始执行 ${actionType.toUpperCase()} 重新平衡...`);
    logger.info(`仓位: ${position.publicKey}`);
    logger.info(`Bin 范围: ${position.lowerBinId} → ${position.upperBinId}`);

    try {
      // Step 1: 移除所有流动性
      logger.info("Step 1: 移除流动性...");

      const { userPositions } = await this.dlmmPool.getPositionsByUserAndLbPair(
        this.wallet.publicKey
      );

      const userPosition = userPositions.find(p =>
        p.publicKey.toBase58() === position.publicKey
      );

      if (!userPosition) {
        logger.error("未找到仓位");
        return false;
      }

      const binIdsToRemove = userPosition.positionData.positionBinData.map(bin => bin.binId);

      if (binIdsToRemove.length === 0) {
        logger.warn("仓位中没有流动性");
        return false;
      }

      const removeLiquidityTx = await this.dlmmPool.removeLiquidity({
        position: positionKey,
        user: this.wallet.publicKey,
        fromBinId: Math.min(...binIdsToRemove),
        toBinId: Math.max(...binIdsToRemove),
        bps: new BN(100 * 100),
        shouldClaimAndClose: false,
      });

      const removeTxs = Array.isArray(removeLiquidityTx) ? removeLiquidityTx : [removeLiquidityTx];

      for (const tx of removeTxs) {
        this.addPriorityFee(tx);
        const sig = await this.sendTransaction(tx);
        logger.info(`移除流动性交易: ${sig}`);
      }

      // 等待状态更新
      await this.sleep(3000);
      await this.dlmmPool.refetchStates();

      // Step 2: 使用 Bid-Ask 策略重新添加流动性
      logger.info(`Step 2: 使用 ${actionType.toUpperCase()} 策略重新添加流动性...`);

      let totalXAmount: BN;
      let totalYAmount: BN;

      if (actionType === "bid") {
        totalXAmount = new BN(0);
        totalYAmount = new BN(amount);
        logger.info(`添加 USDC: ${amount / 1e6} USDC`);
      } else {
        totalXAmount = new BN(amount);
        totalYAmount = new BN(0);
        logger.info(`添加 SOL: ${amount / 1e9} SOL`);
      }

      const addLiquidityTx = await this.dlmmPool.addLiquidityByStrategy({
        positionPubKey: positionKey,
        user: this.wallet.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: {
          minBinId: position.lowerBinId,
          maxBinId: position.upperBinId,
          strategyType: StrategyType.BidAsk,
        },
      });

      const addTxs = Array.isArray(addLiquidityTx) ? addLiquidityTx : [addLiquidityTx];

      for (const tx of addTxs) {
        this.addPriorityFee(tx);
        const sig = await this.sendTransaction(tx);
        logger.info(`添加流动性交易: ${sig}`);
      }

      logger.info(`重新平衡完成！`);
      return true;

    } catch (error) {
      logger.error(`重新平衡失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 添加优先费
   */
  private addPriorityFee(tx: Transaction): Transaction {
    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: this.config.priorityFee,
    });
    tx.instructions.unshift(priorityFeeIx);
    return tx;
  }

  /**
   * 发送交易
   */
  private async sendTransaction(tx: Transaction): Promise<string> {
    if (!this.wallet) throw new Error("钱包未初始化");

    const latestBlockhash = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latestBlockhash.blockhash;
    tx.feePayer = this.wallet.publicKey;
    tx.sign(this.wallet);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    await this.connection.confirmTransaction(signature, "confirmed");
    return signature;
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 单次检查和执行
   */
  async checkAndRebalance(): Promise<{
    checked: number;
    rebalanced: number;
    totalValueUSD: number;
    currentPrice: number;
  }> {
    logger.info("─".repeat(60));
    logger.info("开始检查仓位...");

    await this.initialize();

    const positions = await this.getPositions();
    logger.info(`找到 ${positions.length} 个仓位`);

    // 获取当前价格
    const activeBin = await this.dlmmPool!.getActiveBin();
    const currentPrice = parseFloat(activeBin.pricePerToken);

    // 记录快照
    const snapshotPositions = positions.map(p => ({
      publicKey: p.publicKey,
      binDistribution: p.binDistribution,
      lowerBinId: p.lowerBinId,
      upperBinId: p.upperBinId,
      totalXAmount: p.totalXAmount,
      totalYAmount: p.totalYAmount,
      feeX: p.feeX,
      feeY: p.feeY,
    }));

    const snapshot = await this.valueTracker.takeSnapshot(
      snapshotPositions,
      currentPrice,
      this.tokenXDecimals,
      this.tokenYDecimals
    );

    logger.info(`📊 当前总价值: $${snapshot.totalValueUSD.toFixed(2)} | 价格: $${currentPrice.toFixed(4)}`);

    let rebalanceCount = 0;

    for (const position of positions) {
      const action = this.checkRebalanceNeeded(position);

      if (action) {
        rebalanceCount++;

        const beforeValue = this.valueTracker.calculatePositionValue(
          position.binDistribution,
          this.tokenXDecimals,
          this.tokenYDecimals
        ).totalValueUSD;

        const success = await this.executeRebalance(action);

        if (success) {
          const updatedPositions = await this.getPositions();
          const updatedPos = updatedPositions.find(
            p => p.publicKey === position.publicKey
          );

          const afterValue = updatedPos
            ? this.valueTracker.calculatePositionValue(
                updatedPos.binDistribution,
                this.tokenXDecimals,
                this.tokenYDecimals
              ).totalValueUSD
            : beforeValue;

          await this.valueTracker.recordOperation(
            position.publicKey,
            action.action,
            beforeValue,
            afterValue,
            action.amount
          );
        } else {
          logger.warn(`仓位 ${position.publicKey.slice(0, 8)}... 重新平衡失败`);
        }

        await this.sleep(1000);
      } else {
        if (this.config.verbose) {
          const xAmount = (position.totalXAmount / 1e9).toFixed(4);
          const yAmount = (position.totalYAmount / 1e6).toFixed(2);
          logger.info(`仓位 ${position.publicKey.slice(0, 8)}... 无需调整 (SOL: ${xAmount}, USDC: ${yAmount})`);
        }
      }
    }

    if (rebalanceCount === 0) {
      logger.info("所有仓位状态正常，无需调整");
    } else {
      logger.info(`本轮完成 ${rebalanceCount} 个仓位的重新平衡`);
    }

    // 显示汇总信息
    const summary = await this.valueTracker.getSummary();
    if (summary.todayPnL !== 0) {
      const pnlSign = summary.todayPnL >= 0 ? '+' : '';
      logger.info(`📈 今日 PnL: ${pnlSign}$${summary.todayPnL.toFixed(2)} (${pnlSign}${summary.todayPnLPercent.toFixed(2)}%)`);
    }

    return {
      checked: positions.length,
      rebalanced: rebalanceCount,
      totalValueUSD: snapshot.totalValueUSD,
      currentPrice,
    };
  }

  /**
   * 检查并领取手续费
   */
  async checkAndClaimFees(): Promise<{ claimed: number; totalUSD: number }> {
    if (!this.config.claimFeeEnabled) {
      return { claimed: 0, totalUSD: 0 };
    }

    logger.info("💰 检查未领取手续费...");

    if (!this.dlmmPool) {
      await this.initialize();
    }

    if (!this.wallet) {
      logger.warn("钱包未初始化，无法领取手续费");
      return { claimed: 0, totalUSD: 0 };
    }

    const positions = await this.getPositions();
    const activeBin = await this.dlmmPool!.getActiveBin();
    const currentPrice = parseFloat(activeBin.pricePerToken);

    // 计算所有仓位的总手续费
    let totalFeeX = 0;
    let totalFeeY = 0;
    for (const position of positions) {
      totalFeeX += position.feeX;
      totalFeeY += position.feeY;
    }

    const totalFeeXUSD = (totalFeeX / Math.pow(10, this.tokenXDecimals)) * currentPrice;
    const totalFeeYUSD = totalFeeY / Math.pow(10, this.tokenYDecimals);
    const totalFeeUSD = totalFeeXUSD + totalFeeYUSD;

    logger.info(`总未领取手续费: $${totalFeeUSD.toFixed(4)}`);

    if (totalFeeUSD < this.config.claimFeeThresholdUSD) {
      logger.info(`总手续费 $${totalFeeUSD.toFixed(4)} 未达阈值 $${this.config.claimFeeThresholdUSD}，跳过领取`);
      return { claimed: 0, totalUSD: totalFeeUSD };
    }

    logger.info(`开始领取所有仓位手续费...`);

    const { userPositions } = await this.dlmmPool!.getPositionsByUserAndLbPair(this.wallet.publicKey);
    let claimedCount = 0;

    for (const position of positions) {
      const posFeeXUSD = (position.feeX / Math.pow(10, this.tokenXDecimals)) * currentPrice;
      const posFeeYUSD = position.feeY / Math.pow(10, this.tokenYDecimals);
      const posFeeUSD = posFeeXUSD + posFeeYUSD;

      if (posFeeUSD < this.config.claimFeeMinPositionUSD) {
        continue;
      }

      const lbPosition = userPositions.find(p => p.publicKey.toBase58() === position.publicKey);

      if (!lbPosition) {
        continue;
      }

      logger.info(`领取仓位 ${position.publicKey.slice(0, 8)}... 手续费 $${posFeeUSD.toFixed(4)}`);

      try {
        const claimTx = await this.dlmmPool!.claimSwapFee({
          owner: this.wallet.publicKey,
          position: lbPosition,
        });

        const claimTxs = Array.isArray(claimTx) ? claimTx : [claimTx];
        let lastSig = '';

        for (const tx of claimTxs) {
          this.addPriorityFee(tx);
          const sig = await this.sendTransaction(tx);
          lastSig = sig;
          logger.info(`✅ 手续费领取交易: ${sig}`);
        }

        await this.valueTracker.recordClaimedFee(
          position.publicKey,
          lastSig,
          position.feeX,
          position.feeY,
          currentPrice,
          this.tokenXDecimals,
          this.tokenYDecimals
        );

        claimedCount++;

      } catch (claimError) {
        logger.error(`领取手续费失败: ${claimError instanceof Error ? claimError.message : String(claimError)}`);
      }

      await this.sleep(2000);
    }

    logger.info(`✅ 手续费领取完成，共领取 ${claimedCount} 个仓位`);

    return { claimed: claimedCount, totalUSD: totalFeeUSD };
  }

  /**
   * 获取 ValueTracker 实例
   */
  getValueTracker(): ValueTracker {
    return this.valueTracker;
  }
}

/**
 * 创建 BidAskRebalancer 实例
 */
export function createRebalancer(env: Env, config: RebalancerConfig): BidAskRebalancer {
  return new BidAskRebalancer(env, config);
}
