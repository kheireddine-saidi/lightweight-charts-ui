/**
 * Storage interfaces — forward-compatible contracts for future backends.
 *
 * Current implementation: in-memory / no-op stubs.
 * Future backends:
 *   - Market data:    Parquet + DuckDB (via API layer)
 *   - Trade history:  PostgreSQL
 *
 * Future architecture:
 *   Parquet → DuckDB → REST API → IMarketDataStorage
 *   PostgreSQL → REST API → ITradeStorage
 *
 * DO NOT implement actual backends here.
 * Replace the stub implementations with real API calls when the backend exists.
 */

// ─── Market Data Storage ──────────────────────────────────────────────────

/**
 * @interface
 */
export class IMarketDataStorage {
  /**
   * Fetch historical candles from storage.
   * @param {string} symbol
   * @param {string} timeframe
   * @param {number} [startTime]  Unix seconds
   * @param {number} [endTime]    Unix seconds
   * @returns {Promise<import('../feeds/IDataFeed').Candle[]>}
   */
  // eslint-disable-next-line no-unused-vars
  async fetchCandles(symbol, timeframe, startTime, endTime) {
    throw new Error('IMarketDataStorage.fetchCandles() not implemented');
  }

  /**
   * Persist candles to storage.
   * @param {string} symbol
   * @param {string} timeframe
   * @param {import('../feeds/IDataFeed').Candle[]} candles
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async storeCandles(symbol, timeframe, candles) {
    throw new Error('IMarketDataStorage.storeCandles() not implemented');
  }

  /**
   * List available (symbol, timeframe) pairs.
   * @returns {Promise<{ symbol: string, timeframe: string }[]>}
   */
  async listDatasets() {
    throw new Error('IMarketDataStorage.listDatasets() not implemented');
  }
}

// ─── Trade Storage ─────────────────────────────────────────────────────────

/**
 * @interface
 */
export class ITradeStorage {
  /**
   * Persist a completed backtest result.
   * @param {import('../types/backtest').BacktestResult} result
   * @returns {Promise<string>}  stored result id
   */
  // eslint-disable-next-line no-unused-vars
  async saveBacktest(result) {
    throw new Error('ITradeStorage.saveBacktest() not implemented');
  }

  /**
   * Load a backtest result by id.
   * @param {string} id
   * @returns {Promise<import('../types/backtest').BacktestResult | null>}
   */
  // eslint-disable-next-line no-unused-vars
  async loadBacktest(id) {
    throw new Error('ITradeStorage.loadBacktest() not implemented');
  }

  /**
   * List all saved backtest summaries (without full trade arrays).
   * @returns {Promise<{ id: string, symbol: string, timeframe: string, createdAt: string, metrics: object }[]>}
   */
  async listBacktests() {
    throw new Error('ITradeStorage.listBacktests() not implemented');
  }

  /**
   * Delete a backtest result.
   * @param {string} id
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async deleteBacktest(id) {
    throw new Error('ITradeStorage.deleteBacktest() not implemented');
  }
}

// ─── Session Snapshot Storage ──────────────────────────────────────────────

/**
 * @interface
 */
export class ISessionStorage {
  /**
   * @param {import('../engine/session/SessionSnapshot').Snapshot} snapshot
   * @returns {Promise<string>}  key
   */
  // eslint-disable-next-line no-unused-vars
  async saveSnapshot(snapshot) {
    throw new Error('ISessionStorage.saveSnapshot() not implemented');
  }

  /**
   * @param {string} key
   * @returns {Promise<import('../engine/session/SessionSnapshot').Snapshot | null>}
   */
  // eslint-disable-next-line no-unused-vars
  async loadSnapshot(key) {
    throw new Error('ISessionStorage.loadSnapshot() not implemented');
  }

  /**
   * @returns {Promise<{ key: string, symbol: string, timeframe: string, createdAt: string }[]>}
   */
  async listSnapshots() {
    throw new Error('ISessionStorage.listSnapshots() not implemented');
  }
}
