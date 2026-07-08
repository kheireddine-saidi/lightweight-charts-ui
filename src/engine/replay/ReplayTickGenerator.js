/**
 * ReplayTickGenerator — generates fine-grained price ticks for replay mode.
 *
 * When replaying on a higher timeframe (e.g. 1h), the timeline jumps one bar
 * at a time. This class loads 1-minute (lowest available) data in the background
 * using the injected IDataFeed — it never imports from services/binance directly.
 *
 * Key design rules:
 *  - NO React imports. NO direct Binance imports.
 *  - Feed is injected via enterReplay(symbol, htfInterval, htfData, feed).
 *  - getTicksForCandle(candle) returns ticks from 1m bars ONLY while the HTF
 *    candle is still open (in-progress). Once a candle closes its OHLCV comes
 *    from the HTF dataset unchanged — only tick generation uses 1m data.
 *  - Falls back to [open, high, low, close] when no 1m data is available.
 */

import { intervalToSeconds } from '../../utils/timeframes';

const LTF_INTERVAL = '1m';
const LTF_INTERVAL_SECONDS = 60;

export class ReplayTickGenerator {
  constructor() {
    /** @type {string|null} */
    this._symbol = null;
    /** @type {number|null} Seconds per HTF bar */
    this._htfSeconds = null;
    /**
     * Sorted 1m bars loaded in the background.
     * @type {{ time: number, open: number, high: number, low: number, close: number, volume?: number }[]}
     */
    this._ltfData = [];
    /** @type {boolean} */
    this._loading = false;
    /** @type {boolean} */
    this._loaded = false;
    /** @type {AbortController|null} */
    this._abortCtrl = null;
  }

  /**
   * Enter replay mode: kick off background load of 1m data via the provided feed.
   *
   * @param {string}   symbol       e.g. 'BTCUSDT'
   * @param {string}   htfInterval  the chart's interval, e.g. '1h', '4h', '1d'
   * @param {object[]} htfData      the full HTF dataset already loaded
   * @param {import('../../feeds/IDataFeed').IDataFeed} feed  the active data feed
   */
  async enterReplay(symbol, htfInterval, htfData, feed) {
    this.reset();
    this._symbol    = symbol;
    this._htfSeconds = intervalToSeconds(htfInterval);

    // If the chart is already on 1m there is nothing extra to load —
    // the HTF data IS the LTF data.
    if (this._htfSeconds <= LTF_INTERVAL_SECONDS) {
      this._ltfData = htfData ? [...htfData] : [];
      this._loaded  = true;
      return;
    }

    if (!htfData || htfData.length === 0) {
      this._loaded = true;
      return;
    }

    // Only try to load if the feed exposes loadHistory (all live feeds do)
    if (!feed || typeof feed.loadHistory !== 'function') {
      this._loaded = true;
      return;
    }

    this._loading  = true;
    this._abortCtrl = new AbortController();
    const signal   = this._abortCtrl.signal;

    try {
      // Load 1m data for the same symbol — limit to the number of 1m bars that
      // fit inside the HTF window (max 1000 per Binance limit).
      const htfBarCount = htfData.length;
      const limit       = Math.min(htfBarCount * Math.ceil(this._htfSeconds / LTF_INTERVAL_SECONDS), 1000);

      const bars = await feed.loadHistory(symbol, LTF_INTERVAL, limit, signal);

      if (!signal.aborted && Array.isArray(bars)) {
        // Filter to the time window covered by the HTF data
        const windowStart = htfData[0].time;
        const windowEnd   = htfData[htfData.length - 1].time + this._htfSeconds;
        this._ltfData = bars
          .filter(b => b.time >= windowStart && b.time < windowEnd)
          .sort((a, b) => a.time - b.time);
        this._loaded = true;
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('[ReplayTickGenerator] Failed to load 1m background data:', err);
      }
    } finally {
      this._loading = false;
    }
  }

  /**
   * Abort any in-flight fetch and clear data.
   */
  reset() {
    this._abortCtrl?.abort();
    this._abortCtrl  = null;
    this._symbol     = null;
    this._htfSeconds = null;
    this._ltfData    = [];
    this._loaded     = false;
    this._loading    = false;
  }

  /**
   * Return an array of tick prices for the given HTF candle while it is
   * STILL OPEN (in progress). This is used to drive SL/TP and fill checks
   * with a realistic price path derived from 1m bars.
   *
   * Once the candle closes its OHLCV should NOT be overwritten — the HTF
   * bar's stored values are always the canonical truth for a closed candle.
   *
   * Falls back to [open, high, low, close] when no 1m data is available.
   *
   * @param {{ time: number, open: number, high: number, low: number, close: number }} candle
   * @returns {number[]}
   */
  getTicksForCandle(candle) {
    if (!this._loaded || this._ltfData.length === 0) {
      return [candle.open, candle.high, candle.low, candle.close];
    }

    const windowStart = candle.time;
    const windowEnd   = candle.time + (this._htfSeconds ?? LTF_INTERVAL_SECONDS);
    const startIdx    = this._lowerBound(windowStart);
    const ticks       = [];

    for (let i = startIdx; i < this._ltfData.length; i++) {
      const bar = this._ltfData[i];
      if (bar.time >= windowEnd) break;
      // Each 1m bar contributes open then close — gives a realistic price path
      ticks.push(bar.open);
      ticks.push(bar.close);
    }

    if (ticks.length === 0) {
      return [candle.open, candle.high, candle.low, candle.close];
    }

    // Pin first tick to HTF open and last tick to HTF close so the overall
    // range matches the stored bar exactly.
    ticks[0]              = candle.open;
    ticks[ticks.length - 1] = candle.close;

    return ticks;
  }

  /** @returns {boolean} */
  get isLoading() { return this._loading; }
  /** @returns {boolean} */
  get isLoaded()  { return this._loaded; }
  /** @returns {number} */
  get ltfLength() { return this._ltfData.length; }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * Binary search: first index where this._ltfData[i].time >= target.
   * @param {number} target
   * @returns {number}
   */
  _lowerBound(target) {
    let lo = 0, hi = this._ltfData.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._ltfData[mid].time < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** Application-wide singleton. */
export const replayTickGenerator = new ReplayTickGenerator();
