// ============================================================================
// Bid-Ask Rebalancer 类型定义
// ============================================================================

/**
 * Bin 分布数据
 */
export interface BinDistribution {
  binId: number;
  price: number;
  xAmount: number;
  yAmount: number;
}

/**
 * 仓位状态
 */
export interface PositionState {
  publicKey: string;
  lowerBinId: number;
  upperBinId: number;
  totalXAmount: number;
  totalYAmount: number;
  binCount: number;
  binDistribution: BinDistribution[];
  lastAction?: "bid" | "ask";
  feeX: number;
  feeY: number;
}

/**
 * 重新平衡操作
 */
export interface RebalanceAction {
  position: PositionState;
  action: "bid" | "ask";
  amount: number;
}

/**
 * 仓位价值
 */
export interface PositionValue {
  publicKey: string;
  valueUSD: number;
  xAmount: number;
  yAmount: number;
  xValueUSD: number;
  yValueUSD: number;
  priceRange: [number, number];
  binCount: number;
  feeX: number;
  feeY: number;
  feeXUSD: number;
  feeYUSD: number;
  totalFeeUSD: number;
  positionType: 'bid' | 'ask' | 'mixed';
  solRatio: number;
  currentAvgPrice: number;
  lastBidPrice: number | null;
  lastAskPrice: number | null;
}

/**
 * 价值快照
 */
export interface ValueSnapshot {
  id?: number;
  timestamp: number;
  totalValueUSD: number;
  currentPrice: number;
  positions: PositionValue[];
}

/**
 * 操作记录
 */
export interface OperationRecord {
  id?: number;
  timestamp: number;
  positionKey: string;
  action: 'bid' | 'ask';
  beforeValueUSD: number;
  afterValueUSD: number;
  amountProcessed: number;
  txSignature?: string;
}

/**
 * 每日 PnL
 */
export interface DailyPnL {
  id?: number;
  date: string;
  openValue: number;
  closeValue: number;
  highValue: number;
  lowValue: number;
  pnl: number;
  pnlPercent: number;
  operations: number;
}

/**
 * 已领取手续费记录
 */
export interface ClaimedFeeRecord {
  id?: number;
  timestamp: number;
  positionKey: string;
  txSignature: string;
  claimedX: number;
  claimedY: number;
  claimedXUSD: number;
  claimedYUSD: number;
  totalClaimedUSD: number;
  priceAtClaim: number;
}

/**
 * 汇总数据
 */
export interface TrackerSummary {
  currentTotalValue: number;
  todayPnL: number;
  todayPnLPercent: number;
  totalPnL: number;
  totalPnLPercent: number;
  apy7d: number;
  apy30d: number;
  positionCount: number;
  todayOperations: number;
  firstSnapshotDate: string | null;
  lastUpdateTime: number;
  totalUnclaimedFeeUSD: number;
  totalClaimedFeeUSD: number;
  todayClaimedFeeUSD: number;
  feeAPY7d: number;
}

/**
 * Rebalancer 配置
 */
export interface RebalancerConfig {
  rpcUrl: string;
  priorityFee: number;
  verbose: boolean;
  claimFeeEnabled: boolean;
  claimFeeThresholdUSD: number;
  claimFeeCheckHour: number;
  claimFeeMinPositionUSD: number;
  poolAddress: string;
}

/**
 * Cloudflare Workers 环境变量和绑定
 */
export interface Env {
  DB: D1Database;
  STATE: KVNamespace;
  RPC_URL: string;
  POOL_ADDRESS: string;
  PRIORITY_FEE: string;
  VERBOSE: string;
  LOG_LEVEL: string;
  CLAIM_FEE_ENABLED: string;
  CLAIM_FEE_THRESHOLD_USD: string;
  CLAIM_FEE_CHECK_HOUR: string;
  CLAIM_FEE_MIN_POSITION_USD: string;
  WALLET_PRIVATE_KEY: string;
}
