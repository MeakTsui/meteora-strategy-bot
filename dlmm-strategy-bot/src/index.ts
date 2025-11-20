import { DLMMBot } from "./core/bot";
import { validateConfig } from "./config/config";
import logger from "./utils/logger";

/**
 * DLMM 策略机器人主入口
 */
async function main() {
  try {
    logger.info("☄️  METEORA DLMM STRATEGY BOT ☄️");
    logger.info("================================\n");

    // 校验配置
    logger.info("Validating configuration...");
    validateConfig();
    logger.info("✅ Configuration validated\n");

    // 创建并启动机器人
    const bot = new DLMMBot();
    
    // 处理优雅关闭
    process.on("SIGINT", () => {
      logger.info("\nReceived SIGINT signal");
      bot.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      logger.info("\nReceived SIGTERM signal");
      bot.stop();
      process.exit(0);
    });

    // 启动机器人
    await bot.start();
  } catch (error) {
    logger.error("Fatal error:", error);
    process.exit(1);
  }
}

// 如果是主模块则运行
if (require.main === module) {
  main();
}

export { DLMMBot };
