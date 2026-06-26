/**
 * IDataFeed — interface contract for all market data sources.
 *
 * All feed implementations must satisfy this interface.
 * Chart components receive candles exclusively through feeds;
 * they must never import Binance services directly.
 *
 * @interface
 */
export class IDataFeed {
  /**
   * Load historical candles for the given symbol/timeframe.
   * @param {string} symbol      e.g. "BTCUSDT"
   * @param {string} timeframe   e.g. "1m", "5m", "1h"
   * @param {number} [limit]     maximum number of candles
   * @param {AbortSignal} [signal]
   * @returns {Promise<Candle[]>}
   */
  // eslint-disable-next-line no-unused-vars
  async loadHistory(symbol, timeframe, limit, signal) {
    throw new Error('IDataFeed.loadHistory() must be implemented');
  }

  /**
   * Subscribe to live candle updates.
   * @param {string} symbol
   * @param {string} timeframe
   * @param {(candle: Candle) => void} callback
   * @returns {() => void}  unsubscribe function
   */
  // eslint-disable-next-line no-unused-vars
  subscribe(symbol, timeframe, callback) {
    throw new Error('IDataFeed.subscribe() must be implemented');
  }

  /**
   * Unsubscribe all active subscriptions and clean up resources.
   */
  unsubscribe() {
    throw new Error('IDataFeed.unsubscribe() must be implemented');
  }

  /**
   * Get the current wall-clock time perceived by this feed (Unix seconds).
   * For live feeds this is Date.now()/1000; for replay feeds it's the
   * timestamp of the current candle.
   * @returns {number}
   */
  getCurrentTime() {
    throw new Error('IDataFeed.getCurrentTime() must be implemented');
  }
}

/**
 * @typedef {{ time: number, open: number, high: number, low: number, close: number, volume?: number }} Candle
 */
