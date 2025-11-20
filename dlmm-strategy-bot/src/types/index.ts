import { PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";

/**
 * 价格区间定义
 */
export interface PriceRange {
  lower: number;
  upper: number;
  id: string;
}

/**
 * 策略类型枚举
 */
export enum StrategyType {
  BID_ASK = "BID_ASK",
  TREND_FOLLOWING = "TREND_FOLLOWING",
  INSURANCE = "INSURANCE",
}

/**
 * 仓位方向（指定投入哪种 Token）
 */
export enum PositionSide {
  SOL_ONLY = "SOL_ONLY",
  USDC_ONLY = "USDC_ONLY",
  BALANCED = "BALANCED",
}

/**
 * 活跃仓位信息
 */
export interface ActivePosition {
  id: string;
  publicKey: PublicKey;
  poolAddress: string;
  range: PriceRange;
  strategyType: StrategyType;
  side: PositionSide;
  allocatedCapital: number;
  createdAt: Date;
  lastRebalanceAt?: Date;
  dlmmPool?: DLMM;
  binIds?: number[];
}

/**
 * 来自外部数据源的价格数据
 */
export interface PriceData {
  price: number;
  timestamp: Date;
  source: string;
}

/**
 * OHLC K 线数据
 */
export interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: Date;
  volume?: number;
}

/**
 * 策略执行结果
 */
export interface StrategyResult {
  success: boolean;
  action: "CREATE" | "WITHDRAW" | "REBALANCE" | "NONE";
  positionId?: string;
  txSignature?: string;
  profitLoss?: number;
  message: string;
}

/**
 * 回测结果
 */
export interface BacktestResult {
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  totalFees: number;
  maxDrawdown: number;
  annualizedReturn: number;
  compoundCount: number;
  rangeResults: RangeResult[];
}

/**
 * 区间表现结果
 */
export interface RangeResult {
  range: PriceRange;
  trades: number;
  profit: number;
  fees: number;
  avgHoldTime: number;
}

/**
 * 机器人配置
 */
export interface BotConfig {
  // 资金分配
  totalCapital: number;
  mainAllocation: number;
  trendAllocation: number;
  insuranceAllocation: number;

  // 价格区间设置
  minPrice: number;
  maxPrice: number;
  gridSize: number;

  // 策略参数
  redeployThreshold: number;
  rangeWidth: number;
  trendBreakoutCount: number;
  insuranceRanges: PriceRange[];
  reboundThreshold: number;

  // 机器人运行设置
  checkInterval: number;
  maxConsecutiveFailures: number;
  enableDryRun: boolean;
}

/**
 * 熔断器状态
 */
export interface CircuitBreakerState {
  consecutiveFailures: number;
  isTripped: boolean;
  lastFailureTime?: Date;
}
