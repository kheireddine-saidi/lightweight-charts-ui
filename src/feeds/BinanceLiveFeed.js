/**
 * BinanceLiveFeed — live market data from Binance REST + WebSocket.
 *
 * Chart components should never import from services/binance directly.
 * Use this feed as the single bridge to Binance.
 */
import { IDataFeed } from './IDataFeed';
import { getKlines, subscribeToTicker } from '../services/binance';

export class BinanceLiveFeed extends IDataFeed {
  constructor() {
    super();
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
   * @param {string} symbol
   * @param {string} timeframe
   * @param {(candle: import('./IDataFeed').Candle) => void} callback
   * @returns {() => void}
   */
  subscribe(symbol, timeframe, callback) {
    // Clean up previous subscription if any
    this.unsubscribe();
    const ws = subscribeToTicker(symbol.toLowerCase(), timeframe, callback);
    this._unsub = () => ws.close();
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
export const binanceLiveFeed = new BinanceLiveFeed();
