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
    logger.info("\n🧪 开始仓位模拟...\n");
    logger.info(`总资金: $${config.totalCapital}`);
    logger.info(`Dry Run 模式: ${config.enableDryRun}\n`);

    const poolAddress = dlmmService.getDefaultPoolAddress();
    const ranges = rangeManager.getAllRanges();
    
    // 选择几个样本区间进行模拟
    const sampleRanges = ranges.filter(
      (r, index) => index % 5 === 0 // 每第 5 个区间
    ).slice(0, 5);

    logger.info(`模拟 ${sampleRanges.length} 个区间的仓位:\n`);

    for (const range of sampleRanges) {
      try {
        logger.info(`\n${"─".repeat(50)}`);
        logger.info(`区间: $${range.lower} - $${range.upper}`);
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
          logger.info(`\n  📊 测试 ${side} 仓位:`);

          // 获取模拟结果
          const simulation = await dlmmService.simulate(
            poolAddress,
            range,
            side,
            positionSize,
            currentPrice
          );

          logger.info(`    仓位大小: $${positionSize}`);
          logger.info(`    当前价格: $${currentPrice.toFixed(2)}`);
          logger.info(`    预估 APR: ${simulation.estimatedAPR.toFixed(2)}%`);
          logger.info(
            `    日收益: $${simulation.estimatedDailyYield.toFixed(2)}`
          );
          logger.info(
            `    流动性价值: $${simulation.liquidityValue.toFixed(2)}`
          );

          // If not in dry run, would create actual position
          if (config.enableDryRun) {
            logger.info(`    [DRY RUN] 仓位未实际创建`);
          }
        }
      } catch (error) {
        logger.error(
          `  ❌ 区间 ${range.lower}-${range.upper} 模拟失败:`,
          error
        );
      }
    }

    logger.info(`\n${"=".repeat(50)}`);
    logger.info("✅ 模拟完成");
    logger.info(`${"=".repeat(50)}\n`);
  }

  /**
   * 模拟策略资金分配
   */
  async simulateAllocation(): Promise<void> {
    logger.info("\n💰 模拟资金分配...\n");

    const bidAskCapital = config.totalCapital * config.mainAllocation;
    const trendCapital = config.totalCapital * config.trendAllocation;
    const insuranceCapital = config.totalCapital * config.insuranceAllocation;

    logger.info("策略资金分配:");
    logger.info(`  Bid-Ask 策略: $${bidAskCapital.toFixed(2)} (${(config.mainAllocation * 100).toFixed(0)}%)`);
    logger.info(`  趋势策略: $${trendCapital.toFixed(2)} (${(config.trendAllocation * 100).toFixed(0)}%)`);
    logger.info(`  保险策略: $${insuranceCapital.toFixed(2)} (${(config.insuranceAllocation * 100).toFixed(0)}%)`);

    logger.info(`\n📊 Bid-Ask 策略分布:`);
    const ranges = rangeManager.getAllRanges();
    const positionsPerRange = 10; // Max positions
    const bidAskPerPosition = bidAskCapital / positionsPerRange;
    
    logger.info(`  最大活跃仓位: ${positionsPerRange}`);
    logger.info(`  每仓位资金: $${bidAskPerPosition.toFixed(2)}`);
    logger.info(`  可用总区间: ${ranges.length}`);

    logger.info(`\n📈 趋势策略:`);
    const maxTrendPositions = 3;
    const trendPerPosition = trendCapital / maxTrendPositions;
    
    logger.info(`  最大活跃仓位: ${maxTrendPositions}`);
    logger.info(`  每仓位资金: $${trendPerPosition.toFixed(2)}`);

    logger.info(`\n🛡️  保险策略:`);
    const insuranceRanges = config.insuranceRanges;
    const insurancePerRange = insuranceCapital / insuranceRanges.length;
    
    logger.info(`  保险区间数: ${insuranceRanges.length}`);
    insuranceRanges.forEach((range, i) => {
      logger.info(`    ${i + 1}. $${range.lower}-${range.upper}: $${insurancePerRange.toFixed(2)}`);
    });

    logger.info(`\n💡 建议:`);
    if (bidAskPerPosition < 50) {
      logger.warn(`  ⚠️  Bid-Ask 仓位大小可能过小 (<$50)`);
    }
    if (trendPerPosition < 100) {
      logger.warn(`  ⚠️  趋势仓位大小可能过小 (<$100)`);
    }
    if (insurancePerRange < 50) {
      logger.warn(`  ⚠️  保险仓位大小可能过小 (<$50)`);
    }

    logger.info(`\n✅ 资金分配模拟完成\n`);
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
    logger.error("模拟失败:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { Simulator };
