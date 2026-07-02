/**
 * ChartDataManager — owns candle loading and live feed subscription for one chart.
 *
 * PHASE 4 MIGRATION COMPLETE.
 *
 * Responsibilities:
 *  - loadHistory via feed (with AbortController for cancellation)
 *  - Subscribe to live candle updates via FeedManager (per-chart isolation, no
 *    cross-chart unsubscription bugs)
 *  - Normalise raw ticker objects → {time,open,high,low,close,isClosed}
 *  - Merge ticks into the internal candle array (update-in-place or append)
 *  - Notify callers via typed callbacks — no React, no EventBus, no chart imports
 *
 * Callers receive:
 *   onHistoryLoaded(data)               — full candle array after history fetch
 *   onCandle(candle, allData, isClosed) — every live tick, plus closed flag
 *   onError(err)                        — fetch / subscription errors
 *
 * Does NOT emit EventBus events, touch the execution engine, or call series methods.
 * Those responsibilities belong to ChartComponent, which wires the callbacks.
 */

import { feedManager } from '../feeds/FeedManager';
import { intervalToSeconds as _intervalToSeconds } from '../utils/timeframes';

export class ChartDataManager {
  /**
   * @param {{
   *   chartId: string | number,
   *   feed: import('../feeds/IDataFeed').IDataFeed,
   *   onCandle: (candle: object, allData: object[], isClosed: boolean) => void,
   *   onHistoryLoaded: (data: object[]) => void,
   *   onError?: (err: Error) => void,
   * }} opts
   */
  constructor({ chartId, feed, onCandle, onHistoryLoaded, onError }) {
    this._chartId         = String(chartId);
    this._feed            = feed;
    this._onCandle        = onCandle;
    this._onHistoryLoaded = onHistoryLoaded;
    this._onError         = onError ?? ((err) => console.error('[ChartDataManager]', err));

    /** @type {object[]} normalised candle array, live-updated */
    this._data        = [];
    /** @type {string | null} */
    this._symbol      = null;
    /** @type {string | null} */
    this._timeframe   = null;
    /** @type {AbortController | null} */
    this._loadAbort   = null;
    /** @type {(() => void) | null} */
    this._unsubscribe = null;
  }

  // ─── Public getters ───────────────────────────────────────────────────────

  /** Normalised candle array (live-updated). Read-only — do not mutate. */
  get data()      { return this._data; }
  get symbol()    { return this._symbol; }
  get timeframe() { return this._timeframe; }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Load history for a symbol/timeframe and start the live subscription.
   * Cancels any in-flight load and tears down the previous subscription first.
   *
   * @param {string} symbol
   * @param {string} timeframe
   * @param {number} [limit=1000]
   */
  async load(symbol, timeframe, limit = 1000) {
    // Cancel previous in-flight history fetch
    this._loadAbort?.abort();
    // Tear down previous WebSocket subscription
    this._clearSubscription();

    this._symbol    = symbol;
    this._timeframe = timeframe;
    this._data      = [];

    const ctrl = new AbortController();
    this._loadAbort = ctrl;

    try {
      const raw = await this._feed.loadHistory(symbol, timeframe, limit, ctrl.signal);
      if (ctrl.signal.aborted) return;

      this._data = Array.isArray(raw) ? raw : [];
      this._onHistoryLoaded(this._data);

      // Start live WebSocket subscription via FeedManager so multiple charts
      // on the same symbol share one underlying WebSocket without interference.
      this._unsubscribe = feedManager.subscribe({
        id:        `cdm-${this._chartId}-${symbol}-${timeframe}`,
        symbol,
        timeframe,
        callback:  (ticker) => this._handleLiveTick(ticker),
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      this._onError(err);
    } finally {
      if (this._loadAbort === ctrl) {
        this._loadAbort = null;
      }
    }
  }

  /**
   * Swap to a different feed without triggering a full symbol/timeframe reload.
   * Used when switching between live and replay modes.
   * @param {object} feed  IDataFeed implementation
   */
  setFeed(feed) {
    this._feed = feed;
  }

  /**
   * Prepend older candles (pagination / scroll-left).
   * Deduplicates against existing data before prepending.
   * Calls onHistoryLoaded with the full updated array.
   *
   * @param {object[]} olderCandles  sorted ascending by time
   */
  prependHistory(olderCandles) {
    if (!Array.isArray(olderCandles) || olderCandles.length === 0) return;
    const existingTimes = new Set(this._data.map(c => c.time));
    const fresh = olderCandles.filter(c => !existingTimes.has(c.time));
    if (!fresh.length) return;
    this._data = [...fresh, ...this._data];
    this._onHistoryLoaded(this._data);
  }

  /**
   * Directly replace the internal candle array (e.g. on chart-type transform).
   * Does NOT re-fire onHistoryLoaded.
   * @param {object[]} data
   */
  setData(data) {
    this._data = Array.isArray(data) ? data : [];
  }

  /**
   * Release all resources: abort in-flight fetch, close WebSocket subscription.
   */
  destroy() {
    this._loadAbort?.abort();
    this._loadAbort = null;
    this._clearSubscription();
    this._data = [];
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _clearSubscription() {
    if (this._unsubscribe) {
      try { this._unsubscribe(); } catch (_) { /* ignore */ }
      this._unsubscribe = null;
    }
  }

  /**
   * Normalise a raw ticker from the WebSocket stream, merge into the internal
   * data array, and fire onCandle. The `isClosed` flag is passed through so
   * the chart can decide whether to emit EventBus.CANDLE and close-candle
   * indicators without ChartDataManager needing to know about either.
   *
   * @param {object} ticker  raw object from FeedManager callback
   */
  _handleLiveTick(ticker) {
    if (!ticker) return;

    const intervalSeconds = _intervalToSeconds(this._timeframe);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return;

    const parsed = {
      time:  Number(ticker.time),
      open:  Number(ticker.open),
      high:  Number(ticker.high),
      low:   Number(ticker.low),
      close: Number(ticker.close),
    };

    if (!['open', 'high', 'low', 'close'].every(k => Number.isFinite(parsed[k]))) return;

    // Align to interval boundary (Binance kline.t is already in ms; we stored seconds)
    const candleTime = Math.floor(parsed.time / intervalSeconds) * intervalSeconds;
    const normalised = { ...parsed, time: candleTime };

    const last = this._data.length - 1;
    if (last >= 0 && this._data[last].time === candleTime) {
      // Update the forming candle in-place
      this._data[last] = normalised;
    } else {
      // New candle opened — use a new array reference so callers can detect changes
      this._data = [...this._data, normalised];
    }

    this._onCandle(normalised, this._data, ticker.isClosed === true);
  }
}
