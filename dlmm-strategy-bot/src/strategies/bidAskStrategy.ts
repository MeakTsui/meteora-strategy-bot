import { PriceRange, PositionSide, ActivePosition, StrategyResult } from "../types";
import { config } from "../config/config";
import { rangeManager } from "../services/rangeManager";
import { dlmmService } from "../services/dlmmService";
import logger from "../utils/logger";
import { generateId } from "../utils/helpers";

/**
 * Bid-Ask 高频策略（主策略 - 70% 资金）
 * 
 * 策略说明：
 * - 在小区间内部署仓位（例如 5 USD 宽度）
 * - 使用 SOL_ONLY 模式从价格上涨中获利
 * - 当价格突破区间上界 + 阈值时，撤出并重新部署
 * - 通过在同一区间重新部署实现复利
 */
export class BidAskStrategy {
  private activePositions: Map<string, ActivePosition> = new Map();
  private poolAddress: string;
  private allocatedCapital: number;
  private compoundCount: number = 0;

  constructor(poolAddress: string) {
    this.poolAddress = poolAddress;
    this.allocatedCapital = config.totalCapital * config.mainAllocation;
    logger.info(
      `Bid-Ask 策略已初始化，资金: $${this.allocatedCapital}`
    );
  }

  /**
   * 针对当前价格执行策略
   */
  async execute(currentPrice: number): Promise<StrategyResult[]> {
    const results: StrategyResult[] = [];

    try {
      // 查找当前价格所在区间
      const currentRange = rangeManager.findCurrentRange(currentPrice);
      if (!currentRange) {
        logger.warn(`价格 ${currentPrice} 超出配置区间`);
        return results;
      }

      // 检查现有仓位是否需要重新平衡或重新部署
      for (const [positionId, position] of this.activePositions) {
        const result = await this.checkPosition(position, currentPrice);
        if (result) {
          results.push(result);
        }
      }

      // 检查是否应该在当前区间部署新仓位
      const hasPositionInRange = Array.from(this.activePositions.values()).some(
        (p) => p.range.id === currentRange.id
      );

      if (!hasPositionInRange && this.hasAvailableCapital()) {
        const result = await this.deployPosition(currentRange);
        if (result) {
          results.push(result);
        }
      }
    } catch (error) {
      logger.error("BidAsk strategy execution error:", error);
      results.push({
        success: false,
        action: "NONE",
        message: `Error: ${error.message}`,
      });
    }

    return results;
  }

  /**
   * 检查仓位并判断是否需要重新平衡或重新部署
   */
  private async checkPosition(
    position: ActivePosition,
    currentPrice: number
  ): Promise<StrategyResult | null> {
    const range = position.range;
    const upperThreshold = range.upper * (1 + config.redeployThreshold);

    // 检查价格是否突破上界（含阈值）
    if (currentPrice > upperThreshold) {
      logger.info(
        `价格 ${currentPrice} 突破区间 ${range.lower}-${range.upper} 上界，重新部署`
      );

      try {
        // 撤出当前仓位
        const withdrawResult = await dlmmService.withdrawPosition(
          this.poolAddress,
          position.publicKey
        );

        // 从活跃仓位列表中移除
        this.activePositions.delete(position.id);

        // 在同一区间重新部署
        const redeployResult = await this.deployPosition(range);

        this.compoundCount++;

        return {
          success: true,
          action: "REBALANCE",
          positionId: position.id,
          txSignature: withdrawResult.signature,
          message: `Redeployed position in range ${range.lower}-${range.upper}. Compound count: ${this.compoundCount}`,
        };
      } catch (error) {
        logger.error("Failed to redeploy position:", error);
        return {
          success: false,
          action: "REBALANCE",
          positionId: position.id,
          message: `Failed to redeploy: ${error.message}`,
        };
      }
    }

    return null;
  }

  /**
   * 在指定区间部署新仓位
   */
  private async deployPosition(
    range: PriceRange
  ): Promise<StrategyResult | null> {
    try {
      // 计算仓位大小（将资金分散到多个区间）
      const positionSize = Math.min(
        this.allocatedCapital / 10, // Divide into 10 positions max
        this.allocatedCapital - this.getTotalDeployed()
      );

      if (positionSize < 10) {
        // 每个仓位最少 $10
        logger.warn("资金不足，无法创建新仓位");
        return null;
      }

      // 创建仓位
      const result = await dlmmService.createPosition(
        this.poolAddress,
        range,
        PositionSide.SOL_ONLY,
        positionSize
      );

      // 跟踪活跃仓位
      const position: ActivePosition = {
        id: generateId("bidask"),
        publicKey: result.signature
          ? new (await import("@solana/web3.js")).PublicKey(result.signature)
          : new (await import("@solana/web3.js")).PublicKey(
              "11111111111111111111111111111111"
            ), // 占位符
        poolAddress: this.poolAddress,
        range,
        strategyType: require("../types").StrategyType.BID_ASK,
        side: PositionSide.SOL_ONLY,
        allocatedCapital: positionSize,
        createdAt: new Date(),
      };

      this.activePositions.set(position.id, position);

      logger.info(
        `在区间 ${range.lower}-${range.upper} 部署 Bid-Ask 仓位，金额: $${positionSize}`
      );

      return {
        success: true,
        action: "CREATE",
        positionId: position.id,
        txSignature: result.signature,
        message: `Created position in range ${range.lower}-${range.upper}`,
      };
    } catch (error) {
      logger.error("部署仓位失败:", error);
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
    return this.getTotalDeployed() < this.allocatedCapital * 0.95; // 保留 5% 缓冲
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
      compoundCount: this.compoundCount,
    };
  }
}
