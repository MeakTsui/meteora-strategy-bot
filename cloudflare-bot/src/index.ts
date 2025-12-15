import { Env } from "./types";
import { createConfig } from "./config";
import { createRebalancer } from "./services/rebalancer";
import logger, { setLogLevel } from "./utils/logger";
import { dashboardHTML } from "./dashboard";

/**
 * CORS 头
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * JSON 响应
 */
function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

/**
 * 错误响应
 */
function errorResponse(message: string, status: number = 500): Response {
  return jsonResponse({ success: false, error: message }, status);
}

/**
 * 处理 API 请求
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS 预检
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 设置日志级别
  setLogLevel(env.LOG_LEVEL || "info");

  const config = createConfig(env);
  const rebalancer = createRebalancer(env, config);
  const valueTracker = rebalancer.getValueTracker();

  try {
    // ============================================================================
    // Dashboard API 路由
    // ============================================================================

    // 获取汇总数据
    if (path === "/api/summary" && request.method === "GET") {
      const summary = await valueTracker.getSummary();
      return jsonResponse({ success: true, data: summary });
    }

    // 获取最新仓位数据
    if (path === "/api/positions" && request.method === "GET") {
      const positions = await valueTracker.getLatestPositions();
      return jsonResponse({ success: true, data: positions });
    }

    // 获取每日 PnL 数据
    if (path === "/api/pnl" && request.method === "GET") {
      const days = parseInt(url.searchParams.get("days") || "30");
      const dailyPnL = await valueTracker.getDailyPnL(days);
      return jsonResponse({ success: true, data: dailyPnL });
    }

    // 获取价值历史
    if (path === "/api/value-history" && request.method === "GET") {
      const hours = parseInt(url.searchParams.get("hours") || "24");
      const history = await valueTracker.getValueHistory(hours);
      return jsonResponse({ success: true, data: history });
    }

    // 获取操作历史
    if (path === "/api/operations" && request.method === "GET") {
      const count = parseInt(url.searchParams.get("count") || "50");
      const operations = await valueTracker.getOperations(count);
      return jsonResponse({ success: true, data: operations });
    }

    // 获取已领取手续费历史
    if (path === "/api/claimed-fees" && request.method === "GET") {
      const count = parseInt(url.searchParams.get("count") || "50");
      const claimedFees = await valueTracker.getClaimedFees(count);
      return jsonResponse({ success: true, data: claimedFees });
    }

    // 获取手续费历史（用于图表）
    if (path === "/api/fee-history" && request.method === "GET") {
      const days = parseInt(url.searchParams.get("days") || "30");
      const feeHistory = await valueTracker.getFeeHistory(days);
      return jsonResponse({ success: true, data: feeHistory });
    }

    // ============================================================================
    // 手动触发路由
    // ============================================================================

    // 手动触发重新平衡检查
    if (path === "/api/rebalance" && request.method === "POST") {
      logger.info("收到手动触发重新平衡请求");
      const result = await rebalancer.checkAndRebalance();
      return jsonResponse({
        success: true,
        data: {
          checked: result.checked,
          rebalanced: result.rebalanced,
          totalValueUSD: result.totalValueUSD,
          currentPrice: result.currentPrice,
          timestamp: Date.now(),
        },
      });
    }

    // 手动触发手续费领取
    if (path === "/api/claim-fees" && request.method === "POST") {
      logger.info("收到手动触发手续费领取请求");
      const result = await rebalancer.checkAndClaimFees();
      return jsonResponse({
        success: true,
        data: {
          claimed: result.claimed,
          totalUSD: result.totalUSD,
          timestamp: Date.now(),
        },
      });
    }

    // ============================================================================
    // 健康检查
    // ============================================================================

    // Dashboard 页面
    if (path === "/" || path === "/dashboard") {
      return new Response(dashboardHTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...corsHeaders,
        },
      });
    }

    // 健康检查
    if (path === "/health") {
      return jsonResponse({
        success: true,
        service: "Meteora DLMM Bid-Ask Rebalancer",
        version: "1.0.0",
        timestamp: Date.now(),
      });
    }

    return errorResponse("Not Found", 404);

  } catch (error) {
    logger.error("请求处理失败:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

/**
 * 处理定时任务
 */
async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  setLogLevel(env.LOG_LEVEL || "info");
  logger.info(`定时任务触发: ${new Date(event.scheduledTime).toISOString()}`);

  const config = createConfig(env);
  const rebalancer = createRebalancer(env, config);

  try {
    // 执行重新平衡检查
    const result = await rebalancer.checkAndRebalance();
    logger.info(`检查完成: ${result.checked} 个仓位, ${result.rebalanced} 个重新平衡`);

    // 检查是否需要领取手续费（每天指定时间）
    const now = new Date();
    const currentHour = now.getUTCHours();

    if (currentHour === config.claimFeeCheckHour) {
      logger.info("到达手续费领取时间，开始检查...");
      const feeResult = await rebalancer.checkAndClaimFees();
      logger.info(`手续费领取完成: ${feeResult.claimed} 个仓位, 总计 $${feeResult.totalUSD.toFixed(2)}`);
    }

  } catch (error) {
    logger.error("定时任务执行失败:", error);
  }
}

/**
 * Cloudflare Worker 入口
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(event, env, ctx));
  },
};
