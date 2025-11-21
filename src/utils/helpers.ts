import Decimal from "decimal.js";
import { PriceRange } from "../types";

/**
 * 睡眠工具函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 使用指数退避策略重试函数
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

/**
 * 格式化 Token 余额（处理小数位）
 */
export function formatTokenBalance(
  balance: bigint | number | string,
  decimals: number
): Decimal {
  return new Decimal(balance.toString()).div(new Decimal(10).pow(decimals));
}

/**
 * 将 Token 数量转换为原始数量（带小数位）
 */
export function toRawAmount(amount: number, decimals: number): bigint {
  return BigInt(new Decimal(amount).mul(new Decimal(10).pow(decimals)).floor().toString());
}

/**
 * 检查价格是否在区间内
 */
export function isPriceInRange(price: number, range: PriceRange): boolean {
  return price >= range.lower && price <= range.upper;
}

/**
 * 计算百分比变化
 */
export function calculatePercentageChange(
  oldValue: number,
  newValue: number
): number {
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * 生成唯一 ID
 */
export function generateId(prefix: string = ""): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

/**
 * 格式化数字为固定小数位
 */
export function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
}

/**
 * 根据利润和持有时间计算年化收益率
 */
export function calculateAnnualizedReturn(
  profit: number,
  principal: number,
  daysHeld: number
): number {
  const returnRate = profit / principal;
  return (returnRate * 365) / daysHeld;
}

/**
 * 安全除法，避免除以零
 */
export function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
