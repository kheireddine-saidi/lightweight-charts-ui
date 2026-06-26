/**
 * ReplayFeed — static data feed for replay / backtest mode.
 *
 * Wraps a pre-loaded candle array so that the chart can use the same
 * IDataFeed contract regardless of whether it is showing live or replay data.
 * Playback is driven externally by SimulationClock; this feed only serves
 * historical data and tracks the "current" candle index.
 */
import { IDataFeed } from './IDataFeed';

export class ReplayFeed extends IDataFeed {
  /**
   * @param {import('./IDataFeed').Candle[]} [data=[]]
   */
  constructor(data = []) {
    super();
    /** @type {import('./IDataFeed').Candle[]} */
    this._data = data;
    /** @type {number} current candle index — updated by SimulationClock */
    this._currentIndex = 0;
  }

  /**
   * Replace the candle dataset (call before or after loading).
   * @param {import('./IDataFeed').Candle[]} data
   */
  setData(data) {
    this._data = Array.isArray(data) ? data : [];
    this._currentIndex = 0;
  }

  /**
   * Advance the internal cursor (called by SimulationClock or seek logic).
   * @param {number} index
   */
  setIndex(index) {
    this._currentIndex = Math.max(0, Math.min(index, this._data.length - 1));
  }

  // ─── IDataFeed ────────────────────────────────────────────────────────────

  async loadHistory() {
    return this._data.slice();
  }

  /**
   * ReplayFeed does not emit live updates — subscription is a no-op.
   * Live candle emission is handled by SimulationClock → EventBus.
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
}
