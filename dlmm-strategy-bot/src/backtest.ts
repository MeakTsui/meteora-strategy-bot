import { BacktestResult, RangeResult, PriceRange } from "./types";
import { rangeManager } from "./services/rangeManager";
import { config } from "./config/config";
import logger from "./utils/logger";

/**
 * 回测模拟器，用于策略验证
 * 使用历史价格数据模拟策略表现
 */
class Backtester {
  private historicalPrices: Array<{ price: number; timestamp: Date }> = [];

  /**
   * 生成过去 30 天的模拟历史价格
   * 生产环境中应该从真实数据源获取历史数据
   */
  private generateHistoricalPrices(): void {
    const days = 30;
    const intervalsPerDay = 24; // 每小时数据
    const totalIntervals = days * intervalsPerDay;
    
    const startPrice = 140; // SOL 起始价格
    let currentPrice = startPrice;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    for (let i = 0; i < totalIntervals; i++) {
      // 使用随机游走模拟价格变动
      const volatility = 0.02; // 每小时 2% 波动率
      const randomChange = (Math.random() - 0.5) * 2 * volatility;
      currentPrice = currentPrice * (1 + randomChange);
      
      // 保持价格在边界内
      currentPrice = Math.max(
        config.minPrice + 10,
        Math.min(config.maxPrice - 10, currentPrice)
      );

      const timestamp = new Date(
        startDate.getTime() + i * 60 * 60 * 1000
      );

      this.historicalPrices.push({
        price: currentPrice,
        timestamp,
      });
    }

    logger.info(
      `Generated ${this.historicalPrices.length} historical price points`
    );
    logger.info(
      `Price range: $${Math.min(...this.historicalPrices.map((p) => p.price)).toFixed(2)} - $${Math.max(...this.historicalPrices.map((p) => p.price)).toFixed(2)}`
    );
  }

  /**
   * 运行回测模拟
   */
  async run(): Promise<BacktestResult> {
    logger.info("\n🔄 Starting Backtest Simulation...\n");

    // Generate historical prices
    this.generateHistoricalPrices();

    const ranges = rangeManager.getAllRanges();
    const rangeResults: RangeResult[] = [];
    
    let totalProfit = 0;
    let totalFees = 0;
    let totalTrades = 0;
    let successfulTrades = 0;
    let maxDrawdown = 0;
    let compoundCount = 0;

    // Track positions per range
    const rangePositions = new Map<
      string,
      {
        range: PriceRange;
        isActive: boolean;
        entryPrice: number;
        capital: number;
        trades: number;
        profit: number;
        fees: number;
        totalHoldTime: number;
      }
    >();

    // Initialize range tracking
    ranges.forEach((range) => {
      rangePositions.set(range.id, {
        range,
        isActive: false,
        entryPrice: 0,
        capital: 0,
        trades: 0,
        profit: 0,
        fees: 0,
        totalHoldTime: 0,
      });
    });

    // Simulate strategy execution over historical data
    for (let i = 0; i < this.historicalPrices.length; i++) {
      const { price, timestamp } = this.historicalPrices[i];
      const currentRange = rangeManager.findCurrentRange(price);

      if (!currentRange) continue;

      const rangeData = rangePositions.get(currentRange.id);
      if (!rangeData) continue;

      // Check for entry
      if (!rangeData.isActive) {
        // Simulate position entry in current range
        rangeData.isActive = true;
        rangeData.entryPrice = price;
        rangeData.capital = config.totalCapital * config.mainAllocation / ranges.length;
        rangeData.trades++;
        totalTrades++;
      }

      // Check for exit (price breaks above range with threshold)
      if (rangeData.isActive) {
        const upperThreshold = currentRange.upper * (1 + config.redeployThreshold);
        
        if (price > upperThreshold) {
          // Calculate profit
          const priceGain = (price - rangeData.entryPrice) / rangeData.entryPrice;
          const tradeProfit = rangeData.capital * priceGain;
          const tradeFees = rangeData.capital * 0.001; // 0.1% estimated fees

          rangeData.profit += tradeProfit - tradeFees;
          rangeData.fees += tradeFees;
          totalProfit += tradeProfit;
          totalFees += tradeFees;
          successfulTrades++;
          compoundCount++;

          // Reset position
          rangeData.isActive = false;
          rangeData.capital = 0;

          logger.debug(
            `Trade in range ${currentRange.lower}-${currentRange.upper}: +$${tradeProfit.toFixed(2)}`
          );
        }
      }
    }

    // Calculate range results
    rangePositions.forEach((data) => {
      if (data.trades > 0) {
        rangeResults.push({
          range: data.range,
          trades: data.trades,
          profit: data.profit,
          fees: data.fees,
          avgHoldTime: data.totalHoldTime / data.trades,
        });
      }
    });

    // Calculate max drawdown (simplified)
    let peak = config.totalCapital;
    for (let i = 0; i < this.historicalPrices.length; i++) {
      const currentValue = config.totalCapital + (totalProfit * i / this.historicalPrices.length);
      peak = Math.max(peak, currentValue);
      const drawdown = (peak - currentValue) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    // Calculate annualized return
    const days = this.historicalPrices.length / 24;
    const totalReturn = totalProfit / config.totalCapital;
    const annualizedReturn = (totalReturn * 365) / days;

    const result: BacktestResult = {
      totalTrades,
      successfulTrades,
      totalProfit,
      totalFees,
      maxDrawdown,
      annualizedReturn,
      compoundCount,
      rangeResults,
    };

    this.logResults(result);

    return result;
  }

  /**
   * 输出回测结果
   */
  private logResults(result: BacktestResult): void {
    logger.info("\n" + "=".repeat(60));
    logger.info("📊 BACKTEST RESULTS");
    logger.info("=".repeat(60));
    
    logger.info(`\n📈 Trading Statistics:`);
    logger.info(`  Total Trades: ${result.totalTrades}`);
    logger.info(`  Successful Trades: ${result.successfulTrades}`);
    logger.info(`  Success Rate: ${((result.successfulTrades / result.totalTrades) * 100).toFixed(2)}%`);
    logger.info(`  Compound Count: ${result.compoundCount}`);

    logger.info(`\n💰 Profit & Loss:`);
    logger.info(`  Total Profit: $${result.totalProfit.toFixed(2)}`);
    logger.info(`  Total Fees: $${result.totalFees.toFixed(2)}`);
    logger.info(`  Net Profit: $${(result.totalProfit - result.totalFees).toFixed(2)}`);
    logger.info(`  Return: ${((result.totalProfit - result.totalFees) / config.totalCapital * 100).toFixed(2)}%`);

    logger.info(`\n📉 Risk Metrics:`);
    logger.info(`  Max Drawdown: ${(result.maxDrawdown * 100).toFixed(2)}%`);
    logger.info(`  Annualized Return: ${(result.annualizedReturn * 100).toFixed(2)}%`);

    logger.info(`\n🎯 Top Performing Ranges:`);
    const topRanges = result.rangeResults
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    topRanges.forEach((rangeResult, index) => {
      logger.info(
        `  ${index + 1}. Range ${rangeResult.range.lower}-${rangeResult.range.upper}: ` +
        `${rangeResult.trades} trades, $${rangeResult.profit.toFixed(2)} profit`
      );
    });

    logger.info("\n" + "=".repeat(60) + "\n");
  }
}

// Main execution
async function main() {
  try {
    const backtester = new Backtester();
    await backtester.run();
  } catch (error) {
    logger.error("Backtest failed:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { Backtester };
