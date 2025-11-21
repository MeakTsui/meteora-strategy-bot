import winston from "winston";
import path from "path";
import { logConfig } from "../config/config";

/**
 * 创建日志实例，同时输出到文件和控制台
 */
const logger = winston.createLogger({
  level: logConfig.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(
          ({ timestamp, level, message, ...meta }) =>
            `${timestamp} [${level}]: ${message} ${
              Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ""
            }`
        )
      ),
    }),
    // 每日日志文件
    new winston.transports.File({
      filename: path.join(
        "logs",
        `${new Date().toISOString().split("T")[0]}.log`
      ),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
    // 错误日志文件
    new winston.transports.File({
      filename: path.join("logs", "error.log"),
      level: "error",
    }),
  ],
});

export default logger;
