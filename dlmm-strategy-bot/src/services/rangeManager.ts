import { PriceRange } from "../types";
import { config } from "../config/config";
import { generateId } from "../utils/helpers";
import logger from "../utils/logger";

/**
 * RangeManager —— 负责价格区间的划分和管理
 */
export class RangeManager {
  private ranges: PriceRange[] = [];

  constructor() {
    this.initializeRanges();
  }

  /**
   * 根据配置初始化价格区间列表
   */
  private initializeRanges(): void {
    const { minPrice, maxPrice, gridSize } = config;
    this.ranges = [];

    for (let lower = minPrice; lower < maxPrice; lower += gridSize) {
      const upper = Math.min(lower + gridSize, maxPrice);
      this.ranges.push({
        lower,
        upper,
        id: generateId("range"),
      });
    }

    logger.info(
      `已初始化 ${this.ranges.length} 个区间，从 $${minPrice} 到 $${maxPrice}`
    );
  }

  /**
   * 获取所有价格区间
   */
  getAllRanges(): PriceRange[] {
    return [...this.ranges];
  }

  /**
   * 查找包含指定价格的区间
   */
  findCurrentRange(price: number): PriceRange | null {
    const range = this.ranges.find((r) => price >= r.lower && price < r.upper);
    return range || null;
  }

  /**
   * 获取当前区间上方的下一个区间
   */
  getNextRange(currentRange: PriceRange): PriceRange | null {
    const currentIndex = this.ranges.findIndex(
      (r) => r.id === currentRange.id
    );
    if (currentIndex === -1 || currentIndex === this.ranges.length - 1) {
      return null;
    }
    return this.ranges[currentIndex + 1];
  }

  /**
   * 获取当前区间下方的前一个区间
   */
  getPreviousRange(currentRange: PriceRange): PriceRange | null {
    const currentIndex = this.ranges.findIndex(
      (r) => r.id === currentRange.id
    );
    if (currentIndex <= 0) {
      return null;
    }
    return this.ranges[currentIndex - 1];
  }

  /**
   * 检查价格是否向上突破区间（超过上界）
   */
  isBreakoutUp(range: PriceRange, price: number): boolean {
    return price > range.upper;
  }

  /**
   * 检查价格是否向下突破区间（低于下界）
   */
  isBreakoutDown(range: PriceRange, price: number): boolean {
    return price < range.lower;
  }

  /**
   * 从指定区间开始，获取连续 N 个区间
   */
  getConsecutiveRanges(
    startRange: PriceRange,
    count: number,
    direction: "up" | "down"
  ): PriceRange[] {
    const startIndex = this.ranges.findIndex((r) => r.id === startRange.id);
    if (startIndex === -1) return [];

    const result: PriceRange[] = [];
    if (direction === "up") {
      for (
        let i = startIndex;
        i < Math.min(startIndex + count, this.ranges.length);
        i++
      ) {
        result.push(this.ranges[i]);
      }
    } else {
      for (let i = startIndex; i >= Math.max(0, startIndex - count + 1); i--) {
        result.push(this.ranges[i]);
      }
    }
    return result;
  }

  /**
   * 获取指定价格带内的所有区间
   */
  getRangesInBand(minPrice: number, maxPrice: number): PriceRange[] {
    return this.ranges.filter(
      (r) => r.lower >= minPrice && r.upper <= maxPrice
    );
  }

  /**
   * 计算两个区间之间的距离（以区间数量为单位）
   */
  getRangeDistance(range1: PriceRange, range2: PriceRange): number {
    const index1 = this.ranges.findIndex((r) => r.id === range1.id);
    const index2 = this.ranges.findIndex((r) => r.id === range2.id);
    if (index1 === -1 || index2 === -1) return 0;
    return Math.abs(index1 - index2);
  }

  /**
   * 根据索引获取区间
   */
  getRangeByIndex(index: number): PriceRange | null {
    return this.ranges[index] || null;
  }

  /**
   * 获取区间的索引位置
   */
  getRangeIndex(range: PriceRange): number {
    return this.ranges.findIndex((r) => r.id === range.id);
  }
}

// 导出单例实例
export const rangeManager = new RangeManager();
