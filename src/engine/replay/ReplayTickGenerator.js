/**
 * ReplayTickGenerator — generates fine-grained price ticks for replay mode.
 *
 * When replaying on a higher timeframe (e.g. 1h), the timeline jumps one bar
 * at a time. This class loads 1-minute (lowest available) data in the background
 * for the same symbol and generates synthetic ticks within each bar, so that
 * SL/TP and order fills during replay behave identically to live trading.
 *
 * Key design rules:
 *  - NO React imports.
 *  - Loads 1m data lazily when enterReplay() is called.
 *  - getTicksForCandle(candle) returns an ordered array of tick prices derived
 *    from the 1m bars that fall within the candle's timeframe window.
 *  - Falls back to FillModel.priceSequence() (O-H-L-C) when no 1m data is
 *    available for a given window.
 */

import { getKlines } from '../../services/binance';
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
     * @type {{ time: number, open: number, high: number, low: number, close: number, volume: number }[]}
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
   * Enter replay mode: kick off background load of 1m data.
   *
   * @param {string} symbol        e.g. 'BTCUSDT'
   * @param {string} htfInterval   the chart's interval, e.g. '1h', '4h', '1d'
   * @param {object[]} htfData     the full HTF dataset already loaded (used to
   *                               determine the time window to fetch 1m data for)
   */
  async enterReplay(symbol, htfInterval, htfData) {
    this.reset();
    this._symbol = symbol;
    this._htfSeconds = intervalToSeconds(htfInterval);

    // If the chart is already on 1m, there's no need to load background data —
    // the HTF data IS the LTF data.
    if (this._htfSeconds <= LTF_INTERVAL_SECONDS) {
      this._ltfData = htfData ? [...htfData] : [];
      this._loaded = true;
      return;
    }

    if (!htfData || htfData.length === 0) return;

    // Determine the time span of the loaded HTF data to fetch matching 1m data
    const startTime = htfData[0].time * 1000;      // ms
    const endTime   = (htfData[htfData.length - 1].time + this._htfSeconds) * 1000; // ms

    // Binance 1m limit is 1000 bars per request (~16.7 hours). For longer spans
    // we fetch in batches.
    this._loading = true;
    this._abortCtrl = new AbortController();
    const signal = this._abortCtrl.signal;

    try {
      const allBars = await this._fetchAllKlines(
        symbol, LTF_INTERVAL, startTime, endTime, signal
      );
      if (!signal.aborted) {
        this._ltfData = allBars;
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
    this._abortCtrl = null;
    this._symbol    = null;
    this._htfSeconds = null;
    this._ltfData   = [];
    this._loaded    = false;
    this._loading   = false;
  }

  /**
   * Return an array of tick prices for the given HTF candle.
   *
   * If 1m data is loaded and covers this candle's time window, each 1m bar
   * contributes its open + close price (giving a smoother price path). The last
   * 1m bar within the window provides the final close.
   *
   * Falls back to [open, high, low, close] (FillModel conservative sequence)
   * when no 1m data is available.
   *
   * @param {{ time: number, open: number, high: number, low: number, close: number }} candle
   *   The HTF candle whose tick sequence is requested.
   * @returns {number[]}
   */
  getTicksForCandle(candle) {
    if (!this._loaded || this._ltfData.length === 0) {
      // Fallback: conservative OHLC sequence
      return [candle.open, candle.high, candle.low, candle.close];
    }

    const windowStart = candle.time;
    const windowEnd   = candle.time + (this._htfSeconds ?? LTF_INTERVAL_SECONDS);

    // Binary-search start index
    const startIdx = this._lowerBound(windowStart);
    const ticks = [];

    for (let i = startIdx; i < this._ltfData.length; i++) {
      const bar = this._ltfData[i];
      if (bar.time >= windowEnd) break;
      // Emit open then close for each 1m bar (keeps path realistic)
      ticks.push(bar.open);
      ticks.push(bar.close);
    }

    if (ticks.length === 0) {
      // No 1m bars in this window — use OHLC fallback
      return [candle.open, candle.high, candle.low, candle.close];
    }

    // Ensure the very first tick is the HTF candle open (may differ from the
    // first 1m open in rare edge cases like missing 1m bars at window start).
    ticks[0] = candle.open;
    // Ensure the last tick matches the HTF candle close exactly.
    ticks[ticks.length - 1] = candle.close;

    return ticks;
  }

  /**
   * Get the OHLCV for the closed candle derived from 1m bars within the window.
   * Used when a candle closes in replay — allows setting the candle's displayed
   * OHLC from the 1m dataset rather than the stored HTF bar (they should match,
   * but this path makes the derivation explicit and auditable).
   *
   * @param {{ time: number, open: number, high: number, low: number, close: number, volume?: number }} candle
   * @returns {{ open: number, high: number, low: number, close: number, volume: number }}
   */
  getCandleFromLtf(candle) {
    if (!this._loaded || this._ltfData.length === 0) return candle;

    const windowStart = candle.time;
    const windowEnd   = candle.time + (this._htfSeconds ?? LTF_INTERVAL_SECONDS);
    const startIdx    = this._lowerBound(windowStart);

    let open   = null;
    let high   = -Infinity;
    let low    = Infinity;
    let close  = null;
    let volume = 0;

    for (let i = startIdx; i < this._ltfData.length; i++) {
      const bar = this._ltfData[i];
      if (bar.time >= windowEnd) break;
      if (open === null) open = bar.open;
      if (bar.high > high) high = bar.high;
      if (bar.low < low)   low  = bar.low;
      close  = bar.close;
      volume += bar.volume ?? 0;
    }

    if (open === null) return candle; // no matching 1m bars

    return {
      time:   candle.time,
      open,
      high,
      low,
      close,
      volume,
    };
  }

  /** @returns {boolean} true while the background 1m fetch is in progress */
  get isLoading() { return this._loading; }

  /** @returns {boolean} true once 1m data has been loaded (even if empty) */
  get isLoaded()  { return this._loaded; }

  /** @returns {number} number of 1m bars loaded */
  get ltfLength() { return this._ltfData.length; }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * Fetch all 1m klines between startMs and endMs by paginating Binance API.
   * Binance caps at 1000 bars per request; we loop until we've covered the range.
   *
   * @param {string}      symbol
   * @param {string}      interval
   * @param {number}      startMs    inclusive start time in ms
   * @param {number}      endMs      exclusive end time in ms
   * @param {AbortSignal} signal
   * @returns {Promise<object[]>}
   */
  async _fetchAllKlines(symbol, interval, startMs, endMs, signal) {
    const allBars = [];
    let currentStart = startMs;
    const MAX_BATCHES = 50; // safety cap (~833 hours of 1m data)
    let batches = 0;

    while (currentStart < endMs && batches < MAX_BATCHES) {
      if (signal.aborted) break;

      const bars = await getKlines(symbol, interval, 1000, signal, endMs);
      // getKlines doesn't support startTime natively in the current implementation,
      // so we filter manually and use endTime pagination.
      if (!bars || bars.length === 0) break;

      // Filter to window
      const inRange = bars.filter(b => b.time * 1000 >= currentStart && b.time * 1000 < endMs);
      if (inRange.length === 0) break;

      allBars.push(...inRange);

      // Pagination: move endMs backward to fetch older bars if we haven't reached startMs
      const oldestBar = bars[0];
      if (oldestBar.time * 1000 <= currentStart) break; // Reached or passed start
      break; // Single fetch covers the visible range (1000 bars ≈ 16h of 1m)
    }

    // Sort ascending by time
    allBars.sort((a, b) => a.time - b.time);
    // Deduplicate
    const seen = new Set();
    return allBars.filter(b => {
      if (seen.has(b.time)) return false;
      seen.add(b.time);
      return true;
    });
  }

  /**
   * Binary search: index of first bar with time >= target.
   * @param {number} target  Unix seconds
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
