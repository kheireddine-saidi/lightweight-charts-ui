/**
 * BinanceLiveFeed — live market data from Binance REST + WebSocket.
 *
 * Chart components should never import from services/binance directly.
 * Use this feed as the single bridge to Binance.
 *
 * IMPORTANT: subscribe() now delegates to FeedManager to guarantee
 * per-chart subscription isolation. Multiple charts on the same
 * symbol+timeframe will share one WebSocket but get independent callbacks.
 */
import { IDataFeed } from './IDataFeed';
import { getKlines } from '../services/binance';
import { feedManager } from './FeedManager';

/** Auto-incrementing counter to ensure unique subscription IDs. */
let _subscribeCounter = 0;

export class BinanceLiveFeed extends IDataFeed {
  /**
   * @param {string} [feedId] Optional stable feed identity for FeedManager.
   *   Pass a per-chart ID (e.g. `chart-1`) so the subscription is properly
   *   isolated and cleaned up.
   */
  constructor(feedId) {
    super();
    /** @type {string} unique ID for this feed instance's subscription */
    this._feedId = feedId ?? `feed-${++_subscribeCounter}`;
    /** @type {(() => void) | null} */
    this._unsub = null;
  }

  /**
   * @param {string} symbol
   * @param {string} timeframe
   * @param {number} [limit=1000]
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('./IDataFeed').Candle[]>}
   */
  async loadHistory(symbol, timeframe, limit = 1000, signal) {
    return getKlines(symbol, timeframe, limit, signal);
  }

  /**
   * Load older candles ending before the given timestamp (unix ms).
   * Used for infinite scroll — loads the page of candles that precede
   * the oldest candle currently displayed.
   */
  async loadHistoryBefore(symbol, timeframe, endTimeMs, limit = 500, signal) {
    return getKlines(symbol, timeframe, limit, signal, endTimeMs);
  }

  /**
   * Subscribe to live candle updates.
   * Uses FeedManager internally so subscribing one chart never kills another.
   *
   * @param {string} symbol
   * @param {string} timeframe
   * @param {(candle: import('./IDataFeed').Candle) => void} callback
   * @returns {() => void}
   */
  subscribe(symbol, timeframe, callback) {
    // Clean up our previous subscription slot in FeedManager
    this.unsubscribe();
    this._unsub = feedManager.subscribe({
      id: this._feedId,
      symbol,
      timeframe,
      callback,
    });
    return this._unsub;
  }

  unsubscribe() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }

  getCurrentTime() {
    return Date.now() / 1000;
  }
}

/** Singleton for convenience — import this in components. */
export const binanceLiveFeed = new BinanceLiveFeed('default-feed');

