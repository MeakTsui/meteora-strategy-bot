/**
 * 格式化 Token 余额显示
 */
export function formatTokenBalance(
  amount: number | bigint,
  decimals: number
): string {
  const value = Number(amount) / Math.pow(10, decimals);
  return value.toFixed(decimals > 6 ? 6 : decimals);
}

/**
 * 将 USD 金额转换为原始数量（含精度）
 */
export function toRawAmount(amount: number, decimals: number): bigint {
  return BigInt(Math.floor(amount * Math.pow(10, decimals)));
}

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 延迟执行（在 Workers 中一般不需要，但保留兼容性）
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带重试的异步操作
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await sleep(delayMs * (i + 1));
      }
    }
  }

  throw lastError;
}

/**
 * 计算两个价格之间的百分比变化
 */
export function calculatePriceChange(
  oldPrice: number,
  newPrice: number
): number {
  if (oldPrice === 0) return 0;
  return (newPrice - oldPrice) / oldPrice;
}

/**
 * 检查价格是否在区间内
 */
export function isPriceInRange(
  price: number,
  lower: number,
  upper: number
): boolean {
  return price >= lower && price <= upper;
}

/**
 * 格式化日期为 ISO 字符串
 */
export function formatDate(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * 解析 ISO 日期字符串
 */
export function parseDate(dateStr: string): Date {
  return new Date(dateStr);
}
