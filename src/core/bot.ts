import { priceService } from "../services/priceService";
import { dlmmService } from "../services/dlmmService";
import { BidAskStrategy } from "../strategies/bidAskStrategy";
import { TrendStrategy } from "../strategies/trendStrategy";
import { InsuranceStrategy } from "../strategies/insuranceStrategy";
import { CircuitBreakerState, StrategyResult } from "../types";
import { config } from "../config/config";
import logger from "../utils/logger";
import { sleep } from "../utils/helpers";

/**
 * 机器人核心类 —— 负责协同所有策略并管理主执行循环
 */
export class DLMMBot {
  private bidAskStrategy: BidAskStrategy;
  private trendStrategy: TrendStrategy;
  private insuranceStrategy: InsuranceStrategy;
  private circuitBreaker: CircuitBreakerState;
  private isRunning: boolean = false;
  private poolAddress: string;

  constructor(poolAddress?: string) {
    this.poolAddress = poolAddress || dlmmService.getDefaultPoolAddress();

    // 初始化三类策略实例
    this.bidAskStrategy = new BidAskStrategy(this.poolAddress);
    this.trendStrategy = new TrendStrategy(this.poolAddress);
    this.insuranceStrategy = new InsuranceStrategy(this.poolAddress);

    // 初始化熔断器状态
    this.circuitBreaker = {
      consecutiveFailures: 0,
      isTripped: false,
    };

    logger.info(`DLMM 机器人已初始化，池地址: ${this.poolAddress}`);
    logger.info(`资金分配:`);
    logger.info(`  - Bid-Ask 策略: $${config.totalCapital * config.mainAllocation}`);
    logger.info(`  - 趋势策略: $${config.totalCapital * config.trendAllocation}`);
    logger.info(`  - 保险策略: $${config.totalCapital * config.insuranceAllocation}`);
  }

  /**
   * 启动机器人
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("机器人已在运行中");
      return;
    }

    this.isRunning = true;
    logger.info("🚀 启动 DLMM 策略机器人...");

    if (config.enableDryRun) {
      logger.warn("⚠️  DRY RUN 模式已启用 - 不会发送真实交易");
    }

    // 订阅价格更新，用于调试观察价格变化
    priceService.subscribePrice((price) => {
      logger.debug(`价格更新: $${price.toFixed(2)}`);
    });

    // 启动主执行循环
    await this.executionLoop();
  }

  /**
   * 停止机器人
   */
  stop(): void {
    this.isRunning = false;
    logger.info("🛑 停止 DLMM 策略机器人...");
  }

  /**
   * 主执行循环
   * 周期性获取价格并依次执行各个策略，同时处理熔断与失败计数
   */
  private async executionLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // 检查熔断器状态，如果已触发则等待一段时间后重置
        if (this.circuitBreaker.isTripped) {
          logger.warn("熔断器已触发，等待后重试...");
          await sleep(60000); // Wait 1 minute
          this.resetCircuitBreaker();
          continue;
        }

        // 获取当前价格
        const currentPrice = await priceService.getPrice();
        
        if (currentPrice === 0) {
          logger.error("获取有效价格失败");
          this.handleFailure();
          await sleep(config.checkInterval);
          continue;
        }

        logger.info(`\n${"=".repeat(60)}`);
        logger.info(`执行策略，当前价格: $${currentPrice.toFixed(2)}`);
        logger.info(`${"=".repeat(60)}\n`);

        // 依次执行所有策略
        const results = await this.executeStrategies(currentPrice);

        // 记录本轮执行结果
        this.logResults(results);

        // 只要有任意一次成功执行，则重置连续失败计数
        if (results.some((r) => r.success)) {
          this.circuitBreaker.consecutiveFailures = 0;
        }

        // 输出当前各策略的统计信息
        this.logStats();

      } catch (error) {
        logger.error("执行循环出错:", error);
        this.handleFailure();
      }

      // 等待下一个调度周期
      await sleep(config.checkInterval);
    }

    logger.info("执行循环已停止");
  }

  /**
   * 执行所有策略
   */
  private async executeStrategies(
    currentPrice: number
  ): Promise<StrategyResult[]> {
    const results: StrategyResult[] = [];

    try {
      // Execute Bid-Ask Strategy (Main)
      logger.info("📊 执行 Bid-Ask 策略...");
      const bidAskResults = await this.bidAskStrategy.execute(currentPrice);
      results.push(...bidAskResults);

      // Execute Trend Strategy
      logger.info("📈 执行趋势策略...");
      const trendResults = await this.trendStrategy.execute(currentPrice);
      results.push(...trendResults);

      // Execute Insurance Strategy
      logger.info("🛡️  执行保险策略...");
      const insuranceResults = await this.insuranceStrategy.execute(
        currentPrice
      );
      results.push(...insuranceResults);
    } catch (error) {
      logger.error("执行策略出错:", error);
      results.push({
        success: false,
        action: "NONE",
        message: `Strategy execution error: ${(error as Error).message}`,
      });
    }

    return results;
  }

  /**
   * 输出本轮执行的结果明细
   */
  private logResults(results: StrategyResult[]): void {
    if (results.length === 0) {
      logger.info("未执行任何操作");
      return;
    }

    logger.info("\n📋 执行结果:");
    results.forEach((result, index) => {
      const icon = result.success ? "✅" : "❌";
      logger.info(`${icon} [${index + 1}] ${result.action}: ${result.message}`);
      if (result.txSignature) {
        logger.info(`   TX: ${result.txSignature}`);
      }
      if (result.profitLoss) {
        logger.info(`   P/L: $${result.profitLoss.toFixed(2)}`);
      }
    });
  }

  /**
   * 输出各策略及总体的统计信息
   */
  private logStats(): void {
    const bidAskStats = this.bidAskStrategy.getStats();
    const trendStats = this.trendStrategy.getStats();
    const insuranceStats = this.insuranceStrategy.getStats();

    logger.info("\n📊 策略统计:");
    logger.info("Bid-Ask 策略:");
    logger.info(`  - 活跃仓位: ${bidAskStats.activePositions}`);
    logger.info(`  - 已部署: $${bidAskStats.totalDeployed.toFixed(2)}`);
    logger.info(`  - 可用: $${bidAskStats.availableCapital.toFixed(2)}`);
    logger.info(`  - 复利次数: ${bidAskStats.compoundCount}`);

    logger.info("趋势策略:");
    logger.info(`  - 活跃仓位: ${trendStats.activePositions}`);
    logger.info(`  - 已部署: $${trendStats.totalDeployed.toFixed(2)}`);
    logger.info(`  - 可用: $${trendStats.availableCapital.toFixed(2)}`);
    logger.info(`  - 趋势: ${trendStats.trendDirection || "无"}`);
    logger.info(`  - 突破次数: ${trendStats.consecutiveBreakouts}`);

    logger.info("保险策略:");
    logger.info(`  - 活跃仓位: ${insuranceStats.activePositions}`);
    logger.info(`  - 已部署: $${insuranceStats.totalDeployed.toFixed(2)}`);
    logger.info(`  - 可用: $${insuranceStats.availableCapital.toFixed(2)}`);

    const totalDeployed =
      bidAskStats.totalDeployed +
      trendStats.totalDeployed +
      insuranceStats.totalDeployed;
    const totalAvailable =
      bidAskStats.availableCapital +
      trendStats.availableCapital +
      insuranceStats.availableCapital;

    logger.info("总体:");
    logger.info(`  - 总已部署: $${totalDeployed.toFixed(2)} (${((totalDeployed / config.totalCapital) * 100).toFixed(1)}%)`);
    logger.info(`  - 总可用: $${totalAvailable.toFixed(2)} (${((totalAvailable / config.totalCapital) * 100).toFixed(1)}%)`);
  }

  /**
   * 处理执行失败逻辑，更新连续失败计数并根据配置触发熔断
   */
  private handleFailure(): void {
    this.circuitBreaker.consecutiveFailures++;
    this.circuitBreaker.lastFailureTime = new Date();

    logger.warn(
      `连续失败次数: ${this.circuitBreaker.consecutiveFailures}/${config.maxConsecutiveFailures}`
    );

    if (
      this.circuitBreaker.consecutiveFailures >= config.maxConsecutiveFailures
    ) {
      this.circuitBreaker.isTripped = true;
      logger.error(
        "⚠️  熔断器已触发！机器人将暂停 1 分钟。"
      );
    }
  }

  /**
   * 重置熔断器状态
   */
  private resetCircuitBreaker(): void {
    this.circuitBreaker.consecutiveFailures = 0;
    this.circuitBreaker.isTripped = false;
    logger.info("熔断器已重置");
  }

  /**
   * 获取当前机器人运行状态和各策略统计信息
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      poolAddress: this.poolAddress,
      circuitBreaker: this.circuitBreaker,
      bidAskStats: this.bidAskStrategy.getStats(),
      trendStats: this.trendStrategy.getStats(),
      insuranceStats: this.insuranceStrategy.getStats(),
    };
  }
}
