import { dlmmService } from "./services/dlmmService";
import { rangeManager } from "./services/rangeManager";
import { config } from "./config/config";
import { PositionSide } from "./types";
import logger from "./utils/logger";

/**
 * 仓位模拟器 —— 测试仓位创建，不发送真实交易
 */
class Simulator {
  /**
   * 模拟在多个区间中创建仓位
   */
  async simulatePositions(): Promise<void> {
    logger.info("\n🧪 Starting Position Simulation...\n");
    logger.info(`Total Capital: $${config.totalCapital}`);
    logger.info(`Dry Run Mode: ${config.enableDryRun}\n`);

    const poolAddress = dlmmService.getDefaultPoolAddress();
    const ranges = rangeManager.getAllRanges();
    
    // 选择几个样本区间进行模拟
    const sampleRanges = ranges.filter(
      (r, index) => index % 5 === 0 // 每第 5 个区间
    ).slice(0, 5);

    logger.info(`Simulating positions in ${sampleRanges.length} ranges:\n`);

    for (const range of sampleRanges) {
      try {
        logger.info(`\n${"─".repeat(50)}`);
        logger.info(`Range: $${range.lower} - $${range.upper}`);
        logger.info(`${"─".repeat(50)}`);

        const positionSize = 100; // 每个仓位 $100
        const currentPrice = (range.lower + range.upper) / 2;

        // 模拟不同类型的仓位
        const sides = [
          PositionSide.SOL_ONLY,
          PositionSide.USDC_ONLY,
          PositionSide.BALANCED,
        ];

        for (const side of sides) {
          logger.info(`\n  📊 Testing ${side} position:`);

          // 获取模拟结果
          const simulation = await dlmmService.simulate(
            poolAddress,
            range,
            side,
            positionSize,
            currentPrice
          );

          logger.info(`    Position Size: $${positionSize}`);
          logger.info(`    Current Price: $${currentPrice.toFixed(2)}`);
          logger.info(`    Estimated APR: ${simulation.estimatedAPR.toFixed(2)}%`);
          logger.info(
            `    Daily Yield: $${simulation.estimatedDailyYield.toFixed(2)}`
          );
          logger.info(
            `    Liquidity Value: $${simulation.liquidityValue.toFixed(2)}`
          );

          // If not in dry run, would create actual position
          if (config.enableDryRun) {
            logger.info(`    [DRY RUN] Position not actually created`);
          }
        }
      } catch (error) {
        logger.error(
          `  ❌ Simulation failed for range ${range.lower}-${range.upper}:`,
          error
        );
      }
    }

    logger.info(`\n${"=".repeat(50)}`);
    logger.info("✅ Simulation Complete");
    logger.info(`${"=".repeat(50)}\n`);
  }

  /**
   * 模拟策略资金分配
   */
  async simulateAllocation(): Promise<void> {
    logger.info("\n💰 Simulating Capital Allocation...\n");

    const bidAskCapital = config.totalCapital * config.mainAllocation;
    const trendCapital = config.totalCapital * config.trendAllocation;
    const insuranceCapital = config.totalCapital * config.insuranceAllocation;

    logger.info("Strategy Allocations:");
    logger.info(`  Bid-Ask Strategy: $${bidAskCapital.toFixed(2)} (${(config.mainAllocation * 100).toFixed(0)}%)`);
    logger.info(`  Trend Strategy: $${trendCapital.toFixed(2)} (${(config.trendAllocation * 100).toFixed(0)}%)`);
    logger.info(`  Insurance Strategy: $${insuranceCapital.toFixed(2)} (${(config.insuranceAllocation * 100).toFixed(0)}%)`);

    logger.info(`\n📊 Bid-Ask Strategy Distribution:`);
    const ranges = rangeManager.getAllRanges();
    const positionsPerRange = 10; // Max positions
    const bidAskPerPosition = bidAskCapital / positionsPerRange;
    
    logger.info(`  Max Active Positions: ${positionsPerRange}`);
    logger.info(`  Capital per Position: $${bidAskPerPosition.toFixed(2)}`);
    logger.info(`  Total Ranges Available: ${ranges.length}`);

    logger.info(`\n📈 Trend Strategy:`);
    const maxTrendPositions = 3;
    const trendPerPosition = trendCapital / maxTrendPositions;
    
    logger.info(`  Max Active Positions: ${maxTrendPositions}`);
    logger.info(`  Capital per Position: $${trendPerPosition.toFixed(2)}`);

    logger.info(`\n🛡️  Insurance Strategy:`);
    const insuranceRanges = config.insuranceRanges;
    const insurancePerRange = insuranceCapital / insuranceRanges.length;
    
    logger.info(`  Insurance Ranges: ${insuranceRanges.length}`);
    insuranceRanges.forEach((range, i) => {
      logger.info(`    ${i + 1}. $${range.lower}-${range.upper}: $${insurancePerRange.toFixed(2)}`);
    });

    logger.info(`\n💡 Recommendations:`);
    if (bidAskPerPosition < 50) {
      logger.warn(`  ⚠️  Bid-Ask position size may be too small (<$50)`);
    }
    if (trendPerPosition < 100) {
      logger.warn(`  ⚠️  Trend position size may be too small (<$100)`);
    }
    if (insurancePerRange < 50) {
      logger.warn(`  ⚠️  Insurance position size may be too small (<$50)`);
    }

    logger.info(`\n✅ Allocation simulation complete\n`);
  }
}

// Main execution
async function main() {
  try {
    const simulator = new Simulator();
    
    // Run allocation simulation
    await simulator.simulateAllocation();
    
    // Run position simulation
    await simulator.simulatePositions();

  } catch (error) {
    logger.error("Simulation failed:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { Simulator };
