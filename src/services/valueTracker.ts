import * as fs from 'fs';
import * as path from 'path';

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
}

export interface ValueSnapshot {
  timestamp: number;
  totalValueUSD: number;
  currentPrice: number;   // 当前活跃 bin 的价格
  positions: PositionValue[];
}

export interface OperationRecord {
  timestamp: number;
  positionKey: string;
  action: 'bid' | 'ask';
  beforeValueUSD: number;
  afterValueUSD: number;
  amountProcessed: number;  // 处理的金额
  txSignature?: string;
}

export interface DailyPnL {
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
}

// ============================================================================
// 价值追踪服务
// ============================================================================

export class ValueTracker {
  private dataDir: string;
  private snapshotsFile: string;
  private operationsFile: string;
  private dailyPnLFile: string;

  private snapshots: ValueSnapshot[] = [];
  private operations: OperationRecord[] = [];
  private dailyPnL: DailyPnL[] = [];

  constructor(dataDir?: string) {
    // 使用 __dirname 确保路径相对于此文件位置，而不是运行时工作目录
    this.dataDir = dataDir || path.join(__dirname, '..', 'data');
    this.snapshotsFile = path.join(this.dataDir, 'snapshots.json');
    this.operationsFile = path.join(this.dataDir, 'operations.json');
    this.dailyPnLFile = path.join(this.dataDir, 'daily_pnl.json');

    console.log(`[ValueTracker] 数据目录: ${this.dataDir}`);
    this.ensureDataDir();
    this.loadData();
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
   * 加载已有数据
   */
  private loadData(): void {
    try {
      if (fs.existsSync(this.snapshotsFile)) {
        this.snapshots = JSON.parse(fs.readFileSync(this.snapshotsFile, 'utf-8'));
      }
      if (fs.existsSync(this.operationsFile)) {
        this.operations = JSON.parse(fs.readFileSync(this.operationsFile, 'utf-8'));
      }
      if (fs.existsSync(this.dailyPnLFile)) {
        this.dailyPnL = JSON.parse(fs.readFileSync(this.dailyPnLFile, 'utf-8'));
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    }
  }

  /**
   * 保存数据到文件
   */
  private saveData(): void {
    try {
      fs.writeFileSync(this.snapshotsFile, JSON.stringify(this.snapshots, null, 2));
      fs.writeFileSync(this.operationsFile, JSON.stringify(this.operations, null, 2));
      fs.writeFileSync(this.dailyPnLFile, JSON.stringify(this.dailyPnL, null, 2));
    } catch (error) {
      console.error('保存数据失败:', error);
    }
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
   * 记录价值快照
   */
  takeSnapshot(
    positions: {
      publicKey: string;
      binDistribution: { binId: number; price: number; xAmount: number; yAmount: number }[];
      lowerBinId: number;
      upperBinId: number;
      totalXAmount: number;
      totalYAmount: number;
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

      positionValues.push({
        publicKey: pos.publicKey,
        valueUSD: posValue,
        xAmount: pos.totalXAmount,
        yAmount: pos.totalYAmount,
        xValueUSD,
        yValueUSD,
        priceRange: [minPrice, maxPrice],
        binCount: pos.binDistribution.length,
      });

      totalValueUSD += posValue;
    }

    const snapshot: ValueSnapshot = {
      timestamp: Date.now(),
      totalValueUSD,
      currentPrice,
      positions: positionValues,
    };

    this.snapshots.push(snapshot);
    
    // 只保留最近 30 天的快照（每分钟一个约 43200 条）
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.snapshots = this.snapshots.filter(s => s.timestamp > thirtyDaysAgo);

    // 更新每日 PnL
    this.updateDailyPnL(snapshot);

    this.saveData();
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
    const record: OperationRecord = {
      timestamp: Date.now(),
      positionKey,
      action,
      beforeValueUSD,
      afterValueUSD,
      amountProcessed,
      txSignature,
    };

    this.operations.push(record);

    // 只保留最近 90 天的操作记录
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    this.operations = this.operations.filter(o => o.timestamp > ninetyDaysAgo);

    this.saveData();
  }

  /**
   * 更新每日 PnL
   */
  private updateDailyPnL(snapshot: ValueSnapshot): void {
    const today = new Date().toISOString().split('T')[0];
    
    let todayRecord = this.dailyPnL.find(d => d.date === today);
    
    if (!todayRecord) {
      // 获取昨天的收盘价值作为今天的开盘价值
      const yesterday = this.dailyPnL[this.dailyPnL.length - 1];
      const openValue = yesterday?.closeValue || snapshot.totalValueUSD;

      todayRecord = {
        date: today,
        openValue,
        closeValue: snapshot.totalValueUSD,
        highValue: snapshot.totalValueUSD,
        lowValue: snapshot.totalValueUSD,
        pnl: 0,
        pnlPercent: 0,
        operations: 0,
      };
      this.dailyPnL.push(todayRecord);
    }

    // 更新今日数据
    todayRecord.closeValue = snapshot.totalValueUSD;
    todayRecord.highValue = Math.max(todayRecord.highValue, snapshot.totalValueUSD);
    todayRecord.lowValue = Math.min(todayRecord.lowValue, snapshot.totalValueUSD);
    todayRecord.pnl = todayRecord.closeValue - todayRecord.openValue;
    todayRecord.pnlPercent = todayRecord.openValue > 0 
      ? (todayRecord.pnl / todayRecord.openValue) * 100 
      : 0;

    // 统计今日操作次数
    const todayStart = new Date(today).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;
    todayRecord.operations = this.operations.filter(
      o => o.timestamp >= todayStart && o.timestamp < todayEnd
    ).length;
  }

  /**
   * 计算 APY
   */
  calculateAPY(days: number): number {
    if (this.dailyPnL.length < 2) return 0;

    const recentDays = this.dailyPnL.slice(-days);
    if (recentDays.length < 2) return 0;

    const startValue = recentDays[0].openValue;
    const endValue = recentDays[recentDays.length - 1].closeValue;
    
    if (startValue <= 0) return 0;

    const totalReturn = (endValue - startValue) / startValue;
    const actualDays = recentDays.length;
    
    // 年化: (1 + 总收益率) ^ (365 / 实际天数) - 1
    const apy = (Math.pow(1 + totalReturn, 365 / actualDays) - 1) * 100;
    
    return apy;
  }

  /**
   * 获取汇总数据
   */
  getSummary(): TrackerSummary {
    const latestSnapshot = this.snapshots[this.snapshots.length - 1];
    const currentTotalValue = latestSnapshot?.totalValueUSD || 0;

    // 今日 PnL
    const today = new Date().toISOString().split('T')[0];
    const todayPnLRecord = this.dailyPnL.find(d => d.date === today);
    const todayPnL = todayPnLRecord?.pnl || 0;
    const todayPnLPercent = todayPnLRecord?.pnlPercent || 0;

    // 总 PnL（从第一天到现在）
    const firstRecord = this.dailyPnL[0];
    const lastRecord = this.dailyPnL[this.dailyPnL.length - 1];
    const totalPnL = firstRecord && lastRecord 
      ? lastRecord.closeValue - firstRecord.openValue 
      : 0;
    const totalPnLPercent = firstRecord && firstRecord.openValue > 0
      ? (totalPnL / firstRecord.openValue) * 100
      : 0;

    // 今日操作次数
    const todayStart = new Date(today).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;
    const todayOperations = this.operations.filter(
      o => o.timestamp >= todayStart && o.timestamp < todayEnd
    ).length;

    return {
      currentTotalValue,
      todayPnL,
      todayPnLPercent,
      totalPnL,
      totalPnLPercent,
      apy7d: this.calculateAPY(7),
      apy30d: this.calculateAPY(30),
      positionCount: latestSnapshot?.positions.length || 0,
      todayOperations,
      firstSnapshotDate: this.dailyPnL[0]?.date || null,
      lastUpdateTime: latestSnapshot?.timestamp || 0,
    };
  }

  /**
   * 获取最近的快照
   */
  getRecentSnapshots(count: number = 100): ValueSnapshot[] {
    return this.snapshots.slice(-count);
  }

  /**
   * 获取每日 PnL 数据
   */
  getDailyPnL(days: number = 30): DailyPnL[] {
    return this.dailyPnL.slice(-days);
  }

  /**
   * 获取操作历史
   */
  getOperations(count: number = 50): OperationRecord[] {
    return this.operations.slice(-count).reverse();
  }

  /**
   * 获取最新仓位价值
   */
  getLatestPositions(): PositionValue[] {
    const latestSnapshot = this.snapshots[this.snapshots.length - 1];
    return latestSnapshot?.positions || [];
  }

  /**
   * 获取价值历史（用于图表）
   */
  getValueHistory(hours: number = 24): { timestamp: number; value: number }[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return this.snapshots
      .filter(s => s.timestamp > cutoff)
      .map(s => ({ timestamp: s.timestamp, value: s.totalValueUSD }));
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
