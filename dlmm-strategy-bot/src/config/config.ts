import dotenv from "dotenv";
import { BotConfig, PriceRange } from "../types";

dotenv.config();

/**
 * 从环境变量中解析保险区间配置
 * 格式示例: "80-100,60-80,40-60"
 */
function parseInsuranceRanges(rangesStr: string): PriceRange[] {
  return rangesStr.split(",").map((range, index) => {
    const [lower, upper] = range.split("-").map(Number);
    return {
      lower,
      upper,
      id: `insurance-${index}`,
    };
  });
}

/**
 * 机器人主配置对象
 */
export const config: BotConfig = {
  // 资金分配配置
  totalCapital: Number(process.env.TOTAL_CAPITAL_USDC) || 5000,
  mainAllocation: Number(process.env.MAIN_STRATEGY_ALLOCATION) || 0.7,
  trendAllocation: Number(process.env.TREND_STRATEGY_ALLOCATION) || 0.2,
  insuranceAllocation: Number(process.env.INSURANCE_STRATEGY_ALLOCATION) || 0.1,

  // 价格区间设置
  minPrice: Number(process.env.MIN_PRICE) || 100,
  maxPrice: Number(process.env.MAX_PRICE) || 250,
  gridSize: Number(process.env.GRID_SIZE) || 5,

  // 策略相关参数
  redeployThreshold: Number(process.env.REDEPLOY_THRESHOLD) || 0.003,
  rangeWidth: Number(process.env.RANGE_WIDTH) || 5,
  trendBreakoutCount: Number(process.env.TREND_BREAKOUT_COUNT) || 3,
  insuranceRanges: parseInsuranceRanges(
    process.env.INSURANCE_RANGES || "80-100,60-80,40-60"
  ),
  reboundThreshold: Number(process.env.REBOUND_THRESHOLD) || 0.1,

  // 机器人运行参数
  checkInterval: Number(process.env.CHECK_INTERVAL_MS) || 60000,
  maxConsecutiveFailures: Number(process.env.MAX_CONSECUTIVE_FAILURES) || 5,
  enableDryRun: process.env.ENABLE_DRY_RUN === "true",
};

/**
 * RPC 节点配置
 */
export const rpcConfig = {
  url: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  wssUrl: process.env.RPC_WSS_URL || "wss://api.mainnet-beta.solana.com",
};

/**
 * 钱包配置
 */
export const walletConfig = {
  privateKey: process.env.WALLET_PRIVATE_KEY || "",
};

/**
 * 价格数据源相关的 API Key 配置
 */
export const apiKeys = {
  helius: process.env.HELIUS_API_KEY || "",
  birdeye: process.env.BIRDEYE_API_KEY || "",
};

/**
 * 日志相关配置
 */
export const logConfig = {
  level: process.env.LOG_LEVEL || "info",
};

/**
 * 校验配置是否合法
 */
export function validateConfig(): void {
  if (!walletConfig.privateKey && !config.enableDryRun) {
    throw new Error("开启真实交易模式时必须配置 WALLET_PRIVATE_KEY");
  }

  if (
    config.mainAllocation + config.trendAllocation + config.insuranceAllocation !==
    1.0
  ) {
    throw new Error(
      "策略资金分配比例之和必须为 1.0（100%）。当前之和为: " +
        (config.mainAllocation +
          config.trendAllocation +
          config.insuranceAllocation)
    );
  }

  if (config.minPrice >= config.maxPrice) {
    throw new Error("MIN_PRICE 必须小于 MAX_PRICE");
  }

  if (config.gridSize <= 0) {
    throw new Error("GRID_SIZE 必须大于 0");
  }
}
