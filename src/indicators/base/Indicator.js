/**
 * Indicator base class.
 *
 * All indicators must implement:
 *   init(history)   — bulk compute from historical data
 *   update(candle)  — incremental update on a single new candle (O(1))
 *   reset()         — clear all state
 *
 * The update() method must NOT recompute the full history.
 * Chart series management is handled separately by IndicatorPlugin (IIndicator.js).
 *
 * No React imports. No chart imports.
 */
export class Indicator {
  /**
   * @param {string} id     unique identifier, e.g. 'sma_20'
   * @param {string} name   display name, e.g. 'SMA 20'
   */
  constructor(id, name) {
    this.id = id;
    this.name = name;
    /** @type {{ time: number, value: number }[]} full output series */
    this.series = [];
  }

  /**
   * Bulk-initialise from historical candles.
   * Called once when replay starts or historical data is loaded.
   * @param {import('../../feeds/IDataFeed').Candle[]} history
   */
  // eslint-disable-next-line no-unused-vars
  init(history) {
    throw new Error(`${this.constructor.name}.init() must be implemented`);
  }

  /**
   * Incrementally process one new candle without recomputing history.
   * Must be O(1) or O(period) at most.
   * @param {import('../../feeds/IDataFeed').Candle} candle
   * @returns {{ time: number, value: number } | null}  new data point or null
   */
  // eslint-disable-next-line no-unused-vars
  update(candle) {
    throw new Error(`${this.constructor.name}.update() must be implemented`);
  }

  /** Clear all state so the indicator can be re-initialised. */
  reset() {
    this.series = [];
  }

  /** @returns {{ time: number, value: number } | null} last computed point */
  getLast() {
    return this.series.length > 0 ? this.series[this.series.length - 1] : null;
  }
}
