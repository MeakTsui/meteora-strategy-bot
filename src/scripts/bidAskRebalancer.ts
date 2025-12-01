import { Connection, PublicKey, Keypair, sendAndConfirmTransaction, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import DLMM, { StrategyType } from "@meteora-ag/dlmm";
import bs58 from "bs58";
import dotenv from "dotenv";
import BN from "bn.js";
import { getValueTracker, ValueTracker } from "../services/valueTracker";

dotenv.config();

// ============================================================================
// 配置
// ============================================================================
const CONFIG = {
  // 监控频率（毫秒）
  MONITOR_INTERVAL_MS: parseInt(process.env.MONITOR_INTERVAL_MS || "30000"),
  
  // RPC 配置
  RPC_URL: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  
  // 优先费（microLamports）- 设置较低以节省 gas
  PRIORITY_FEE: parseInt(process.env.PRIORITY_FEE || "1000"),
  
  // 是否启用详细日志
  VERBOSE: process.env.VERBOSE === "true",
};

// ============================================================================
// 类型定义
// ============================================================================
interface BinDistribution {
  binId: number;
  price: number;
  xAmount: number;
  yAmount: number;
}

interface PositionState {
  publicKey: PublicKey;
  lowerBinId: number;
  upperBinId: number;
  totalXAmount: number;  // SOL (原始值)
  totalYAmount: number;  // USDC (原始值)
  binCount: number;
  binDistribution: BinDistribution[];  // 各 bin 的分布数据
  lastAction?: "bid" | "ask";
  // 未领取手续费
  feeX: number;          // 未领取 SOL 手续费（原始值）
  feeY: number;          // 未领取 USDC 手续费（原始值）
}

interface RebalanceAction {
  position: PositionState;
  action: "bid" | "ask";  // bid = 用 USDC 买入, ask = 用 SOL 卖出
  amount: BN;
}

// ============================================================================
// 工具函数
// ============================================================================

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
 * 格式化时间戳
 */
function formatTime(): string {
  return new Date().toLocaleString('zh-CN', { 
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * 日志输出
 */
function log(message: string, level: "info" | "warn" | "error" | "success" = "info") {
  const icons = {
    info: "ℹ️",
    warn: "⚠️",
    error: "❌",
    success: "✅"
  };
  console.log(`[${formatTime()}] ${icons[level]} ${message}`);
}

/**
 * 从私钥或助记词创建钱包
 */
function createWalletFromSecret(secret: string): Keypair {
  const trimmedSecret = secret.trim();
  
  if (trimmedSecret.includes(" ")) {
    const bip39 = require("bip39");
    const { derivePath } = require("ed25519-hd-key");
    
    if (!bip39.validateMnemonic(trimmedSecret)) {
      throw new Error("无效的助记词");
    }
    
    const seed = bip39.mnemonicToSeedSync(trimmedSecret, "");
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString("hex")).key;
    return Keypair.fromSeed(derivedSeed);
  } else {
    const secretKey = bs58.decode(trimmedSecret);
    return Keypair.fromSecretKey(secretKey);
  }
}

/**
 * 添加优先费指令
 */
function addPriorityFee(tx: Transaction): Transaction {
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: CONFIG.PRIORITY_FEE,
  });
  tx.instructions.unshift(priorityFeeIx);
  return tx;
}

// ============================================================================
// 核心逻辑
// ============================================================================

class BidAskRebalancer {
  private connection: Connection;
  private wallet: Keypair;
  private poolAddress: string;
  private dlmmPool: DLMM | null = null;
  private isRunning = false;
  private positionStates: Map<string, PositionState> = new Map();
  private valueTracker: ValueTracker;
  private tokenXDecimals: number = 9;
  private tokenYDecimals: number = 6;

  constructor(poolAddress: string) {
    this.connection = new Connection(CONFIG.RPC_URL, "confirmed");
    
    const walletSecret = process.env.WALLET_PRIVATE_KEY || process.env.WALLET_MNEMONIC;
    if (!walletSecret) {
      throw new Error("请在 .env 文件中配置 WALLET_PRIVATE_KEY 或 WALLET_MNEMONIC");
    }
    
    this.wallet = createWalletFromSecret(walletSecret);
    this.poolAddress = poolAddress;
    this.valueTracker = getValueTracker();
    
    log(`钱包地址: ${this.wallet.publicKey.toBase58()}`);
    log(`池地址: ${poolAddress}`);
    log(`监控间隔: ${CONFIG.MONITOR_INTERVAL_MS / 1000} 秒`);
  }

  /**
   * 初始化 DLMM 池实例
   */
  async initialize(): Promise<void> {
    log("正在初始化 DLMM 池...");
    const poolPubkey = new PublicKey(this.poolAddress);
    this.dlmmPool = await DLMM.create(this.connection, poolPubkey);
    
    this.tokenXDecimals = this.dlmmPool.tokenX.mint.decimals;
    this.tokenYDecimals = this.dlmmPool.tokenY.mint.decimals;
    
    log(`Token X: ${this.dlmmPool.tokenX.publicKey.toBase58()} (精度: ${this.tokenXDecimals})`);
    log(`Token Y: ${this.dlmmPool.tokenY.publicKey.toBase58()} (精度: ${this.tokenYDecimals})`);
    log(`Bin Step: ${this.dlmmPool.lbPair.binStep}`);
    log("初始化完成", "success");
  }

  /**
   * 获取当前所有仓位状态
   */
  async getPositions(): Promise<PositionState[]> {
    if (!this.dlmmPool) throw new Error("DLMM 池未初始化");
    
    await this.dlmmPool.refetchStates();
    
    const { userPositions, activeBin } = await this.dlmmPool.getPositionsByUserAndLbPair(
      this.wallet.publicKey
    );

    if (CONFIG.VERBOSE) {
      log(`当前活跃 Bin ID: ${activeBin.binId}, 价格: ${activeBin.pricePerToken}`);
    }

    const positions: PositionState[] = [];

    for (const pos of userPositions) {
      const posData = pos.positionData;
      const binData = posData.positionBinData;
      
      // 计算总量和收集分布数据
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
        
        // bin.price 是 price per lamport，需要转换为真实价格
        const pricePerLamport = typeof bin.price === 'string'
          ? parseFloat(bin.price)
          : bin.price;
        // 使用 SDK 的 fromPricePerLamport 方法转换为真实价格
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

      // 按价格排序（从低到高）
      binDistribution.sort((a, b) => a.price - b.price);

      // 获取未领取手续费
      const feeX = typeof posData.feeX === 'string' 
        ? parseFloat(posData.feeX) 
        : (posData.feeX?.toNumber?.() ?? posData.feeX ?? 0);
      const feeY = typeof posData.feeY === 'string' 
        ? parseFloat(posData.feeY) 
        : (posData.feeY?.toNumber?.() ?? posData.feeY ?? 0);

      positions.push({
        publicKey: pos.publicKey,
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
   * 用于判断是否为 Ask 策略分布
   */
  private isAscendingDistribution(distribution: BinDistribution[], token: 'x' | 'y'): boolean {
    if (distribution.length < 2) return false;
    
    // 取前半部分和后半部分的平均值比较
    const midIndex = Math.floor(distribution.length / 2);
    const firstHalf = distribution.slice(0, midIndex);
    const secondHalf = distribution.slice(midIndex);
    
    const getAmount = (bin: BinDistribution) => token === 'x' ? bin.xAmount : bin.yAmount;
    
    const firstHalfAvg = firstHalf.reduce((sum, bin) => sum + getAmount(bin), 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, bin) => sum + getAmount(bin), 0) / secondHalf.length;
    
    // 后半部分（高价）平均值 > 前半部分（低价）平均值 = 递增
    return secondHalfAvg > firstHalfAvg * 1.1; // 加 10% 容差
  }

  /**
   * 判断分布是否为递减（价格越高数量越少）
   * 用于判断是否为 Bid 策略分布
   */
  private isDescendingDistribution(distribution: BinDistribution[], token: 'x' | 'y'): boolean {
    if (distribution.length < 2) return false;
    
    const midIndex = Math.floor(distribution.length / 2);
    const firstHalf = distribution.slice(0, midIndex);
    const secondHalf = distribution.slice(midIndex);
    
    const getAmount = (bin: BinDistribution) => token === 'x' ? bin.xAmount : bin.yAmount;
    
    const firstHalfAvg = firstHalf.reduce((sum, bin) => sum + getAmount(bin), 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, bin) => sum + getAmount(bin), 0) / secondHalf.length;
    
    // 前半部分（低价）平均值 > 后半部分（高价）平均值 = 递减
    return firstHalfAvg > secondHalfAvg * 1.1; // 加 10% 容差
  }

  /**
   * 检查仓位是否需要重新平衡
   * 
   * 触发条件：
   * 1. 价格上穿区间（X=0, 全是 USDC）且 Y 分布是递增的（高价多）→ 需要调整为 Bid（低价多）
   * 2. 价格下穿区间（Y=0, 全是 SOL）且 X 分布是递减的（低价多）→ 需要调整为 Ask（高价多）
   */
  checkRebalanceNeeded(position: PositionState): RebalanceAction | null {
    const { totalXAmount, totalYAmount, publicKey, binDistribution } = position;
    const positionId = publicKey.toBase58().slice(0, 8);
    
    // 情况1：价格上穿区间，全部变成 USDC（X=0）
    if (totalXAmount === 0 && totalYAmount > 0) {
      // 检查 Y 的分布是否为递增（Ask 策略的结果：高价卖得多）
      const isAskResult = this.isAscendingDistribution(binDistribution, 'y');
      
      if (isAskResult) {
        log(`仓位 ${positionId}... 价格上穿，USDC 分布递增（Ask 结果），需要重新部署 Bid 策略`);
        return {
          position,
          action: "bid",
          amount: new BN(Math.floor(totalYAmount)),
        };
      } else {
        if (CONFIG.VERBOSE) {
          log(`仓位 ${positionId}... 价格上穿，但 USDC 分布已是递减（Bid 策略），无需调整`);
        }
        return null;
      }
    }
    
    // 情况2：价格下穿区间，全部变成 SOL（Y=0）
    if (totalYAmount === 0 && totalXAmount > 0) {
      // 检查 X 的分布是否为递减（Bid 策略的结果：低价买得多）
      const isBidResult = this.isDescendingDistribution(binDistribution, 'x');
      
      if (isBidResult) {
        log(`仓位 ${positionId}... 价格下穿，SOL 分布递减（Bid 结果），需要重新部署 Ask 策略`);
        return {
          position,
          action: "ask",
          amount: new BN(Math.floor(totalXAmount)),
        };
      } else {
        if (CONFIG.VERBOSE) {
          log(`仓位 ${positionId}... 价格下穿，但 SOL 分布已是递增（Ask 策略），无需调整`);
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

    const { position, action: actionType, amount } = action;
    const positionKey = position.publicKey;

    log(`开始执行 ${actionType.toUpperCase()} 重新平衡...`);
    log(`仓位: ${positionKey.toBase58()}`);
    log(`Bin 范围: ${position.lowerBinId} → ${position.upperBinId}`);

    try {
      // Step 1: 移除所有流动性（不关闭仓位）
      log("Step 1: 移除流动性...");
      
      const { userPositions } = await this.dlmmPool.getPositionsByUserAndLbPair(
        this.wallet.publicKey
      );
      
      const userPosition = userPositions.find(p => 
        p.publicKey.toBase58() === positionKey.toBase58()
      );
      
      if (!userPosition) {
        log("未找到仓位", "error");
        return false;
      }

      const binIdsToRemove = userPosition.positionData.positionBinData.map(bin => bin.binId);
      
      if (binIdsToRemove.length === 0) {
        log("仓位中没有流动性", "warn");
        return false;
      }

      const removeLiquidityTx = await this.dlmmPool.removeLiquidity({
        position: positionKey,
        user: this.wallet.publicKey,
        fromBinId: Math.min(...binIdsToRemove),
        toBinId: Math.max(...binIdsToRemove),
        bps: new BN(100 * 100), // 100% = 10000 bps
        shouldClaimAndClose: false, // 不关闭仓位，只移除流动性
      });

      const removeTxs = Array.isArray(removeLiquidityTx) ? removeLiquidityTx : [removeLiquidityTx];
      
      for (const tx of removeTxs) {
        addPriorityFee(tx);
        const sig = await sendAndConfirmTransaction(this.connection, tx, [this.wallet], {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
        log(`移除流动性交易: ${sig}`, "success");
      }

      // 等待状态更新
      await new Promise(resolve => setTimeout(resolve, 20000));
      await this.dlmmPool.refetchStates();

      // Step 2: 使用 Bid-Ask 策略重新添加流动性
      log(`Step 2: 使用 ${actionType.toUpperCase()} 策略重新添加流动性...`);

      let totalXAmount: BN;
      let totalYAmount: BN;

      if (actionType === "bid") {
        // Bid 策略：用 USDC 买入，价格越低买越多
        totalXAmount = new BN(0);
        totalYAmount = amount;
        log(`添加 USDC: ${amount.toNumber() / 1e6} USDC`);
      } else {
        // Ask 策略：用 SOL 卖出，价格越高卖越多
        totalXAmount = amount;
        totalYAmount = new BN(0);
        log(`添加 SOL: ${amount.toNumber() / 1e9} SOL`);
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
        addPriorityFee(tx);
        const sig = await sendAndConfirmTransaction(this.connection, tx, [this.wallet], {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
        log(`添加流动性交易: ${sig}`, "success");
      }

      log(`重新平衡完成！`, "success");
      
      // 更新仓位状态
      this.positionStates.set(positionKey.toBase58(), {
        ...position,
        lastAction: actionType,
      });

      return true;

    } catch (error) {
      log(`重新平衡失败: ${error instanceof Error ? error.message : String(error)}`, "error");
      if (CONFIG.VERBOSE) {
        console.error(error);
      }
      return false;
    }
  }

  /**
   * 单次检查和执行
   */
  async checkAndRebalance(): Promise<void> {
    try {
      log("─".repeat(60));
      log("开始检查仓位...");

      const positions = await this.getPositions();
      log(`找到 ${positions.length} 个仓位`);

      // 获取当前价格并记录快照
      const activeBin = await this.dlmmPool!.getActiveBin();
      const currentPrice = parseFloat(activeBin.pricePerToken);
      
      const snapshotPositions = positions.map(p => ({
        publicKey: p.publicKey.toBase58(),
        binDistribution: p.binDistribution,
        lowerBinId: p.lowerBinId,
        upperBinId: p.upperBinId,
        totalXAmount: p.totalXAmount,
        totalYAmount: p.totalYAmount,
        feeX: p.feeX,
        feeY: p.feeY,
      }));
      
      const snapshot = this.valueTracker.takeSnapshot(
        snapshotPositions,
        currentPrice,
        this.tokenXDecimals,
        this.tokenYDecimals
      );
      
      log(`📊 当前总价值: $${snapshot.totalValueUSD.toFixed(2)} | 价格: $${currentPrice.toFixed(4)}`);

      let rebalanceCount = 0;

      for (const position of positions) {
        const action = this.checkRebalanceNeeded(position);
        
        if (action) {
          rebalanceCount++;
          
          // 计算操作前价值
          const beforeValue = this.valueTracker.calculatePositionValue(
            position.binDistribution,
            this.tokenXDecimals,
            this.tokenYDecimals
          ).totalValueUSD;
          
          const success = await this.executeRebalance(action);
          
          if (success) {
            // 重新获取仓位计算操作后价值
            const updatedPositions = await this.getPositions();
            const updatedPos = updatedPositions.find(
              p => p.publicKey.toBase58() === position.publicKey.toBase58()
            );
            
            const afterValue = updatedPos 
              ? this.valueTracker.calculatePositionValue(
                  updatedPos.binDistribution,
                  this.tokenXDecimals,
                  this.tokenYDecimals
                ).totalValueUSD
              : beforeValue;
            
            // 记录操作
            this.valueTracker.recordOperation(
              position.publicKey.toBase58(),
              action.action,
              beforeValue,
              afterValue,
              action.amount.toNumber()
            );
          } else {
            log(`仓位 ${position.publicKey.toBase58().slice(0, 8)}... 重新平衡失败，将在下次检查时重试`, "warn");
          }
          
          // 每次操作后等待一下，避免 RPC 限制
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          if (CONFIG.VERBOSE) {
            const xAmount = (position.totalXAmount / 1e9).toFixed(4);
            const yAmount = (position.totalYAmount / 1e6).toFixed(2);
            log(`仓位 ${position.publicKey.toBase58().slice(0, 8)}... 无需调整 (SOL: ${xAmount}, USDC: ${yAmount})`);
          }
        }
      }

      if (rebalanceCount === 0) {
        log("所有仓位状态正常，无需调整");
      } else {
        log(`本轮完成 ${rebalanceCount} 个仓位的重新平衡`, "success");
      }
      
      // 显示汇总信息
      const summary = this.valueTracker.getSummary();
      if (summary.todayPnL !== 0) {
        const pnlSign = summary.todayPnL >= 0 ? '+' : '';
        log(`📈 今日 PnL: ${pnlSign}$${summary.todayPnL.toFixed(2)} (${pnlSign}${summary.todayPnLPercent.toFixed(2)}%)`);
      }

    } catch (error) {
      log(`检查失败: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  /**
   * 启动监控循环
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log("监控已在运行中", "warn");
      return;
    }

    await this.initialize();
    this.isRunning = true;

    log("═".repeat(60));
    log("🚀 Bid-Ask 重新平衡器已启动");
    log("═".repeat(60));

    // 立即执行一次检查
    await this.checkAndRebalance();

    // 设置定时检查
    const intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.checkAndRebalance();
      }
    }, CONFIG.MONITOR_INTERVAL_MS);

    // 处理退出信号
    process.on("SIGINT", () => {
      log("\n收到退出信号，正在停止...");
      this.isRunning = false;
      clearInterval(intervalId);
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      log("\n收到终止信号，正在停止...");
      this.isRunning = false;
      clearInterval(intervalId);
      process.exit(0);
    });
  }
}

// ============================================================================
// 主入口
// ============================================================================

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                     Meteora DLMM Bid-Ask Rebalancer                          ║
║                         自动重新平衡策略脚本                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  // 从命令行参数获取池地址
  const poolAddress = process.argv[2] || "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

  const rebalancer = new BidAskRebalancer(poolAddress);
  await rebalancer.start();
}

main().catch(error => {
  log(`启动失败: ${error.message}`, "error");
  process.exit(1);
});
