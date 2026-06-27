/**
 * ChartDataManager — owns candle loading and feed subscription for one chart.
 *
 * Responsibilities:
 *  - loadHistory via feed
 *  - subscribe to live candle updates via FeedManager (per-chart isolation)
 *  - unsubscribe cleanly on destroy
 *  - notify callers via callbacks (no React imports)
 *
 * Does NOT contain chart rendering, indicator, or trading logic.
 */

import { feedManager } from '../../feeds/FeedManager';
import { intervalToSeconds as _intervalToSeconds } from '../../utils/timeframes';

export class ChartDataManager {
  /**
   * @param {{
   *   chartId: string | number,
   *   feed: import('../../feeds/IDataFeed').IDataFeed,
   *   onCandle: (candle: import('../../feeds/IDataFeed').Candle, allData: import('../../feeds/IDataFeed').Candle[]) => void,
   *   onHistoryLoaded: (data: import('../../feeds/IDataFeed').Candle[]) => void,
   *   onError?: (err: Error) => void,
   * }} opts
   */
  constructor({ chartId, feed, onCandle, onHistoryLoaded, onError }) {
    this._chartId = String(chartId);
    this._feed = feed;
    this._onCandle = onCandle;
    this._onHistoryLoaded = onHistoryLoaded;
    this._onError = onError ?? ((err) => console.error('[ChartDataManager]', err));

    /** @type {import('../../feeds/IDataFeed').Candle[]} */
    this._data = [];

    /** @type {string | null} current symbol */
    this._symbol = null;
    /** @type {string | null} current timeframe */
    this._timeframe = null;

    /** @type {AbortController | null} */
    this._loadAbort = null;

    /** @type {(() => void) | null} unsubscribe live feed */
    this._unsubscribe = null;
  }

  /** All loaded candles (live-updated). */
  get data() { return this._data; }

  get symbol() { return this._symbol; }
  get timeframe() { return this._timeframe; }

  /**
   * Load data for a symbol/timeframe. Cleans up any previous subscription.
   * @param {string} symbol
   * @param {string} timeframe
   * @param {number} [limit=1000]
   */
  async load(symbol, timeframe, limit = 1000) {
    // Abort any in-flight request
    if (this._loadAbort) {
      this._loadAbort.abort();
    }
    // Unsubscribe from previous stream
    this._clearSubscription();

    this._symbol = symbol;
    this._timeframe = timeframe;
    this._data = [];

    const abortController = new AbortController();
    this._loadAbort = abortController;

    try {
      const data = await this._feed.loadHistory(symbol, timeframe, limit, abortController.signal);
      if (abortController.signal.aborted) return;

      this._data = Array.isArray(data) ? data : [];
      this._onHistoryLoaded(this._data);

      // Subscribe for live updates — using FeedManager for per-chart isolation
      this._unsubscribe = feedManager.subscribe({
        id: `chart-${this._chartId}-${symbol}-${timeframe}`,
        symbol,
        timeframe,
        callback: (ticker) => this._handleLiveTick(ticker, timeframe),
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      this._onError(err);
    } finally {
      if (this._loadAbort === abortController) {
        this._loadAbort = null;
      }
    }
  }

  /**
   * Unsubscribe and release all resources.
   */
  destroy() {
    if (this._loadAbort) {
      this._loadAbort.abort();
      this._loadAbort = null;
    }
    this._clearSubscription();
    this._data = [];
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _clearSubscription() {
    if (this._unsubscribe) {
      try { this._unsubscribe(); } catch (_) { /* ignore */ }
      this._unsubscribe = null;
    }
  }

  /**
   * Normalise a live tick and merge it into the internal data array.
   * Emits via onCandle callback.
   */
  _handleLiveTick(ticker, timeframe) {
    if (!ticker) return;

    // NOTE: intervalToSeconds is imported at construction; passed via timeframe param
    // Approximate from the stored timeframe if needed
    const intervalSeconds = _intervalToSeconds(timeframe);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return;

    const parsedCandle = {
      time: Number(ticker.time),
      open: Number(ticker.open),
      high: Number(ticker.high),
      low: Number(ticker.low),
      close: Number(ticker.close),
    };

    if (!['open', 'high', 'low', 'close'].every((k) => Number.isFinite(parsedCandle[k]))) return;

    const candleTime = Math.floor(parsedCandle.time / intervalSeconds) * intervalSeconds;
    const normalised = { ...parsedCandle, time: candleTime };

    const last = this._data.length - 1;
    if (last >= 0 && this._data[last].time === candleTime) {
      this._data[last] = normalised;
    } else {
      this._data = [...this._data, normalised];
    }

    this._onCandle(normalised, this._data);
  }
}
