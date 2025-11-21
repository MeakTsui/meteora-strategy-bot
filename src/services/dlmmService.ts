import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import DLMM, { StrategyType } from "@meteora-ag/dlmm";
import BN from "bn.js";
import bs58 from "bs58";
import Decimal from "decimal.js";
import { PriceRange, PositionSide, ActivePosition } from "../types";
import { rpcConfig, walletConfig, config as botConfig } from "../config/config";
import logger from "../utils/logger";
import { formatTokenBalance, toRawAmount, generateId } from "../utils/helpers";

const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;

// Token mint 地址
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * DLMMService —— 封装与 Meteora DLMM 协议交互的所有逻辑
 */
export class DLMMService {
  private connection: Connection;
  private wallet: Keypair | null = null;

  constructor() {
    this.connection = new Connection(rpcConfig.url, "confirmed");
    this.initializeWallet();
  }

  /**
   * 使用私钥初始化钱包
   */
  private initializeWallet(): void {
    if (botConfig.enableDryRun) {
      logger.info("Dry run mode enabled, wallet not initialized");
      return;
    }

    try {
      if (!walletConfig.privateKey) {
        throw new Error("未配置钱包私钥 (WALLET_PRIVATE_KEY)");
      }
      const secretKey = bs58.decode(walletConfig.privateKey);
      this.wallet = Keypair.fromSecretKey(secretKey);
      logger.info(`Wallet initialized: ${this.wallet.publicKey.toBase58()}`);
    } catch (error) {
      logger.error("Failed to initialize wallet:", error);
      throw error;
    }
  }

  /**
   * 根据池地址获取 DLMM 池实例
   */
  async getDLMMPool(poolAddress: string): Promise<DLMM> {
    try {
      const poolPubkey = new PublicKey(poolAddress);
      const dlmmPool = await DLMM.create(this.connection, poolPubkey);
      return dlmmPool;
    } catch (error) {
      logger.error(`Failed to get DLMM pool ${poolAddress}:`, error);
      throw error;
    }
  }

  /**
   * 创建新的 LP 仓位（根据价格区间和方向）
   * @param poolAddress DLMM 池地址
   * @param range       价格区间
   * @param side        仓位方向（SOL_ONLY / USDC_ONLY / BALANCED）
   * @param amount      分配的 USD 金额
   * @returns 实际模式返回交易签名；Dry Run 模式下返回编码后的交易
   */
  async createPosition(
    poolAddress: string,
    range: PriceRange,
    side: PositionSide,
    amount: number
  ): Promise<{ signature?: string; encodedTx?: string }> {
    try {
      if (!this.wallet && !botConfig.enableDryRun) {
        throw new Error("钱包尚未初始化，无法发送真实交易");
      }

      const dlmmPool = await this.getDLMMPool(poolAddress);
      const activeBin = await dlmmPool.getActiveBin();

      // 根据区间价格计算对应的 binId 范围
      const minBinId = this.priceToBinId(
        range.lower,
        dlmmPool.lbPair.binStep,
        SOL_DECIMALS,
        USDC_DECIMALS
      );
      const maxBinId = this.priceToBinId(
        range.upper,
        dlmmPool.lbPair.binStep,
        SOL_DECIMALS,
        USDC_DECIMALS
      );

      // 根据仓位方向 (side) 计算各 Token 投入数量
      let totalXAmount: BN;
      let totalYAmount: BN;

      if (side === PositionSide.SOL_ONLY) {
        // amount 单位为 USD，这里按区间下沿价格大致换算成 SOL 数量
        const solAmount = amount / range.lower; // Approximate SOL amount
        totalXAmount = new BN(solAmount * LAMPORTS_PER_SOL);
        totalYAmount = new BN(0);
      } else if (side === PositionSide.USDC_ONLY) {
        totalXAmount = new BN(0);
        totalYAmount = new BN(amount * Math.pow(10, USDC_DECIMALS));
      } else {
        // BALANCED：一半资金做 SOL，一半资金保持 USDC
        const solAmount = (amount / 2) / range.lower;
        totalXAmount = new BN(solAmount * LAMPORTS_PER_SOL);
        totalYAmount = new BN((amount / 2) * Math.pow(10, USDC_DECIMALS));
      }

      // 根据仓位方向选择 DLMM 内置策略类型
      // Meteora SDK 的 StrategyType: Spot, Curve, BidAsk
      // 对于所有单边和平衡仓位，使用 Spot 策略
      const strategyType = StrategyType.Spot;

      const positionKeypair = Keypair.generate();
      const userPubkey = this.wallet
        ? this.wallet.publicKey
        : Keypair.generate().publicKey;

      const createPositionTx =
        await dlmmPool.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: positionKeypair.publicKey,
          user: userPubkey,
          totalXAmount,
          totalYAmount,
          strategy: {
            minBinId,
            maxBinId,
            strategyType,
          },
        });

      // 构建 VersionedTransaction 交易
      const latestBlockhash = await this.connection.getLatestBlockhash(
        "confirmed"
      );
      const messageV0 = new TransactionMessage({
        payerKey: userPubkey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: createPositionTx.instructions,
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(messageV0);
      versionedTx.sign([positionKeypair]);

      if (botConfig.enableDryRun) {
        const encodedTx = bs58.encode(versionedTx.serialize());
        logger.info(`[DRY RUN] Position creation transaction prepared`);
        logger.info(`Range: ${range.lower}-${range.upper}, Side: ${side}`);
        logger.info(`Amount: $${amount}`);
        return { encodedTx };
      }

      if (!this.wallet) {
        throw new Error("发送真实交易时需要已初始化的钱包实例");
      }

      versionedTx.sign([this.wallet]);

      const signature = await this.connection.sendTransaction(versionedTx);
      await this.connection.confirmTransaction(signature, "confirmed");

      logger.info(`Position created: ${signature}`);
      return { signature };
    } catch (error) {
      logger.error("创建仓位失败:", error);
      throw error;
    }
  }

  /**
   * 撤出并关闭指定仓位
   */
  async withdrawPosition(
    poolAddress: string,
    positionPubkey: PublicKey
  ): Promise<{ signature?: string; encodedTx?: string }> {
    try {
      if (!this.wallet && !botConfig.enableDryRun) {
        throw new Error("Wallet not initialized");
      }

      const dlmmPool = await this.getDLMMPool(poolAddress);
      const userPubkey = this.wallet
        ? this.wallet.publicKey
        : Keypair.generate().publicKey;

      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
        userPubkey
      );
      const position = userPositions.find(
        (p) => p.publicKey.toBase58() === positionPubkey.toBase58()
      );

      if (!position) {
        throw new Error("未找到指定的仓位");
      }

      const binIdsToRemove = position.positionData.positionBinData.map(
        (bin) => bin.binId
      );

      const removeLiquidityTx = await dlmmPool.removeLiquidity({
        position: positionPubkey,
        user: userPubkey,
        fromBinId: Math.min(...binIdsToRemove),
        toBinId: Math.max(...binIdsToRemove),
        bps: new BN(100 * 100), // 100%
        shouldClaimAndClose: true,
      });

      const transactions = Array.isArray(removeLiquidityTx)
        ? removeLiquidityTx
        : [removeLiquidityTx];

      const latestBlockhash = await this.connection.getLatestBlockhash(
        "confirmed"
      );

      for (const tx of transactions) {
        const messageV0 = new TransactionMessage({
          payerKey: userPubkey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: tx.instructions,
        }).compileToV0Message();

        const versionedTx = new VersionedTransaction(messageV0);

        if (botConfig.enableDryRun) {
          const encodedTx = bs58.encode(versionedTx.serialize());
          logger.info(`[DRY RUN] Position withdrawal transaction prepared`);
          return { encodedTx };
        }

        if (!this.wallet) {
          throw new Error("发送真实交易时需要已初始化的钱包实例");
        }

        versionedTx.sign([this.wallet]);
        const signature = await this.connection.sendTransaction(versionedTx);
        await this.connection.confirmTransaction(signature, "confirmed");

        logger.info(`Position withdrawn: ${signature}`);
        return { signature };
      }

      return {};
    } catch (error) {
      logger.error("撤出仓位失败:", error);
      throw error;
    }
  }

  /**
   * 模拟创建仓位（仅用于预估收益，不发送真实交易）
   */
  async simulate(
    poolAddress: string,
    range: PriceRange,
    side: PositionSide,
    amount: number,
    currentPrice: number
  ): Promise<{
    estimatedAPR: number;
    estimatedDailyYield: number;
    liquidityValue: number;
  }> {
    try {
      // 这里是一个非常简化的收益估算逻辑
      // 生产环境下建议使用真实池子数据进行更精细的计算
      const rangeWidth = range.upper - range.lower;
      const priceInRange = currentPrice >= range.lower && currentPrice <= range.upper;

      // 根据区间宽度和价格位置，粗略估算 APR
      let baseAPR = 20; // 基础假设 APR
      if (priceInRange) {
        baseAPR += 10; // Bonus for in-range position
      }
      if (rangeWidth < 10) {
        baseAPR += 15; // Bonus for tight range
      }

      const estimatedAPR = baseAPR;
      const estimatedDailyYield = (amount * estimatedAPR) / 100 / 365;
      const liquidityValue = amount;

      return {
        estimatedAPR,
        estimatedDailyYield,
        liquidityValue,
      };
    } catch (error) {
      logger.error("收益模拟失败:", error);
      throw error;
    }
  }

  /**
   * 将价格转换为对应的 binId
   */
  private priceToBinId(
    price: number,
    binStep: number,
    tokenXDecimals: number,
    tokenYDecimals: number
  ): number {
    const BASIS_POINT_MAX = 10000;
    const binStepNum = binStep / BASIS_POINT_MAX;
    const base = 1 + binStepNum;
    const adjustedPrice =
      price / Math.pow(10, tokenXDecimals - tokenYDecimals);
    const binId = Math.floor(Math.log(adjustedPrice) / Math.log(base));
    return binId;
  }

  /**
   * 获取默认的 SOL-USDC 池地址
   * 实际生产环境中建议通过配置或 Meteora API 动态获取
   */
  getDefaultPoolAddress(): string {
    // 这里使用的是占位示例地址，实际使用前请替换为真实 DLMM 池地址
    // 可以通过 Meteora 官方 API 查询可用池列表
    return "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
  }
}

// Export singleton instance
export const dlmmService = new DLMMService();
