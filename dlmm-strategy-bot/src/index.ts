import { DLMMBot } from "./core/bot";
import { validateConfig } from "./config/config";
import logger from "./utils/logger";

/**
 * DLMM 策略机器人主入口
 */
async function main() {
  try {
    logger.info("☄️  METEORA DLMM 策略机器人 ☄️");
    logger.info("================================\n");

    // 校验配置
    logger.info("正在校验配置...");
    validateConfig();
    logger.info("✅ 配置校验通过\n");

    // 创建并启动机器人
    const bot = new DLMMBot();
    
    // 处理优雅关闭
    process.on("SIGINT", () => {
      logger.info("\n收到 SIGINT 信号");
      bot.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      logger.info("\n收到 SIGTERM 信号");
      bot.stop();
      process.exit(0);
    });

    // 启动机器人
    await bot.start();
  } catch (error) {
    logger.error("致命错误:", error);
    process.exit(1);
  }
}

// 如果是主模块则运行
if (require.main === module) {
  main();
}

export { DLMMBot };
