import { PriceRange, PositionSide, ActivePosition, StrategyResult } from "../types";
import { config } from "../config/config";
import { dlmmService } from "../services/dlmmService";
import logger from "../utils/logger";
import { generateId } from "../utils/helpers";

/**
 * 保险策略（10% 资金）
 * 
 * 策略说明：
 * - 在远距离“抵底”区间部署仓位
 * - 仅当价格暴跌进入这些区间时激活
 * - 当价格反弹达到阈值百分比时退出
 * - 在市场崩盘期间提供高收益
 */
export class InsuranceStrategy {
  private activePositions: Map<string, ActivePosition> = new Map();
  private poolAddress: string;
  private allocatedCapital: number;
  private insuranceRanges: PriceRange[];
  private lastPrice: number = 0;

  constructor(poolAddress: string) {
    this.poolAddress = poolAddress;
    this.allocatedCapital = config.totalCapital * config.insuranceAllocation;
    this.insuranceRanges = config.insuranceRanges;
    logger.info(
      `保险策略已初始化，资金: $${this.allocatedCapital}`
    );
    logger.info(
      `保险区间: ${this.insuranceRanges.map((r) => `${r.lower}-${r.upper}`).join(", ")}`
    );
  }

  /**
   * 针对当前价格执行策略
   */
  async execute(currentPrice: number): Promise<StrategyResult[]> {
    const results: StrategyResult[] = [];

    try {
      // 检查现有仓位的退出条件
      for (const [positionId, position] of this.activePositions) {
        const result = await this.checkPosition(position, currentPrice);
        if (result) {
          results.push(result);
        }
      }

      // 检查价格是否暴跌进入任何保险区间
      if (this.lastPrice > 0 && currentPrice < this.lastPrice) {
        for (const range of this.insuranceRanges) {
          // 检查价格是否在此保险区间内
          if (currentPrice >= range.lower && currentPrice < range.upper) {
            // 检查我们是否已在此区间有仓位
            const hasPosition = Array.from(this.activePositions.values()).some(
              (p) => p.range.id === range.id
            );

            if (!hasPosition && this.hasAvailableCapital()) {
              const result = await this.deployInsurancePosition(range);
              if (result) {
                results.push(result);
              }
            }
          }
        }
      }

      this.lastPrice = currentPrice;
    } catch (error) {
      logger.error("Insurance strategy execution error:", error);
      results.push({
        success: false,
        action: "NONE",
        message: `Error: ${error.message}`,
      });
    }

    return results;
  }

  /**
   * 检查仓位的退出条件
   */
  private async checkPosition(
    position: ActivePosition,
    currentPrice: number
  ): Promise<StrategyResult | null> {
    // 计算从仓位创建时的反弹百分比
    const entryPrice = (position.range.lower + position.range.upper) / 2;
    const reboundPercent = (currentPrice - entryPrice) / entryPrice;

    // 如果价格反弹达到阈值则退出
    if (reboundPercent >= config.reboundThreshold) {
      try {
        const result = await dlmmService.withdrawPosition(
          this.poolAddress,
          position.publicKey
        );

        this.activePositions.delete(position.id);

        logger.info(
          `Closed insurance position ${position.id} after ${(reboundPercent * 100).toFixed(2)}% rebound`
        );

        return {
          success: true,
          action: "WITHDRAW",
          positionId: position.id,
          txSignature: result.signature,
          profitLoss: position.allocatedCapital * reboundPercent,
          message: `Closed insurance position with ${(reboundPercent * 100).toFixed(2)}% profit`,
        };
      } catch (error) {
        logger.error("Failed to close insurance position:", error);
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
   * 在崩盘区间部署保险仓位
   */
  private async deployInsurancePosition(
    range: PriceRange
  ): Promise<StrategyResult | null> {
    try {
      // 计算仓位大小（在保险区间之间平均分配）
      const positionSize = Math.min(
        this.allocatedCapital / this.insuranceRanges.length,
        this.allocatedCapital - this.getTotalDeployed()
      );

      if (positionSize < 10) {
        logger.warn("资金不足，无法创建保险仓位");
        return null;
      }

      // 保险区间使用 BALANCED 模式部署
      const result = await dlmmService.createPosition(
        this.poolAddress,
        range,
        PositionSide.BALANCED,
        positionSize
      );

      // 跟踪活跃仓位
      const position: ActivePosition = {
        id: generateId("insurance"),
        publicKey: result.signature
          ? new (await import("@solana/web3.js")).PublicKey(result.signature)
          : new (await import("@solana/web3.js")).PublicKey(
              "11111111111111111111111111111111"
            ),
        poolAddress: this.poolAddress,
        range,
        strategyType: require("../types").StrategyType.INSURANCE,
        side: PositionSide.BALANCED,
        allocatedCapital: positionSize,
        createdAt: new Date(),
      };

      this.activePositions.set(position.id, position);

      logger.info(
        `部署保险仓位在区间 ${range.lower}-${range.upper}，资金 $${positionSize}`
      );

      return {
        success: true,
        action: "CREATE",
        positionId: position.id,
        txSignature: result.signature,
        message: `Activated insurance position in crash range ${range.lower}-${range.upper}`,
      };
    } catch (error) {
      logger.error("部署保险仓位失败:", error);
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
      insuranceRanges: this.insuranceRanges.length,
    };
  }
}
