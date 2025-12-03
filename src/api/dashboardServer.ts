import express, { Request, Response } from 'express';
import path from 'path';
import { getValueTracker } from '../services/valueTracker';

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT || '3000');

// 获取 ValueTracker 实例
const valueTracker = getValueTracker();

// 静态文件服务
app.use(express.static(path.join(__dirname, '../dashboard')));

// CORS 支持
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ============================================================================
// API 路由
// ============================================================================

/**
 * 获取汇总数据
 */
app.get('/api/summary', (req: Request, res: Response) => {
  try {
    const summary = valueTracker.getSummary();
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 获取最新仓位数据
 */
app.get('/api/positions', (req: Request, res: Response) => {
  try {
    const positions = valueTracker.getLatestPositions();
    res.json({
      success: true,
      data: positions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 获取每日 PnL 数据
 */
app.get('/api/pnl', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const dailyPnL = valueTracker.getDailyPnL(days);
    res.json({
      success: true,
      data: dailyPnL,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 获取价值历史（用于图表）
 */
app.get('/api/value-history', (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const history = valueTracker.getValueHistory(hours);
    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 获取操作历史
 */
app.get('/api/operations', (req: Request, res: Response) => {
  try {
    const count = parseInt(req.query.count as string) || 50;
    const operations = valueTracker.getOperations(count);
    res.json({
      success: true,
      data: operations,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 获取最近快照
 */
app.get('/api/snapshots', (req: Request, res: Response) => {
  try {
    const count = parseInt(req.query.count as string) || 100;
    const snapshots = valueTracker.getRecentSnapshots(count);
    res.json({
      success: true,
      data: snapshots,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 获取已领取手续费历史
 */
app.get('/api/claimed-fees', (req: Request, res: Response) => {
  try {
    const count = parseInt(req.query.count as string) || 50;
    const claimedFees = valueTracker.getClaimedFees(count);
    res.json({
      success: true,
      data: claimedFees,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 获取手续费历史（用于图表）
 */
app.get('/api/fee-history', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const feeHistory = valueTracker.getFeeHistory(days);
    res.json({
      success: true,
      data: feeHistory,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// SSE 实时更新
// ============================================================================

const clients: Response[] = [];

app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.push(res);

  req.on('close', () => {
    const index = clients.indexOf(res);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
});

// 定期推送更新
setInterval(() => {
  if (clients.length > 0) {
    const summary = valueTracker.getSummary();
    const data = JSON.stringify(summary);
    clients.forEach(client => {
      client.write(`data: ${data}\n\n`);
    });
  }
}, 5000); // 每 5 秒推送一次

// ============================================================================
// 主页路由
// ============================================================================

app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../dashboard/index.html'));
});

// ============================================================================
// 启动服务器
// ============================================================================

export function startDashboardServer(): void {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                     Meteora DLMM Dashboard Server                            ║
╚══════════════════════════════════════════════════════════════════════════════╝

  🌐 Dashboard: http://localhost:${PORT}
  📊 API:       http://localhost:${PORT}/api/summary

  API Endpoints:
    GET /api/summary        - 获取汇总数据
    GET /api/positions      - 获取仓位数据
    GET /api/pnl?days=30    - 获取每日 PnL
    GET /api/value-history  - 获取价值历史
    GET /api/operations     - 获取操作历史
    GET /api/claimed-fees   - 获取已领取手续费历史
    GET /api/fee-history    - 获取手续费历史（图表）
    GET /api/events         - SSE 实时更新

`);
  });
}

// 如果直接运行此文件
if (require.main === module) {
  startDashboardServer();
}
