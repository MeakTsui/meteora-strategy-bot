import { PriceRange, PositionSide, ActivePosition, StrategyResult } from "../types";
import { config } from "../config/config";
import { rangeManager } from "../services/rangeManager";
import { dlmmService } from "../services/dlmmService";
import logger from "../utils/logger";
import { generateId } from "../utils/helpers";

/**
 * 趋势跟随策略（20% 资金）
 * 
 * 策略说明：
 * - 通过连续区间突破检测强趋势
 * - 上涨趋势：在上方区间部署 SOL_ONLY 仓位
 * - 下跌趋势：在下方区间部署 USDC_ONLY 仓位
 * - 趋势反转时退出
 */
export class TrendStrategy {
  private activePositions: Map<string, ActivePosition> = new Map();
  private poolAddress: string;
  private allocatedCapital: number;
  private priceHistory: Array<{ price: number; timestamp: Date }> = [];
  private consecutiveBreakouts: number = 0;
  private lastBreakoutDirection: "up" | "down" | null = null;

  constructor(poolAddress: string) {
    this.poolAddress = poolAddress;
    this.allocatedCapital = config.totalCapital * config.trendAllocation;
    logger.info(
      `Trend Strategy initialized with $${this.allocatedCapital} capital`
    );
  }

  /**
   * 针对当前价格执行策略
   */
  async execute(currentPrice: number): Promise<StrategyResult[]> {
    const results: StrategyResult[] = [];

    try {
      // 更新价格历史记录
      this.priceHistory.push({
        price: currentPrice,
        timestamp: new Date(),
      });

      // 只保留最近 100 个价格点
      if (this.priceHistory.length > 100) {
        this.priceHistory.shift();
      }

      // 检测趋势
      this.detectTrend(currentPrice);

      // 检查现有仓位
      for (const [positionId, position] of this.activePositions) {
        const result = await this.checkPosition(position, currentPrice);
        if (result) {
          results.push(result);
        }
      }

      // 如果检测到强趋势，则部署新仓位
      if (
        this.consecutiveBreakouts >= config.trendBreakoutCount &&
        this.hasAvailableCapital()
      ) {
        const result = await this.deployTrendPosition(currentPrice);
        if (result) {
          results.push(result);
        }
      }
    } catch (error) {
      logger.error("Trend strategy execution error:", error);
      results.push({
        success: false,
        action: "NONE",
        message: `Error: ${error.message}`,
      });
    }

    return results;
  }

  /**
   * 根据价格变动检测趋势
   */
  private detectTrend(currentPrice: number): void {
    if (this.priceHistory.length < 5) {
      return;
    }

    const recentPrices = this.priceHistory.slice(-5);
    const currentRange = rangeManager.findCurrentRange(currentPrice);
    const previousRange = rangeManager.findCurrentRange(
      recentPrices[recentPrices.length - 2].price
    );

    if (!currentRange || !previousRange) {
      return;
    }

    // 检查价格是否移动到新区间
    if (currentRange.id !== previousRange.id) {
      const rangeIndex = rangeManager.getRangeIndex(currentRange);
      const prevRangeIndex = rangeManager.getRangeIndex(previousRange);

      if (rangeIndex > prevRangeIndex) {
        // 向上突破
        if (this.lastBreakoutDirection === "up") {
          this.consecutiveBreakouts++;
        } else {
          this.consecutiveBreakouts = 1;
          this.lastBreakoutDirection = "up";
        }
        logger.debug(
          `Upward breakout detected. Consecutive: ${this.consecutiveBreakouts}`
        );
      } else if (rangeIndex < prevRangeIndex) {
        // 向下突破
        if (this.lastBreakoutDirection === "down") {
          this.consecutiveBreakouts++;
        } else {
          this.consecutiveBreakouts = 1;
          this.lastBreakoutDirection = "down";
        }
        logger.debug(
          `Downward breakout detected. Consecutive: ${this.consecutiveBreakouts}`
        );
      }
    }
  }

  /**
   * 检查仓位的退出条件
   */
  private async checkPosition(
    position: ActivePosition,
    currentPrice: number
  ): Promise<StrategyResult | null> {
    // 如果趋势反转则退出
    if (
      (position.side === PositionSide.SOL_ONLY &&
        this.lastBreakoutDirection === "down") ||
      (position.side === PositionSide.USDC_ONLY &&
        this.lastBreakoutDirection === "up")
    ) {
      try {
        const result = await dlmmService.withdrawPosition(
          this.poolAddress,
          position.publicKey
        );

        this.activePositions.delete(position.id);

        logger.info(
          `Closed trend position ${position.id} due to trend reversal`
        );

        return {
          success: true,
          action: "WITHDRAW",
          positionId: position.id,
          txSignature: result.signature,
          message: `Closed position on trend reversal`,
        };
      } catch (error) {
        logger.error("Failed to close position:", error);
        return {
          success: false,
          action: "WITHDRAW",
          positionId: position.id,
          message: `Failed to close: ${error.message}`,
        };
      }
    }

    return null;
  }

  /**
   * 跟随检测到的趋势部署仓位
   */
  private async deployTrendPosition(
    currentPrice: number
  ): Promise<StrategyResult | null> {
    try {
      const currentRange = rangeManager.findCurrentRange(currentPrice);
      if (!currentRange) {
        return null;
      }

      // 根据趋势方向确定仓位方向
      const side =
        this.lastBreakoutDirection === "up"
          ? PositionSide.SOL_ONLY
          : PositionSide.USDC_ONLY;

      // 获取目标区间（趋势方向上的下一个区间）
      const targetRange =
        this.lastBreakoutDirection === "up"
          ? rangeManager.getNextRange(currentRange)
          : rangeManager.getPreviousRange(currentRange);

      if (!targetRange) {
        return null;
      }

      // 计算仓位大小
      const positionSize = Math.min(
        this.allocatedCapital / 3, // 最多 3 个趋势仓位
        this.allocatedCapital - this.getTotalDeployed()
      );

      if (positionSize < 10) {
        logger.warn("Insufficient capital for trend position");
        return null;
      }

      // 创建仓位
      const result = await dlmmService.createPosition(
        this.poolAddress,
        targetRange,
        side,
        positionSize
      );

      // 跟踪活跃仓位
      const position: ActivePosition = {
        id: generateId("trend"),
        publicKey: result.signature
          ? new (await import("@solana/web3.js")).PublicKey(result.signature)
          : new (await import("@solana/web3.js")).PublicKey(
              "11111111111111111111111111111111"
            ),
        poolAddress: this.poolAddress,
        range: targetRange,
        strategyType: require("../types").StrategyType.TREND_FOLLOWING,
        side,
        allocatedCapital: positionSize,
        createdAt: new Date(),
      };

      this.activePositions.set(position.id, position);

      logger.info(
        `Deployed Trend position in range ${targetRange.lower}-${targetRange.upper} with $${positionSize} (${side})`
      );

      // 部署后重置连续突破计数
      this.consecutiveBreakouts = 0;

      return {
        success: true,
        action: "CREATE",
        positionId: position.id,
        txSignature: result.signature,
        message: `Created trend position following ${this.lastBreakoutDirection}trend`,
      };
    } catch (error) {
      logger.error("Failed to deploy trend position:", error);
      return {
        success: false,
        action: "CREATE",
        message: `Failed to deploy: ${error.message}`,
      };
    }
  }

  /**
   * 检查是否有可用资金
   */
  private hasAvailableCapital(): boolean {
    return this.getTotalDeployed() < this.allocatedCapital * 0.95;
  }

  /**
   * 获取已部署的总资金
   */
  private getTotalDeployed(): number {
    return Array.from(this.activePositions.values()).reduce(
      (sum, p) => sum + p.allocatedCapital,
      0
    );
  }

  /**
   * 获取策略统计信息
   */
  getStats() {
    return {
      activePositions: this.activePositions.size,
      totalDeployed: this.getTotalDeployed(),
      availableCapital: this.allocatedCapital - this.getTotalDeployed(),
      consecutiveBreakouts: this.consecutiveBreakouts,
      trendDirection: this.lastBreakoutDirection,
    };
  }
}
