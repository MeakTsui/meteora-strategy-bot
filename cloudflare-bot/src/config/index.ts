import { Env, RebalancerConfig } from "../types";

/**
 * 从 Cloudflare 环境变量创建配置
 */
export function createConfig(env: Env): RebalancerConfig {
  return {
    rpcUrl: env.RPC_URL || "https://api.mainnet-beta.solana.com",
    priorityFee: parseInt(env.PRIORITY_FEE || "1000"),
    verbose: env.VERBOSE === "true",
    claimFeeEnabled: env.CLAIM_FEE_ENABLED !== "false",
    claimFeeThresholdUSD: parseFloat(env.CLAIM_FEE_THRESHOLD_USD || "5"),
    claimFeeCheckHour: parseInt(env.CLAIM_FEE_CHECK_HOUR || "8"),
    claimFeeMinPositionUSD: parseFloat(env.CLAIM_FEE_MIN_POSITION_USD || "0.1"),
    poolAddress: env.POOL_ADDRESS || "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
  };
}
