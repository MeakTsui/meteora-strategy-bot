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

    logger.info(`DLMM Bot initialized for pool: ${this.poolAddress}`);
    logger.info(`Capital allocation:`);
    logger.info(`  - Bid-Ask Strategy: $${config.totalCapital * config.mainAllocation}`);
    logger.info(`  - Trend Strategy: $${config.totalCapital * config.trendAllocation}`);
    logger.info(`  - Insurance Strategy: $${config.totalCapital * config.insuranceAllocation}`);
  }

  /**
   * 启动机器人
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Bot is already running");
      return;
    }

    this.isRunning = true;
    logger.info("🚀 Starting DLMM Strategy Bot...");

    if (config.enableDryRun) {
      logger.warn("⚠️  DRY RUN MODE ENABLED - No real transactions will be sent");
    }

    // 订阅价格更新，用于调试观察价格变化
    priceService.subscribePrice((price) => {
      logger.debug(`Price update: $${price.toFixed(2)}`);
    });

    // 启动主执行循环
    await this.executionLoop();
  }

  /**
   * 停止机器人
   */
  stop(): void {
    this.isRunning = false;
    logger.info("🛑 Stopping DLMM Strategy Bot...");
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
          logger.warn("Circuit breaker is tripped. Waiting before retry...");
          await sleep(60000); // Wait 1 minute
          this.resetCircuitBreaker();
          continue;
        }

        // 获取当前价格
        const currentPrice = await priceService.getPrice();
        
        if (currentPrice === 0) {
          logger.error("Failed to get valid price");
          this.handleFailure();
          await sleep(config.checkInterval);
          continue;
        }

        logger.info(`\n${"=".repeat(60)}`);
        logger.info(`Executing strategies at price: $${currentPrice.toFixed(2)}`);
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
        logger.error("Error in execution loop:", error);
        this.handleFailure();
      }

      // 等待下一个调度周期
      await sleep(config.checkInterval);
    }

    logger.info("Execution loop stopped");
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
      logger.info("📊 Executing Bid-Ask Strategy...");
      const bidAskResults = await this.bidAskStrategy.execute(currentPrice);
      results.push(...bidAskResults);

      // Execute Trend Strategy
      logger.info("📈 Executing Trend Strategy...");
      const trendResults = await this.trendStrategy.execute(currentPrice);
      results.push(...trendResults);

      // Execute Insurance Strategy
      logger.info("🛡️  Executing Insurance Strategy...");
      const insuranceResults = await this.insuranceStrategy.execute(
        currentPrice
      );
      results.push(...insuranceResults);
    } catch (error) {
      logger.error("Error executing strategies:", error);
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
      logger.info("No actions taken");
      return;
    }

    logger.info("\n📋 Execution Results:");
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

    logger.info("\n📊 Strategy Statistics:");
    logger.info("Bid-Ask Strategy:");
    logger.info(`  - Active Positions: ${bidAskStats.activePositions}`);
    logger.info(`  - Deployed: $${bidAskStats.totalDeployed.toFixed(2)}`);
    logger.info(`  - Available: $${bidAskStats.availableCapital.toFixed(2)}`);
    logger.info(`  - Compound Count: ${bidAskStats.compoundCount}`);

    logger.info("Trend Strategy:");
    logger.info(`  - Active Positions: ${trendStats.activePositions}`);
    logger.info(`  - Deployed: $${trendStats.totalDeployed.toFixed(2)}`);
    logger.info(`  - Available: $${trendStats.availableCapital.toFixed(2)}`);
    logger.info(`  - Trend: ${trendStats.trendDirection || "None"}`);
    logger.info(`  - Breakouts: ${trendStats.consecutiveBreakouts}`);

    logger.info("Insurance Strategy:");
    logger.info(`  - Active Positions: ${insuranceStats.activePositions}`);
    logger.info(`  - Deployed: $${insuranceStats.totalDeployed.toFixed(2)}`);
    logger.info(`  - Available: $${insuranceStats.availableCapital.toFixed(2)}`);

    const totalDeployed =
      bidAskStats.totalDeployed +
      trendStats.totalDeployed +
      insuranceStats.totalDeployed;
    const totalAvailable =
      bidAskStats.availableCapital +
      trendStats.availableCapital +
      insuranceStats.availableCapital;

    logger.info("Overall:");
    logger.info(`  - Total Deployed: $${totalDeployed.toFixed(2)} (${((totalDeployed / config.totalCapital) * 100).toFixed(1)}%)`);
    logger.info(`  - Total Available: $${totalAvailable.toFixed(2)} (${((totalAvailable / config.totalCapital) * 100).toFixed(1)}%)`);
  }

  /**
   * 处理执行失败逻辑，更新连续失败计数并根据配置触发熔断
   */
  private handleFailure(): void {
    this.circuitBreaker.consecutiveFailures++;
    this.circuitBreaker.lastFailureTime = new Date();

    logger.warn(
      `Consecutive failures: ${this.circuitBreaker.consecutiveFailures}/${config.maxConsecutiveFailures}`
    );

    if (
      this.circuitBreaker.consecutiveFailures >= config.maxConsecutiveFailures
    ) {
      this.circuitBreaker.isTripped = true;
      logger.error(
        "⚠️  Circuit breaker tripped! Bot will pause for 1 minute."
      );
    }
  }

  /**
   * 重置熔断器状态
   */
  private resetCircuitBreaker(): void {
    this.circuitBreaker.consecutiveFailures = 0;
    this.circuitBreaker.isTripped = false;
    logger.info("Circuit breaker reset");
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
