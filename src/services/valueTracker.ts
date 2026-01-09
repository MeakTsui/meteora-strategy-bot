import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

// ============================================================================
// 类型定义
// ============================================================================

export interface PositionValue {
  publicKey: string;
  valueUSD: number;
  xAmount: number;        // SOL 原始值
  yAmount: number;        // USDC 原始值
  xValueUSD: number;      // SOL 的 USD 价值
  yValueUSD: number;      // USDC 的 USD 价值
  priceRange: [number, number];  // [minPrice, maxPrice]
  binCount: number;
  // 未领取手续费
  feeX: number;           // 未领取 SOL 手续费（原始值）
  feeY: number;           // 未领取 USDC 手续费（原始值）
  feeXUSD: number;        // SOL 手续费 USD 价值
  feeYUSD: number;        // USDC 手续费 USD 价值
  totalFeeUSD: number;    // 总手续费 USD 价值
  // 买卖均价
  positionType: 'bid' | 'ask' | 'mixed';  // 仓位类型
  solRatio: number;                        // SOL 占比 (0-1)
  currentAvgPrice: number;                 // 当前状态的加权均价
  lastBidPrice: number | null;             // 上次全 USDC 时的买入均价
  lastAskPrice: number | null;             // 上次全 SOL 时的卖出均价
}

export interface PositionPriceRecord {
  id?: number;
  positionKey: string;
  timestamp: number;
  priceType: 'bid' | 'ask';
  avgPrice: number;
  amount: number;          // USDC 或 SOL 数量
}

export interface ValueSnapshot {
  id?: number;
  timestamp: number;
  totalValueUSD: number;
  currentPrice: number;   // 当前活跃 bin 的价格
  positions: PositionValue[];
}

export interface OperationRecord {
  id?: number;
  timestamp: number;
  positionKey: string;
  action: 'bid' | 'ask';
  beforeValueUSD: number;
  afterValueUSD: number;
  amountProcessed: number;  // 处理的金额
  txSignature?: string;
}

export interface DailyPnL {
  id?: number;
  date: string;           // YYYY-MM-DD
  openValue: number;      // 当日开盘价值
  closeValue: number;     // 当日收盘价值
  highValue: number;      // 当日最高价值
  lowValue: number;       // 当日最低价值
  pnl: number;            // 绝对收益
  pnlPercent: number;     // 收益率 %
  operations: number;     // 操作次数
}

export interface TrackerSummary {
  currentTotalValue: number;
  todayPnL: number;
  todayPnLPercent: number;
  totalPnL: number;
  totalPnLPercent: number;
  apy7d: number;
  apy30d: number;
  positionCount: number;
  todayOperations: number;
  firstSnapshotDate: string | null;
  lastUpdateTime: number;
  // 手续费相关
  totalUnclaimedFeeUSD: number;    // 当前未领取手续费
  totalClaimedFeeUSD: number;      // 累计已领取手续费
  todayClaimedFeeUSD: number;      // 今日已领取手续费
  feeAPY7d: number;                // 7日手续费 APY
  // 累积待复投手续费
  totalAccumulatedFeeUSD: number;  // 已领取但未复投的手续费总额
  accumulatedFeeX: number;         // 累积的 SOL 手续费（原始值）
  accumulatedFeeY: number;         // 累积的 USDC 手续费（原始值）
}

export interface ClaimedFeeRecord {
  id?: number;
  timestamp: number;
  positionKey: string;
  txSignature: string;
  claimedX: number;           // SOL 原始值
  claimedY: number;           // USDC 原始值
  claimedXUSD: number;
  claimedYUSD: number;
  totalClaimedUSD: number;
  priceAtClaim: number;
}

// ============================================================================
// 价值追踪服务 (SQLite3)
// ============================================================================

// 快照间隔配置（毫秒）
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟

export class ValueTracker {
  private db: Database.Database;
  private dataDir: string;
  private dbPath: string;
  private lastSnapshotTime: number = 0;
  private lastSnapshot: ValueSnapshot | null = null;

  constructor(dataDir?: string) {
    // 使用 __dirname 确保路径相对于此文件位置
    this.dataDir = dataDir || path.join(__dirname, '..', 'data');
    this.dbPath = path.join(this.dataDir, 'tracker.db');

    this.ensureDataDir();
    console.log(`[ValueTracker] 数据库: ${this.dbPath}`);
    
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');  // 启用 WAL 模式提高性能
    this.initTables();
    
    // 从数据库加载最后一次快照时间
    const lastRecord = this.db.prepare(
      'SELECT timestamp FROM snapshots ORDER BY timestamp DESC LIMIT 1'
    ).get() as { timestamp: number } | undefined;
    if (lastRecord) {
      this.lastSnapshotTime = lastRecord.timestamp;
    }
  }

  /**
   * 确保数据目录存在
   */
  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 初始化数据库表
   */
  private initTables(): void {
    // 快照表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        total_value_usd REAL NOT NULL,
        current_price REAL NOT NULL,
        positions TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp);
    `);

    // 操作记录表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        position_key TEXT NOT NULL,
        action TEXT NOT NULL,
        before_value_usd REAL NOT NULL,
        after_value_usd REAL NOT NULL,
        amount_processed REAL NOT NULL,
        tx_signature TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_operations_timestamp ON operations(timestamp);
    `);

    // 每日 PnL 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_pnl (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        open_value REAL NOT NULL,
        close_value REAL NOT NULL,
        high_value REAL NOT NULL,
        low_value REAL NOT NULL,
        pnl REAL NOT NULL,
        pnl_percent REAL NOT NULL,
        operations INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_daily_pnl_date ON daily_pnl(date);
    `);

    // 已领取手续费记录表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS claimed_fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        position_key TEXT NOT NULL,
        tx_signature TEXT UNIQUE,
        claimed_x REAL NOT NULL,
        claimed_y REAL NOT NULL,
        claimed_x_usd REAL NOT NULL,
        claimed_y_usd REAL NOT NULL,
        total_claimed_usd REAL NOT NULL,
        price_at_claim REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_claimed_fees_timestamp ON claimed_fees(timestamp);
      CREATE INDEX IF NOT EXISTS idx_claimed_fees_position ON claimed_fees(position_key);
    `);

    // 仓位价格历史表（记录买入/卖出均价）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS position_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        price_type TEXT NOT NULL,
        avg_price REAL NOT NULL,
        amount REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_position_price_key ON position_price_history(position_key);
      CREATE INDEX IF NOT EXISTS idx_position_price_type ON position_price_history(position_key, price_type);
    `);

    // 累积手续费表（记录已领取但未复投的手续费）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accumulated_fees (
        position_key TEXT PRIMARY KEY,
        fee_x REAL NOT NULL DEFAULT 0,
        fee_y REAL NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  /**
   * 清理旧数据
   */
  private cleanOldData(): void {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

    this.db.prepare('DELETE FROM snapshots WHERE timestamp < ?').run(thirtyDaysAgo);
    this.db.prepare('DELETE FROM operations WHERE timestamp < ?').run(ninetyDaysAgo);
  }

  /**
   * 计算单个仓位的 USD 价值
   */
  calculatePositionValue(
    binDistribution: { binId: number; price: number; xAmount: number; yAmount: number }[],
    tokenXDecimals: number,
    tokenYDecimals: number
  ): { totalValueUSD: number; xValueUSD: number; yValueUSD: number } {
    let xValueUSD = 0;
    let yValueUSD = 0;

    for (const bin of binDistribution) {
      // X (SOL) 的价值 = X 数量 * bin 价格
      xValueUSD += (bin.xAmount / Math.pow(10, tokenXDecimals)) * bin.price;
      // Y (USDC) 的价值 = Y 数量（已经是 USD）
      yValueUSD += bin.yAmount / Math.pow(10, tokenYDecimals);
    }

    return {
      totalValueUSD: xValueUSD + yValueUSD,
      xValueUSD,
      yValueUSD,
    };
  }

  /**
   * 计算加权平均价格
   */
  private calculateWeightedAvgPrice(
    binDistribution: { binId: number; price: number; xAmount: number; yAmount: number }[],
    tokenXDecimals: number,
    tokenYDecimals: number,
    solRatio: number
  ): { avgPrice: number; positionType: 'bid' | 'ask' | 'mixed' } {
    let totalValue = 0;
    let totalSOL = 0;

    for (const bin of binDistribution) {
      const xAmount = bin.xAmount / Math.pow(10, tokenXDecimals);
      const yAmount = bin.yAmount / Math.pow(10, tokenYDecimals);
      
      // SOL 部分的价值
      totalValue += xAmount * bin.price;
      totalSOL += xAmount;
      
      // USDC 部分可以买多少 SOL
      if (bin.price > 0) {
        totalValue += yAmount;
        totalSOL += yAmount / bin.price;
      }
    }

    const avgPrice = totalSOL > 0 ? totalValue / totalSOL : 0;
    
    // 判断仓位类型
    let positionType: 'bid' | 'ask' | 'mixed';
    if (solRatio >= 0.95) {
      positionType = 'ask';  // 全是 SOL，待卖出
    } else if (solRatio <= 0.05) {
      positionType = 'bid';  // 全是 USDC，待买入
    } else {
      positionType = 'mixed';
    }

    return { avgPrice, positionType };
  }

  /**
   * 获取仓位的历史买卖均价
   */
  private getLastPrices(positionKey: string): { lastBidPrice: number | null; lastAskPrice: number | null } {
    const bidRecord = this.db.prepare(
      'SELECT avg_price FROM position_price_history WHERE position_key = ? AND price_type = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(positionKey, 'bid') as { avg_price: number } | undefined;

    const askRecord = this.db.prepare(
      'SELECT avg_price FROM position_price_history WHERE position_key = ? AND price_type = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(positionKey, 'ask') as { avg_price: number } | undefined;

    return {
      lastBidPrice: bidRecord?.avg_price ?? null,
      lastAskPrice: askRecord?.avg_price ?? null,
    };
  }

  /**
   * 用于追踪每个仓位的上次 SOL 占比
   */
  private lastSolRatios: Map<string, number> = new Map();

  /**
   * 检测状态变化并记录价格
   */
  private checkAndRecordPriceChange(
    positionKey: string,
    solRatio: number,
    avgPrice: number,
    xValueUSD: number,
    yValueUSD: number
  ): void {
    const lastRatio = this.lastSolRatios.get(positionKey);
    
    // 首次记录或状态变化时记录
    if (lastRatio !== undefined) {
      // 从非全 SOL 变成全 SOL → 记录卖出均价
      if (solRatio >= 0.95 && lastRatio < 0.95) {
        this.recordPositionPrice(positionKey, 'ask', avgPrice, xValueUSD);
        console.log(`[ValueTracker] 仓位 ${positionKey.slice(0, 8)}... 记录卖出均价: $${avgPrice.toFixed(4)}`);
      }
      
      // 从非全 USDC 变成全 USDC → 记录买入均价
      if (solRatio <= 0.05 && lastRatio > 0.05) {
        this.recordPositionPrice(positionKey, 'bid', avgPrice, yValueUSD);
        console.log(`[ValueTracker] 仓位 ${positionKey.slice(0, 8)}... 记录买入均价: $${avgPrice.toFixed(4)}`);
      }
    } else {
      // 首次记录，根据当前状态记录
      if (solRatio >= 0.95) {
        this.recordPositionPrice(positionKey, 'ask', avgPrice, xValueUSD);
      } else if (solRatio <= 0.05) {
        this.recordPositionPrice(positionKey, 'bid', avgPrice, yValueUSD);
      }
    }

    this.lastSolRatios.set(positionKey, solRatio);
  }

  /**
   * 记录仓位价格到数据库
   */
  private recordPositionPrice(
    positionKey: string,
    priceType: 'bid' | 'ask',
    avgPrice: number,
    amount: number
  ): void {
    this.db.prepare(`
      INSERT INTO position_price_history (position_key, timestamp, price_type, avg_price, amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(positionKey, Date.now(), priceType, avgPrice, amount);
  }

  /**
   * 记录价值快照（每 10 分钟记录一次到数据库）
   * 返回当前计算的快照数据（无论是否写入数据库）
   */
  takeSnapshot(
    positions: {
      publicKey: string;
      binDistribution: { binId: number; price: number; xAmount: number; yAmount: number }[];
      lowerBinId: number;
      upperBinId: number;
      totalXAmount: number;
      totalYAmount: number;
      feeX: number;
      feeY: number;
    }[],
    currentPrice: number,
    tokenXDecimals: number,
    tokenYDecimals: number
  ): ValueSnapshot {
    const positionValues: PositionValue[] = [];
    let totalValueUSD = 0;

    for (const pos of positions) {
      const { totalValueUSD: posValue, xValueUSD, yValueUSD } = this.calculatePositionValue(
        pos.binDistribution,
        tokenXDecimals,
        tokenYDecimals
      );

      // 计算价格范围
      const prices = pos.binDistribution.map(b => b.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      // 计算手续费 USD 价值
      const feeXUSD = (pos.feeX / Math.pow(10, tokenXDecimals)) * currentPrice;
      const feeYUSD = pos.feeY / Math.pow(10, tokenYDecimals);
      const totalFeeUSD = feeXUSD + feeYUSD;

      // 计算 SOL 占比和加权均价
      const solRatio = posValue > 0 ? xValueUSD / posValue : 0;
      const { avgPrice, positionType } = this.calculateWeightedAvgPrice(
        pos.binDistribution,
        tokenXDecimals,
        tokenYDecimals,
        solRatio
      );

      // 获取历史记录的买卖均价
      const { lastBidPrice, lastAskPrice } = this.getLastPrices(pos.publicKey);

      // 检测状态变化并记录
      this.checkAndRecordPriceChange(pos.publicKey, solRatio, avgPrice, xValueUSD, yValueUSD);

      positionValues.push({
        publicKey: pos.publicKey,
        valueUSD: posValue,
        xAmount: pos.totalXAmount,
        yAmount: pos.totalYAmount,
        xValueUSD,
        yValueUSD,
        priceRange: [minPrice, maxPrice],
        binCount: pos.binDistribution.length,
        feeX: pos.feeX,
        feeY: pos.feeY,
        feeXUSD,
        feeYUSD,
        totalFeeUSD,
        positionType,
        solRatio,
        currentAvgPrice: avgPrice,
        lastBidPrice,
        lastAskPrice,
      });

      totalValueUSD += posValue;
    }

    const timestamp = Date.now();
    const snapshot: ValueSnapshot = {
      timestamp,
      totalValueUSD,
      currentPrice,
      positions: positionValues,
    };

    // 更新内存中的最新快照（用于实时显示）
    this.lastSnapshot = snapshot;

    // 检查是否需要写入数据库（间隔 10 分钟）
    const timeSinceLastSnapshot = timestamp - this.lastSnapshotTime;
    if (timeSinceLastSnapshot < SNAPSHOT_INTERVAL_MS) {
      // 未到间隔时间，返回计算结果但不写入数据库
      return snapshot;
    }

    // 插入数据库
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (timestamp, total_value_usd, current_price, positions)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(timestamp, totalValueUSD, currentPrice, JSON.stringify(positionValues));
    this.lastSnapshotTime = timestamp;

    // 更新每日 PnL
    this.updateDailyPnL(snapshot);

    // 定期清理旧数据
    this.cleanOldData();

    return snapshot;
  }

  /**
   * 记录操作
   */
  recordOperation(
    positionKey: string,
    action: 'bid' | 'ask',
    beforeValueUSD: number,
    afterValueUSD: number,
    amountProcessed: number,
    txSignature?: string
  ): void {
    const timestamp = Date.now();
    
    const stmt = this.db.prepare(`
      INSERT INTO operations (timestamp, position_key, action, before_value_usd, after_value_usd, amount_processed, tx_signature)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(timestamp, positionKey, action, beforeValueUSD, afterValueUSD, amountProcessed, txSignature || null);

    // 更新今日操作次数
    const today = new Date().toISOString().split('T')[0];
    const todayStart = new Date(today).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;
    
    const countResult = this.db.prepare(
      'SELECT COUNT(*) as count FROM operations WHERE timestamp >= ? AND timestamp < ?'
    ).get(todayStart, todayEnd) as { count: number };
    
    this.db.prepare(
      'UPDATE daily_pnl SET operations = ?, updated_at = CURRENT_TIMESTAMP WHERE date = ?'
    ).run(countResult.count, today);
  }

  /**
   * 更新每日 PnL
   */
  private updateDailyPnL(snapshot: ValueSnapshot): void {
    const today = new Date().toISOString().split('T')[0];
    
    // 查找今日记录
    const todayRecord = this.db.prepare(
      'SELECT * FROM daily_pnl WHERE date = ?'
    ).get(today) as any;
    
    if (!todayRecord) {
      // 获取昨天的收盘价值作为今天的开盘价值
      const yesterday = this.db.prepare(
        'SELECT close_value FROM daily_pnl ORDER BY date DESC LIMIT 1'
      ).get() as { close_value: number } | undefined;
      
      const openValue = yesterday?.close_value || snapshot.totalValueUSD;
      const pnl = snapshot.totalValueUSD - openValue;
      const pnlPercent = openValue > 0 ? (pnl / openValue) * 100 : 0;

      this.db.prepare(`
        INSERT INTO daily_pnl (date, open_value, close_value, high_value, low_value, pnl, pnl_percent, operations)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(today, openValue, snapshot.totalValueUSD, snapshot.totalValueUSD, snapshot.totalValueUSD, pnl, pnlPercent);
    } else {
      // 更新今日数据
      const highValue = Math.max(todayRecord.high_value, snapshot.totalValueUSD);
      const lowValue = Math.min(todayRecord.low_value, snapshot.totalValueUSD);
      const pnl = snapshot.totalValueUSD - todayRecord.open_value;
      const pnlPercent = todayRecord.open_value > 0 ? (pnl / todayRecord.open_value) * 100 : 0;

      this.db.prepare(`
        UPDATE daily_pnl 
        SET close_value = ?, high_value = ?, low_value = ?, pnl = ?, pnl_percent = ?, updated_at = CURRENT_TIMESTAMP
        WHERE date = ?
      `).run(snapshot.totalValueUSD, highValue, lowValue, pnl, pnlPercent, today);
    }
  }

  /**
   * 计算 APY
   */
  calculateAPY(days: number): number {
    const recentDays = this.db.prepare(
      'SELECT * FROM daily_pnl ORDER BY date DESC LIMIT ?'
    ).all(days) as any[];
    
    // 至少需要 2 天数据才能计算有意义的 APY
    if (recentDays.length < 2) return 0;

    // 反转顺序（从旧到新）
    recentDays.reverse();

    const startValue = recentDays[0].open_value;
    const endValue = recentDays[recentDays.length - 1].close_value;
    
    if (startValue <= 0) return 0;

    const totalReturn = (endValue - startValue) / startValue;
    const actualDays = recentDays.length;
    
    // 如果实际天数太少（< 3天），直接返回简单年化而不用复利
    if (actualDays < 3) {
      // 简单年化 = 日收益率 * 365
      const dailyReturn = totalReturn / actualDays;
      const simpleAPY = dailyReturn * 365 * 100;
      // 限制在合理范围内 [-1000%, +10000%]
      return Math.max(-1000, Math.min(10000, simpleAPY));
    }
    
    // 年化: (1 + 总收益率) ^ (365 / 实际天数) - 1
    // 为避免极端值，限制 totalReturn 在 [-0.99, 10] 范围内
    const clampedReturn = Math.max(-0.99, Math.min(10, totalReturn));
    const apy = (Math.pow(1 + clampedReturn, 365 / actualDays) - 1) * 100;
    
    // 限制 APY 在合理范围内 [-1000%, +100000%]
    return Math.max(-1000, Math.min(100000, apy));
  }

  /**
   * 获取汇总数据
   */
  getSummary(): TrackerSummary {
    // 获取最新快照
    const latestSnapshot = this.db.prepare(
      'SELECT * FROM snapshots ORDER BY timestamp DESC LIMIT 1'
    ).get() as any;
    
    const currentTotalValue = latestSnapshot?.total_value_usd || 0;
    const positions = latestSnapshot ? JSON.parse(latestSnapshot.positions) : [];

    // 今日 PnL
    const today = new Date().toISOString().split('T')[0];
    const todayPnLRecord = this.db.prepare(
      'SELECT * FROM daily_pnl WHERE date = ?'
    ).get(today) as any;
    
    const todayPnL = todayPnLRecord?.pnl || 0;
    const todayPnLPercent = todayPnLRecord?.pnl_percent || 0;

    // 总 PnL（从第一天到现在）
    const firstRecord = this.db.prepare(
      'SELECT * FROM daily_pnl ORDER BY date ASC LIMIT 1'
    ).get() as any;
    
    const lastRecord = this.db.prepare(
      'SELECT * FROM daily_pnl ORDER BY date DESC LIMIT 1'
    ).get() as any;
    
    const totalPnL = firstRecord && lastRecord 
      ? lastRecord.close_value - firstRecord.open_value 
      : 0;
    const totalPnLPercent = firstRecord && firstRecord.open_value > 0
      ? (totalPnL / firstRecord.open_value) * 100
      : 0;

    // 今日操作次数
    const todayStart = new Date(today).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;
    const todayOpsResult = this.db.prepare(
      'SELECT COUNT(*) as count FROM operations WHERE timestamp >= ? AND timestamp < ?'
    ).get(todayStart, todayEnd) as { count: number };

    // 手续费统计
    const totalUnclaimedFeeUSD = positions.reduce((sum: number, p: PositionValue) => sum + (p.totalFeeUSD || 0), 0);
    
    const totalClaimedResult = this.db.prepare(
      'SELECT COALESCE(SUM(total_claimed_usd), 0) as total FROM claimed_fees'
    ).get() as { total: number };
    const totalClaimedFeeUSD = totalClaimedResult.total;

    const todayClaimedResult = this.db.prepare(
      'SELECT COALESCE(SUM(total_claimed_usd), 0) as total FROM claimed_fees WHERE timestamp >= ? AND timestamp < ?'
    ).get(todayStart, todayEnd) as { total: number };
    const todayClaimedFeeUSD = todayClaimedResult.total;

    // 手续费 APY（基于 7 天数据）
    const feeAPY7d = this.calculateFeeAPY(7, currentTotalValue);

    // 累积待复投手续费
    const allAccumulatedFees = this.getAllAccumulatedFees();
    let accumulatedFeeX = 0;
    let accumulatedFeeY = 0;
    for (const [_, fees] of allAccumulatedFees) {
      accumulatedFeeX += fees.feeX;
      accumulatedFeeY += fees.feeY;
    }
    
    // 计算累积手续费的 USD 价值（使用当前价格）
    const currentPrice = latestSnapshot?.current_price || 0;
    const accumulatedFeeXUSD = (accumulatedFeeX / 1e9) * currentPrice;
    const accumulatedFeeYUSD = accumulatedFeeY / 1e6;
    const totalAccumulatedFeeUSD = accumulatedFeeXUSD + accumulatedFeeYUSD;

    return {
      currentTotalValue,
      todayPnL,
      todayPnLPercent,
      totalPnL,
      totalPnLPercent,
      apy7d: this.calculateAPY(7),
      apy30d: this.calculateAPY(30),
      positionCount: positions.length,
      todayOperations: todayOpsResult.count,
      firstSnapshotDate: firstRecord?.date || null,
      lastUpdateTime: latestSnapshot?.timestamp || 0,
      totalUnclaimedFeeUSD,
      totalClaimedFeeUSD,
      todayClaimedFeeUSD,
      feeAPY7d,
      totalAccumulatedFeeUSD,
      accumulatedFeeX,
      accumulatedFeeY,
    };
  }

  /**
   * 获取最近的快照
   */
  getRecentSnapshots(count: number = 100): ValueSnapshot[] {
    const rows = this.db.prepare(
      'SELECT * FROM snapshots ORDER BY timestamp DESC LIMIT ?'
    ).all(count) as any[];
    
    return rows.reverse().map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      totalValueUSD: row.total_value_usd,
      currentPrice: row.current_price,
      positions: JSON.parse(row.positions),
    }));
  }

  /**
   * 获取每日 PnL 数据
   */
  getDailyPnL(days: number = 30): DailyPnL[] {
    const rows = this.db.prepare(
      'SELECT * FROM daily_pnl ORDER BY date DESC LIMIT ?'
    ).all(days) as any[];
    
    return rows.reverse().map(row => ({
      id: row.id,
      date: row.date,
      openValue: row.open_value,
      closeValue: row.close_value,
      highValue: row.high_value,
      lowValue: row.low_value,
      pnl: row.pnl,
      pnlPercent: row.pnl_percent,
      operations: row.operations,
    }));
  }

  /**
   * 获取操作历史
   */
  getOperations(count: number = 50): OperationRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM operations ORDER BY timestamp DESC LIMIT ?'
    ).all(count) as any[];
    
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      positionKey: row.position_key,
      action: row.action as 'bid' | 'ask',
      beforeValueUSD: row.before_value_usd,
      afterValueUSD: row.after_value_usd,
      amountProcessed: row.amount_processed,
      txSignature: row.tx_signature,
    }));
  }

  /**
   * 获取最新仓位价值
   */
  getLatestPositions(): PositionValue[] {
    const latestSnapshot = this.db.prepare(
      'SELECT positions FROM snapshots ORDER BY timestamp DESC LIMIT 1'
    ).get() as { positions: string } | undefined;
    
    return latestSnapshot ? JSON.parse(latestSnapshot.positions) : [];
  }

  /**
   * 获取价值历史（用于图表）- 按小时/分钟级别
   */
  getValueHistory(hours: number = 24): { timestamp: number; value: number }[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    
    const rows = this.db.prepare(
      'SELECT timestamp, total_value_usd FROM snapshots WHERE timestamp > ? ORDER BY timestamp ASC'
    ).all(cutoff) as any[];
    
    return rows.map(row => ({
      timestamp: row.timestamp,
      value: row.total_value_usd,
    }));
  }

  /**
   * 获取每日价值历史（用于图表）- 按天级别
   * 基于 daily_pnl 表，返回每天的收盘价值
   */
  getDailyValueHistory(days: number = 30): { date: string; timestamp: number; value: number; high: number; low: number }[] {
    const rows = this.db.prepare(
      'SELECT date, close_value, high_value, low_value FROM daily_pnl ORDER BY date DESC LIMIT ?'
    ).all(days) as Array<{ date: string; close_value: number; high_value: number; low_value: number }>;
    
    return rows.reverse().map(row => {
      // 将日期字符串转换为时间戳（使用当天结束时间）
      const dateObj = new Date(row.date + 'T23:59:59');
      return {
        date: row.date,
        timestamp: dateObj.getTime(),
        value: row.close_value,      // 使用收盘价值
        high: row.high_value,         // 当天最高价值
        low: row.low_value,           // 当天最低价值
      };
    });
  }

  // ============================================================================
  // 手续费相关方法
  // ============================================================================

  /**
   * 记录已领取的手续费
   */
  recordClaimedFee(
    positionKey: string,
    txSignature: string,
    claimedX: number,
    claimedY: number,
    currentPrice: number,
    tokenXDecimals: number = 9,
    tokenYDecimals: number = 6
  ): ClaimedFeeRecord {
    const timestamp = Date.now();
    const claimedXUSD = (claimedX / Math.pow(10, tokenXDecimals)) * currentPrice;
    const claimedYUSD = claimedY / Math.pow(10, tokenYDecimals);
    const totalClaimedUSD = claimedXUSD + claimedYUSD;

    this.db.prepare(`
      INSERT INTO claimed_fees (
        timestamp, position_key, tx_signature,
        claimed_x, claimed_y, claimed_x_usd, claimed_y_usd,
        total_claimed_usd, price_at_claim
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      timestamp, positionKey, txSignature,
      claimedX, claimedY, claimedXUSD, claimedYUSD,
      totalClaimedUSD, currentPrice
    );

    console.log(`[ValueTracker] 记录手续费领取: ${totalClaimedUSD.toFixed(4)} USD (${(claimedX / 1e9).toFixed(6)} SOL + ${(claimedY / 1e6).toFixed(2)} USDC)`);

    return {
      timestamp,
      positionKey,
      txSignature,
      claimedX,
      claimedY,
      claimedXUSD,
      claimedYUSD,
      totalClaimedUSD,
      priceAtClaim: currentPrice,
    };
  }

  /**
   * 获取已领取手续费历史
   */
  getClaimedFees(count: number = 100): ClaimedFeeRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM claimed_fees ORDER BY timestamp DESC LIMIT ?'
    ).all(count) as any[];

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      positionKey: row.position_key,
      txSignature: row.tx_signature,
      claimedX: row.claimed_x,
      claimedY: row.claimed_y,
      claimedXUSD: row.claimed_x_usd,
      claimedYUSD: row.claimed_y_usd,
      totalClaimedUSD: row.total_claimed_usd,
      priceAtClaim: row.price_at_claim,
    }));
  }

  /**
   * 获取指定时间范围内的已领取手续费总额
   */
  getClaimedFeesInRange(startTime: number, endTime: number): number {
    const result = this.db.prepare(
      'SELECT COALESCE(SUM(total_claimed_usd), 0) as total FROM claimed_fees WHERE timestamp >= ? AND timestamp < ?'
    ).get(startTime, endTime) as { total: number };
    return result.total;
  }

  /**
   * 计算手续费 APY
   */
  private calculateFeeAPY(days: number, currentTotalValue: number): number {
    if (currentTotalValue <= 0) return 0;

    const now = Date.now();
    const startTime = now - days * 24 * 60 * 60 * 1000;
    
    // 获取时间范围内的已领取手续费
    const claimedFees = this.getClaimedFeesInRange(startTime, now);
    
    // 获取当前未领取手续费
    const positions = this.getLatestPositions();
    const unclaimedFees = positions.reduce((sum: number, p: PositionValue) => sum + (p.totalFeeUSD || 0), 0);
    
    // 总手续费收益 = 已领取 + 未领取
    const totalFees = claimedFees + unclaimedFees;
    
    if (totalFees <= 0) return 0;

    // 年化收益率 = (收益 / 本金) * (365 / 天数) * 100
    const apy = (totalFees / currentTotalValue) * (365 / days) * 100;
    
    // 限制最大值
    return Math.min(apy, 9999);
  }

  /**
   * 获取手续费历史（用于图表）
   */
  getFeeHistory(days: number = 30): { date: string; claimed: number; unclaimed: number }[] {
    const result: { date: string; claimed: number; unclaimed: number }[] = [];
    const now = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayStart = new Date(dateStr).getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      
      // 当日领取的手续费
      const claimedResult = this.db.prepare(
        'SELECT COALESCE(SUM(total_claimed_usd), 0) as total FROM claimed_fees WHERE timestamp >= ? AND timestamp < ?'
      ).get(dayStart, dayEnd) as { total: number };
      
      result.push({
        date: dateStr,
        claimed: claimedResult.total,
        unclaimed: 0, // 历史未领取数据需要从快照中获取，这里简化处理
      });
    }
    
    return result;
  }

  // ============================================================================
  // 累积手续费相关方法
  // ============================================================================

  /**
   * 累积手续费到仓位
   */
  accumulateFees(positionKey: string, feeX: number, feeY: number): void {
    const existing = this.db.prepare(
      'SELECT fee_x, fee_y FROM accumulated_fees WHERE position_key = ?'
    ).get(positionKey) as { fee_x: number; fee_y: number } | undefined;

    if (existing) {
      // 更新现有记录
      this.db.prepare(`
        UPDATE accumulated_fees 
        SET fee_x = fee_x + ?, fee_y = fee_y + ?, updated_at = CURRENT_TIMESTAMP
        WHERE position_key = ?
      `).run(feeX, feeY, positionKey);
    } else {
      // 插入新记录
      this.db.prepare(`
        INSERT INTO accumulated_fees (position_key, fee_x, fee_y)
        VALUES (?, ?, ?)
      `).run(positionKey, feeX, feeY);
    }

    console.log(`[ValueTracker] 累积手续费: ${positionKey.slice(0, 8)}... +${(feeX / 1e9).toFixed(6)} SOL +${(feeY / 1e6).toFixed(2)} USDC`);
  }

  /**
   * 获取仓位的累积手续费
   */
  getAccumulatedFees(positionKey: string): { feeX: number; feeY: number } {
    const result = this.db.prepare(
      'SELECT fee_x, fee_y FROM accumulated_fees WHERE position_key = ?'
    ).get(positionKey) as { fee_x: number; fee_y: number } | undefined;

    if (!result) {
      return { feeX: 0, feeY: 0 };
    }

    return { feeX: result.fee_x, feeY: result.fee_y };
  }

  /**
   * 清除仓位的累积手续费（复投后调用）
   */
  clearAccumulatedFees(positionKey: string): void {
    this.db.prepare(
      'DELETE FROM accumulated_fees WHERE position_key = ?'
    ).run(positionKey);

    console.log(`[ValueTracker] 清除累积手续费: ${positionKey.slice(0, 8)}...`);
  }

  /**
   * 获取所有累积手续费
   */
  getAllAccumulatedFees(): Map<string, { feeX: number; feeY: number }> {
    const rows = this.db.prepare(
      'SELECT position_key, fee_x, fee_y FROM accumulated_fees'
    ).all() as Array<{ position_key: string; fee_x: number; fee_y: number }>;

    const result = new Map<string, { feeX: number; feeY: number }>();
    for (const row of rows) {
      result.set(row.position_key, { feeX: row.fee_x, feeY: row.fee_y });
    }
    return result;
  }

  /**
   * 清除所有仓位的 SOL 手续费（保留 USDC）
   */
  clearAllAccumulatedFeeX(): void {
    this.db.prepare(`
      UPDATE accumulated_fees 
      SET fee_x = 0, updated_at = CURRENT_TIMESTAMP
      WHERE fee_x > 0
    `).run();

    console.log(`[ValueTracker] 已清除所有仓位的 SOL 累积手续费`);
  }

  /**
   * 清除所有仓位的 USDC 手续费（保留 SOL）
   */
  clearAllAccumulatedFeeY(): void {
    this.db.prepare(`
      UPDATE accumulated_fees 
      SET fee_y = 0, updated_at = CURRENT_TIMESTAMP
      WHERE fee_y > 0
    `).run();

    console.log(`[ValueTracker] 已清除所有仓位的 USDC 累积手续费`);
  }

  /**
   * 清除所有仓位中 fee_x 和 fee_y 都为 0 的记录
   */
  cleanupEmptyAccumulatedFees(): void {
    this.db.prepare(`
      DELETE FROM accumulated_fees 
      WHERE fee_x = 0 AND fee_y = 0
    `).run();
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}

// 导出单例
let trackerInstance: ValueTracker | null = null;

export function getValueTracker(dataDir?: string): ValueTracker {
  if (!trackerInstance) {
    trackerInstance = new ValueTracker(dataDir);
  }
  return trackerInstance;
}
