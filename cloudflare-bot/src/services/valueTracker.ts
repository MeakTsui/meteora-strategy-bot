import {
  Env,
  PositionValue,
  ValueSnapshot,
  OperationRecord,
  DailyPnL,
  ClaimedFeeRecord,
  TrackerSummary,
  BinDistribution,
} from "../types";
import logger from "../utils/logger";

// 快照间隔配置（毫秒）
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟

/**
 * ValueTracker - 价值追踪服务 (Cloudflare D1 版本)
 */
export class ValueTracker {
  private env: Env;
  private lastSnapshotTime: number = 0;
  private lastSnapshot: ValueSnapshot | null = null;
  private lastSolRatios: Map<string, number> = new Map();

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * 计算单个仓位的 USD 价值
   */
  calculatePositionValue(
    binDistribution: BinDistribution[],
    tokenXDecimals: number,
    tokenYDecimals: number
  ): { totalValueUSD: number; xValueUSD: number; yValueUSD: number } {
    let xValueUSD = 0;
    let yValueUSD = 0;

    for (const bin of binDistribution) {
      xValueUSD += (bin.xAmount / Math.pow(10, tokenXDecimals)) * bin.price;
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
    binDistribution: BinDistribution[],
    tokenXDecimals: number,
    tokenYDecimals: number,
    solRatio: number
  ): { avgPrice: number; positionType: 'bid' | 'ask' | 'mixed' } {
    let totalValue = 0;
    let totalSOL = 0;

    for (const bin of binDistribution) {
      const xAmount = bin.xAmount / Math.pow(10, tokenXDecimals);
      const yAmount = bin.yAmount / Math.pow(10, tokenYDecimals);
      
      totalValue += xAmount * bin.price;
      totalSOL += xAmount;
      
      if (bin.price > 0) {
        totalValue += yAmount;
        totalSOL += yAmount / bin.price;
      }
    }

    const avgPrice = totalSOL > 0 ? totalValue / totalSOL : 0;
    
    let positionType: 'bid' | 'ask' | 'mixed';
    if (solRatio >= 0.95) {
      positionType = 'ask';
    } else if (solRatio <= 0.05) {
      positionType = 'bid';
    } else {
      positionType = 'mixed';
    }

    return { avgPrice, positionType };
  }

  /**
   * 获取仓位的历史买卖均价
   */
  private async getLastPrices(positionKey: string): Promise<{ lastBidPrice: number | null; lastAskPrice: number | null }> {
    try {
      const bidRecord = await this.env.DB.prepare(
        'SELECT avg_price FROM position_price_history WHERE position_key = ? AND price_type = ? ORDER BY timestamp DESC LIMIT 1'
      ).bind(positionKey, 'bid').first<{ avg_price: number }>();

      const askRecord = await this.env.DB.prepare(
        'SELECT avg_price FROM position_price_history WHERE position_key = ? AND price_type = ? ORDER BY timestamp DESC LIMIT 1'
      ).bind(positionKey, 'ask').first<{ avg_price: number }>();

      return {
        lastBidPrice: bidRecord?.avg_price ?? null,
        lastAskPrice: askRecord?.avg_price ?? null,
      };
    } catch {
      return { lastBidPrice: null, lastAskPrice: null };
    }
  }

  /**
   * 记录仓位价格到数据库
   */
  private async recordPositionPrice(
    positionKey: string,
    priceType: 'bid' | 'ask',
    avgPrice: number,
    amount: number
  ): Promise<void> {
    try {
      await this.env.DB.prepare(`
        INSERT INTO position_price_history (position_key, timestamp, price_type, avg_price, amount)
        VALUES (?, ?, ?, ?, ?)
      `).bind(positionKey, Date.now(), priceType, avgPrice, amount).run();
    } catch (error) {
      logger.error("记录仓位价格失败:", error);
    }
  }

  /**
   * 检测状态变化并记录价格
   */
  private async checkAndRecordPriceChange(
    positionKey: string,
    solRatio: number,
    avgPrice: number,
    xValueUSD: number,
    yValueUSD: number
  ): Promise<void> {
    const lastRatio = this.lastSolRatios.get(positionKey);
    
    if (lastRatio !== undefined) {
      if (solRatio >= 0.95 && lastRatio < 0.95) {
        await this.recordPositionPrice(positionKey, 'ask', avgPrice, xValueUSD);
        logger.info(`仓位 ${positionKey.slice(0, 8)}... 记录卖出均价: $${avgPrice.toFixed(4)}`);
      }
      
      if (solRatio <= 0.05 && lastRatio > 0.05) {
        await this.recordPositionPrice(positionKey, 'bid', avgPrice, yValueUSD);
        logger.info(`仓位 ${positionKey.slice(0, 8)}... 记录买入均价: $${avgPrice.toFixed(4)}`);
      }
    } else {
      if (solRatio >= 0.95) {
        await this.recordPositionPrice(positionKey, 'ask', avgPrice, xValueUSD);
      } else if (solRatio <= 0.05) {
        await this.recordPositionPrice(positionKey, 'bid', avgPrice, yValueUSD);
      }
    }

    this.lastSolRatios.set(positionKey, solRatio);
  }

  /**
   * 记录价值快照
   */
  async takeSnapshot(
    positions: {
      publicKey: string;
      binDistribution: BinDistribution[];
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
  ): Promise<ValueSnapshot> {
    const positionValues: PositionValue[] = [];
    let totalValueUSD = 0;

    for (const pos of positions) {
      const { totalValueUSD: posValue, xValueUSD, yValueUSD } = this.calculatePositionValue(
        pos.binDistribution,
        tokenXDecimals,
        tokenYDecimals
      );

      const prices = pos.binDistribution.map(b => b.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      const feeXUSD = (pos.feeX / Math.pow(10, tokenXDecimals)) * currentPrice;
      const feeYUSD = pos.feeY / Math.pow(10, tokenYDecimals);
      const totalFeeUSD = feeXUSD + feeYUSD;

      const solRatio = posValue > 0 ? xValueUSD / posValue : 0;
      const { avgPrice, positionType } = this.calculateWeightedAvgPrice(
        pos.binDistribution,
        tokenXDecimals,
        tokenYDecimals,
        solRatio
      );

      const { lastBidPrice, lastAskPrice } = await this.getLastPrices(pos.publicKey);

      await this.checkAndRecordPriceChange(pos.publicKey, solRatio, avgPrice, xValueUSD, yValueUSD);

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

    this.lastSnapshot = snapshot;

    // 检查是否需要写入数据库
    const timeSinceLastSnapshot = timestamp - this.lastSnapshotTime;
    if (timeSinceLastSnapshot < SNAPSHOT_INTERVAL_MS) {
      return snapshot;
    }

    try {
      await this.env.DB.prepare(`
        INSERT INTO snapshots (timestamp, total_value_usd, current_price, positions)
        VALUES (?, ?, ?, ?)
      `).bind(timestamp, totalValueUSD, currentPrice, JSON.stringify(positionValues)).run();
      
      this.lastSnapshotTime = timestamp;
      await this.updateDailyPnL(snapshot);
    } catch (error) {
      logger.error("保存快照失败:", error);
    }

    return snapshot;
  }

  /**
   * 记录操作
   */
  async recordOperation(
    positionKey: string,
    action: 'bid' | 'ask',
    beforeValueUSD: number,
    afterValueUSD: number,
    amountProcessed: number,
    txSignature?: string
  ): Promise<void> {
    const timestamp = Date.now();
    
    try {
      await this.env.DB.prepare(`
        INSERT INTO operations (timestamp, position_key, action, before_value_usd, after_value_usd, amount_processed, tx_signature)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(timestamp, positionKey, action, beforeValueUSD, afterValueUSD, amountProcessed, txSignature || null).run();
    } catch (error) {
      logger.error("记录操作失败:", error);
    }
  }

  /**
   * 更新每日 PnL
   */
  private async updateDailyPnL(snapshot: ValueSnapshot): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    
    try {
      const todayRecord = await this.env.DB.prepare(
        'SELECT * FROM daily_pnl WHERE date = ?'
      ).bind(today).first<any>();
      
      if (!todayRecord) {
        const yesterday = await this.env.DB.prepare(
          'SELECT close_value FROM daily_pnl ORDER BY date DESC LIMIT 1'
        ).first<{ close_value: number }>();
        
        const openValue = yesterday?.close_value || snapshot.totalValueUSD;
        const pnl = snapshot.totalValueUSD - openValue;
        const pnlPercent = openValue > 0 ? (pnl / openValue) * 100 : 0;

        await this.env.DB.prepare(`
          INSERT INTO daily_pnl (date, open_value, close_value, high_value, low_value, pnl, pnl_percent, operations)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).bind(today, openValue, snapshot.totalValueUSD, snapshot.totalValueUSD, snapshot.totalValueUSD, pnl, pnlPercent).run();
      } else {
        const highValue = Math.max(todayRecord.high_value, snapshot.totalValueUSD);
        const lowValue = Math.min(todayRecord.low_value, snapshot.totalValueUSD);
        const pnl = snapshot.totalValueUSD - todayRecord.open_value;
        const pnlPercent = todayRecord.open_value > 0 ? (pnl / todayRecord.open_value) * 100 : 0;

        await this.env.DB.prepare(`
          UPDATE daily_pnl 
          SET close_value = ?, high_value = ?, low_value = ?, pnl = ?, pnl_percent = ?
          WHERE date = ?
        `).bind(snapshot.totalValueUSD, highValue, lowValue, pnl, pnlPercent, today).run();
      }
    } catch (error) {
      logger.error("更新每日 PnL 失败:", error);
    }
  }

  /**
   * 计算 APY
   */
  async calculateAPY(days: number): Promise<number> {
    try {
      const result = await this.env.DB.prepare(
        'SELECT * FROM daily_pnl ORDER BY date DESC LIMIT ?'
      ).bind(days).all<any>();
      
      const recentDays = result.results || [];
      if (recentDays.length < 2) return 0;

      recentDays.reverse();

      const startValue = recentDays[0].open_value;
      const endValue = recentDays[recentDays.length - 1].close_value;
      
      if (startValue <= 0) return 0;

      const totalReturn = (endValue - startValue) / startValue;
      const actualDays = recentDays.length;
      
      if (actualDays < 3) {
        const dailyReturn = totalReturn / actualDays;
        const simpleAPY = dailyReturn * 365 * 100;
        return Math.max(-1000, Math.min(10000, simpleAPY));
      }
      
      const clampedReturn = Math.max(-0.99, Math.min(10, totalReturn));
      const apy = (Math.pow(1 + clampedReturn, 365 / actualDays) - 1) * 100;
      
      return Math.max(-1000, Math.min(100000, apy));
    } catch {
      return 0;
    }
  }

  /**
   * 获取汇总数据
   */
  async getSummary(): Promise<TrackerSummary> {
    try {
      const latestSnapshot = await this.env.DB.prepare(
        'SELECT * FROM snapshots ORDER BY timestamp DESC LIMIT 1'
      ).first<any>();
      
      const currentTotalValue = latestSnapshot?.total_value_usd || 0;
      const positions: PositionValue[] = latestSnapshot ? JSON.parse(latestSnapshot.positions) : [];

      const today = new Date().toISOString().split('T')[0];
      const todayPnLRecord = await this.env.DB.prepare(
        'SELECT * FROM daily_pnl WHERE date = ?'
      ).bind(today).first<any>();
      
      const todayPnL = todayPnLRecord?.pnl || 0;
      const todayPnLPercent = todayPnLRecord?.pnl_percent || 0;

      const firstRecord = await this.env.DB.prepare(
        'SELECT * FROM daily_pnl ORDER BY date ASC LIMIT 1'
      ).first<any>();
      
      const lastRecord = await this.env.DB.prepare(
        'SELECT * FROM daily_pnl ORDER BY date DESC LIMIT 1'
      ).first<any>();
      
      const totalPnL = firstRecord && lastRecord 
        ? lastRecord.close_value - firstRecord.open_value 
        : 0;
      const totalPnLPercent = firstRecord && firstRecord.open_value > 0
        ? (totalPnL / firstRecord.open_value) * 100
        : 0;

      const todayStart = new Date(today).getTime();
      const todayEnd = todayStart + 24 * 60 * 60 * 1000;
      const todayOpsResult = await this.env.DB.prepare(
        'SELECT COUNT(*) as count FROM operations WHERE timestamp >= ? AND timestamp < ?'
      ).bind(todayStart, todayEnd).first<{ count: number }>();

      const totalUnclaimedFeeUSD = positions.reduce((sum, p) => sum + (p.totalFeeUSD || 0), 0);
      
      const totalClaimedResult = await this.env.DB.prepare(
        'SELECT COALESCE(SUM(total_claimed_usd), 0) as total FROM claimed_fees'
      ).first<{ total: number }>();
      const totalClaimedFeeUSD = totalClaimedResult?.total || 0;

      const todayClaimedResult = await this.env.DB.prepare(
        'SELECT COALESCE(SUM(total_claimed_usd), 0) as total FROM claimed_fees WHERE timestamp >= ? AND timestamp < ?'
      ).bind(todayStart, todayEnd).first<{ total: number }>();
      const todayClaimedFeeUSD = todayClaimedResult?.total || 0;

      const feeAPY7d = await this.calculateFeeAPY(7, currentTotalValue);

      return {
        currentTotalValue,
        todayPnL,
        todayPnLPercent,
        totalPnL,
        totalPnLPercent,
        apy7d: await this.calculateAPY(7),
        apy30d: await this.calculateAPY(30),
        positionCount: positions.length,
        todayOperations: todayOpsResult?.count || 0,
        firstSnapshotDate: firstRecord?.date || null,
        lastUpdateTime: latestSnapshot?.timestamp || 0,
        totalUnclaimedFeeUSD,
        totalClaimedFeeUSD,
        todayClaimedFeeUSD,
        feeAPY7d,
      };
    } catch (error) {
      logger.error("获取汇总数据失败:", error);
      return {
        currentTotalValue: 0,
        todayPnL: 0,
        todayPnLPercent: 0,
        totalPnL: 0,
        totalPnLPercent: 0,
        apy7d: 0,
        apy30d: 0,
        positionCount: 0,
        todayOperations: 0,
        firstSnapshotDate: null,
        lastUpdateTime: 0,
        totalUnclaimedFeeUSD: 0,
        totalClaimedFeeUSD: 0,
        todayClaimedFeeUSD: 0,
        feeAPY7d: 0,
      };
    }
  }

  /**
   * 获取最新仓位价值
   */
  async getLatestPositions(): Promise<PositionValue[]> {
    try {
      const latestSnapshot = await this.env.DB.prepare(
        'SELECT positions FROM snapshots ORDER BY timestamp DESC LIMIT 1'
      ).first<{ positions: string }>();
      
      return latestSnapshot ? JSON.parse(latestSnapshot.positions) : [];
    } catch {
      return [];
    }
  }

  /**
   * 获取价值历史
   */
  async getValueHistory(hours: number = 24): Promise<{ timestamp: number; value: number }[]> {
    try {
      const cutoff = Date.now() - hours * 60 * 60 * 1000;
      
      const result = await this.env.DB.prepare(
        'SELECT timestamp, total_value_usd FROM snapshots WHERE timestamp > ? ORDER BY timestamp ASC'
      ).bind(cutoff).all<any>();
      
      return (result.results || []).map(row => ({
        timestamp: row.timestamp,
        value: row.total_value_usd,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 获取每日 PnL 数据
   */
  async getDailyPnL(days: number = 30): Promise<DailyPnL[]> {
    try {
      const result = await this.env.DB.prepare(
        'SELECT * FROM daily_pnl ORDER BY date DESC LIMIT ?'
      ).bind(days).all<any>();
      
      return (result.results || []).reverse().map(row => ({
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
    } catch {
      return [];
    }
  }

  /**
   * 获取操作历史
   */
  async getOperations(count: number = 50): Promise<OperationRecord[]> {
    try {
      const result = await this.env.DB.prepare(
        'SELECT * FROM operations ORDER BY timestamp DESC LIMIT ?'
      ).bind(count).all<any>();
      
      return (result.results || []).map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        positionKey: row.position_key,
        action: row.action as 'bid' | 'ask',
        beforeValueUSD: row.before_value_usd,
        afterValueUSD: row.after_value_usd,
        amountProcessed: row.amount_processed,
        txSignature: row.tx_signature,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 记录已领取的手续费
   */
  async recordClaimedFee(
    positionKey: string,
    txSignature: string,
    claimedX: number,
    claimedY: number,
    currentPrice: number,
    tokenXDecimals: number = 9,
    tokenYDecimals: number = 6
  ): Promise<ClaimedFeeRecord> {
    const timestamp = Date.now();
    const claimedXUSD = (claimedX / Math.pow(10, tokenXDecimals)) * currentPrice;
    const claimedYUSD = claimedY / Math.pow(10, tokenYDecimals);
    const totalClaimedUSD = claimedXUSD + claimedYUSD;

    try {
      await this.env.DB.prepare(`
        INSERT INTO claimed_fees (
          timestamp, position_key, tx_signature,
          claimed_x, claimed_y, claimed_x_usd, claimed_y_usd,
          total_claimed_usd, price_at_claim
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        timestamp, positionKey, txSignature,
        claimedX, claimedY, claimedXUSD, claimedYUSD,
        totalClaimedUSD, currentPrice
      ).run();

      logger.info(`记录手续费领取: ${totalClaimedUSD.toFixed(4)} USD`);
    } catch (error) {
      logger.error("记录手续费失败:", error);
    }

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
  async getClaimedFees(count: number = 100): Promise<ClaimedFeeRecord[]> {
    try {
      const result = await this.env.DB.prepare(
        'SELECT * FROM claimed_fees ORDER BY timestamp DESC LIMIT ?'
      ).bind(count).all<any>();

      return (result.results || []).map(row => ({
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
    } catch {
      return [];
    }
  }

  /**
   * 计算手续费 APY
   */
  private async calculateFeeAPY(days: number, currentTotalValue: number): Promise<number> {
    if (currentTotalValue <= 0) return 0;

    try {
      const now = Date.now();
      const startTime = now - days * 24 * 60 * 60 * 1000;
      
      const claimedResult = await this.env.DB.prepare(
        'SELECT COALESCE(SUM(total_claimed_usd), 0) as total FROM claimed_fees WHERE timestamp >= ? AND timestamp < ?'
      ).bind(startTime, now).first<{ total: number }>();
      const claimedFees = claimedResult?.total || 0;
      
      const positions = await this.getLatestPositions();
      const unclaimedFees = positions.reduce((sum, p) => sum + (p.totalFeeUSD || 0), 0);
      
      const totalFees = claimedFees + unclaimedFees;
      
      if (totalFees <= 0) return 0;

      const apy = (totalFees / currentTotalValue) * (365 / days) * 100;
      
      return Math.min(apy, 9999);
    } catch {
      return 0;
    }
  }

  /**
   * 获取手续费历史
   */
  async getFeeHistory(days: number = 30): Promise<{ date: string; claimed: number; unclaimed: number }[]> {
    const result: { date: string; claimed: number; unclaimed: number }[] = [];
    const now = new Date();
    
    try {
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayStart = new Date(dateStr).getTime();
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        
        const claimedResult = await this.env.DB.prepare(
          'SELECT COALESCE(SUM(total_claimed_usd), 0) as total FROM claimed_fees WHERE timestamp >= ? AND timestamp < ?'
        ).bind(dayStart, dayEnd).first<{ total: number }>();
        
        result.push({
          date: dateStr,
          claimed: claimedResult?.total || 0,
          unclaimed: 0,
        });
      }
    } catch {
      // 返回空数组
    }
    
    return result;
  }
}

/**
 * 创建 ValueTracker 实例
 */
export function createValueTracker(env: Env): ValueTracker {
  return new ValueTracker(env);
}
