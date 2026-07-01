/**
 * ReplayFeed — static data feed for replay / backtest mode.
 *
 * Wraps a pre-loaded candle array so that the chart can use the same
 * IDataFeed contract regardless of whether it is showing live or replay data.
 *
 * CHANGED (Phase 3):
 *  - advanceTo(timestamp) resolves the nearest candle via binary search.
 *  - advanceTo emits Events.CANDLE (ExecutionEngine subscribed first in main.jsx,
 *    making ordering explicit (engine always sees the candle before renderers).
 *  - subscribe() still emits per-candle via the advanceTo path; direct
 *    subscription is still a no-op (clock drives everything).
 */
import { IDataFeed } from './IDataFeed';
import { EventBus, Events } from '../core/EventBus';

export class ReplayFeed extends IDataFeed {
  /**
   * @param {import('./IDataFeed').Candle[]} [data=[]]
   * @param {string} [symbol='']
   */
  constructor(data = [], symbol = '') {
    super();
    /** @type {import('./IDataFeed').Candle[]} sorted ascending by time */
    this._data = data;
    /** @type {string} */
    this._symbol = symbol;
    /** @type {number} index of last emitted candle */
    this._currentIndex = 0;
    /** @type {number|null} timestamp of last emitted candle */
    this._lastEmittedTime = null;
  }

  /**
   * Replace the candle dataset (call before or after loading).
   * @param {import('./IDataFeed').Candle[]} data
   * @param {string} [symbol]
   */
  setData(data, symbol) {
    this._data = Array.isArray(data) ? data : [];
    if (symbol !== undefined) this._symbol = symbol;
    this._currentIndex = 0;
    this._lastEmittedTime = null;
  }

  /**
   * Advance the internal cursor (legacy compat — called by seek logic).
   * @param {number} index
   */
  setIndex(index) {
    this._currentIndex = Math.max(0, Math.min(index, this._data.length - 1));
  }

  /**
   * Advance replay to the given timestamp.
   * Uses binary search to find the latest candle with time <= timestamp.
   * If that candle is newer than the last emitted candle, calls
   * EventBus.emit(Events.CANDLE) — ExecutionEngine processes synchronously first
   * Events.CANDLE for renderers.
   *
   * @param {number} timestamp  Unix seconds
   */
  advanceTo(timestamp) {
    if (!this._data.length) return;

    const idx = this._binarySearchFloor(timestamp);
    if (idx < 0) return;

    const candle = this._data[idx];
    if (!candle) return;

    // Only emit if this is a newer (or newly revealed) candle
    if (this._lastEmittedTime !== null && candle.time <= this._lastEmittedTime) return;

    this._currentIndex = idx;
    this._lastEmittedTime = candle.time;

    // Emit CANDLE — ExecutionEngine (subscribed first via start() in main.jsx)
    // processes this synchronously before any chart renderer sees it,
    // making the ordering explicit without a direct import.
    EventBus.emit(Events.CANDLE, { candle, index: idx, symbol: this._symbol });
  }

  /**
   * Reset lastEmittedTime so advanceTo will re-emit from the beginning.
   * Call this when seeking backward or loading new data.
   */
  reset() {
    this._currentIndex = 0;
    this._lastEmittedTime = null;
  }

  // ─── IDataFeed ────────────────────────────────────────────────────────────

  async loadHistory() {
    return this._data.slice();
  }

  /**
   * ReplayFeed does not emit live updates — subscription is a no-op.
   * Live candle emission is driven by SimulationClock → REPLAY_TICK → advanceTo.
   */
  // eslint-disable-next-line no-unused-vars
  subscribe(_symbol, _timeframe, _callback) {
    return () => {};
  }

  unsubscribe() {}

  getCurrentTime() {
    return this._data[this._currentIndex]?.time ?? Date.now() / 1000;
  }

  /** @returns {import('./IDataFeed').Candle | null} */
  getCurrentCandle() {
    return this._data[this._currentIndex] ?? null;
  }

  get length() {
    return this._data.length;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  /**
   * Binary search: find the largest index i such that this._data[i].time <= target.
   * Returns -1 if no such index exists.
   * @param {number} target  Unix seconds
   * @returns {number}
   */
  _binarySearchFloor(target) {
    let lo = 0;
    let hi = this._data.length - 1;
    let result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this._data[mid].time <= target) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }
}
