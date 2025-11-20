import fetch from "node-fetch";
import { PriceData, OHLC } from "../types";
import { apiKeys } from "../config/config";
import logger from "../utils/logger";
import { retry } from "../utils/helpers";

/**
 * PriceService —— 负责从多个数据源获取并缓存价格数据，并实现多级兜底逻辑
 */
export class PriceService {
  private currentPrice: number = 0;
  private lastUpdateTime: Date = new Date();
  private priceHistory: PriceData[] = [];
  private subscribers: Array<(price: number) => void> = [];

  constructor() {
    this.startPricePolling();
  }

  /**
   * 获取最新价格，如本地缓存无效则会触发一次远程拉取
   */
  async getPrice(): Promise<number> {
    try {
      // 1. 首选：Jupiter 价格 API
      const jupiterPrice = await this.getPriceFromJupiter();
      if (jupiterPrice > 0) {
        this.updatePrice(jupiterPrice, "Jupiter");
        return jupiterPrice;
      }

      // 2. 次选：Helius 价格 API
      if (apiKeys.helius) {
        const heliusPrice = await this.getPriceFromHelius();
        if (heliusPrice > 0) {
          this.updatePrice(heliusPrice, "Helius");
          return heliusPrice;
        }
      }

      // 3. 再次兜底：Birdeye 价格 API
      if (!apiKeys.birdeye) {
        throw new Error("未配置 Birdeye API Key，无法从 Birdeye 获取价格");
      }
      const birdeyePrice = await this.getPriceFromBirdeye();
      if (birdeyePrice > 0) {
        this.updatePrice(birdeyePrice, "Birdeye");
        return birdeyePrice;
      }

      // 4. 最后兜底：返回最近一次有效价格（如果存在）
      logger.warn("所有价格数据源获取失败，使用缓存价格");
      return this.currentPrice;
    } catch (error) {
      logger.error("获取价格失败:", error);
      return this.currentPrice;
    }
  }

  /**
   * 从 Jupiter 价格 API 获取 SOL/USDC 价格
   */
  private async getPriceFromJupiter(): Promise<number> {
    try {
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const url = `https://price.jup.ag/v6/price?ids=${SOL_MINT}&vsToken=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`;

      const response = await retry(() =>
        fetch(url).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
      );

      const priceData = (response as any).data?.[SOL_MINT];
      if (priceData && priceData.price) {
        return Number(priceData.price);
      }

      return 0;
    } catch (error) {
      logger.debug("Jupiter 价格 API 请求失败:", error);
      return 0;
    }
  }

  /**
   * 从 Helius 价格 API 获取 SOL/USDC 价格
   */
  private async getPriceFromHelius(): Promise<number> {
    try {
      // NOTE: 这里目前是占位逻辑，未来可替换为真实 Helius 价格 API
      return 0;
    } catch (error) {
      logger.debug("Helius 价格 API 请求失败:", error);
      return 0;
    }
  }

  /**
   * 从 Birdeye 价格 API 获取 SOL/USDC 价格
   */
  private async getPriceFromBirdeye(): Promise<number> {
    try {
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const url = `https://public-api.birdeye.so/defi/price?address=${SOL_MINT}`;

      const response = await retry(() =>
        fetch(url, {
          headers: {
            "X-API-KEY": apiKeys.birdeye,
          },
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
      );

      const priceData = (response as any).data;
      if (priceData && priceData.value) {
        return Number(priceData.value);
      }

      return 0;
    } catch (error) {
      logger.debug("Birdeye 价格 API 请求失败:", error);
      return 0;
    }
  }

  /**
   * 更新当前价格并通知订阅者
   */
  private updatePrice(price: number, source: string): void {
    this.currentPrice = price;
    this.lastUpdateTime = new Date();

    const priceData: PriceData = {
      price,
      timestamp: this.lastUpdateTime,
      source,
    };

    this.priceHistory.push(priceData);

    // 保留最近 1000 个价格点
    if (this.priceHistory.length > 1000) {
      this.priceHistory.shift();
    }

    // 通知订阅者
    this.subscribers.forEach((callback) => {
      try {
        callback(price);
      } catch (error) {
        logger.error("价格订阅者回调函数执行失败:", error);
      }
    });

    logger.debug(`价格更新：$${price.toFixed(2)} from ${source}`);
  }

  /**
   * 订阅价格更新回调
   */
  subscribePrice(callback: (price: number) => void): () => void {
    this.subscribers.push(callback);

    // 返回取消订阅函数
    return () => {
      const index = this.subscribers.indexOf(callback);
      if (index > -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  /**
   * 获取指定时间范围内的 OHLC 数据
   */
  getOHLC(intervalMinutes: number = 60): OHLC[] {
    if (this.priceHistory.length === 0) {
      return [];
    }

    const ohlcData: OHLC[] = [];
    const intervalMs = intervalMinutes * 60 * 1000;
    const now = Date.now();
    const startTime = now - 24 * 60 * 60 * 1000; // 最近 24 小时

    for (let time = startTime; time < now; time += intervalMs) {
      const periodData = this.priceHistory.filter((p) => {
        const t = p.timestamp.getTime();
        return t >= time && t < time + intervalMs;
      });

      if (periodData.length > 0) {
        const prices = periodData.map((p) => p.price);
        ohlcData.push({
          open: prices[0],
          high: Math.max(...prices),
          low: Math.min(...prices),
          close: prices[prices.length - 1],
          timestamp: new Date(time),
        });
      }
    }

    return ohlcData;
  }

  /**
   * 获取价格历史数据
   */
  getPriceHistory(): PriceData[] {
    return [...this.priceHistory];
  }

  /**
   * 启动价格轮询定时任务
   */
  private startPricePolling(): void {
    // 每 10 秒轮询一次
    setInterval(async () => {
      try {
        await this.getPrice();
      } catch (error) {
        logger.error("价格轮询任务执行失败:", error);
      }
    }, 10000);

    // Initial fetch
    this.getPrice();
  }

  /**
   * Get last update time
   */
  getLastUpdateTime(): Date {
    return this.lastUpdateTime;
  }
}

// Export singleton instance
export const priceService = new PriceService();
