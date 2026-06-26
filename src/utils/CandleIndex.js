/**
 * CandleIndex — O(1) candle lookup by timestamp.
 *
 * Problem: crosshair/mouse events fire at high frequency and the chart
 * needs to find the candle that corresponds to the hovered timestamp.
 * A linear scan (O(n)) over thousands of candles causes jank.
 *
 * Solution: build a Map<time → arrayIndex> once when data is loaded.
 * All subsequent lookups are O(1).
 *
 * No React imports. No chart imports.
 */
export class CandleIndex {
  constructor() {
    /** @type {Map<number, number>} time (Unix s) → array index */
    this._map = new Map();
    /** @type {import('../feeds/IDataFeed').Candle[]} */
    this._data = [];
  }

  /**
   * Build the index from a candle array.
   * Call this once after loadHistory() or setData().
   * @param {import('../feeds/IDataFeed').Candle[]} candles
   */
  build(candles) {
    this._data = candles;
    this._map = new Map();
    for (let i = 0; i < candles.length; i++) {
      this._map.set(candles[i].time, i);
    }
  }

  /**
   * O(1) lookup.
   * @param {number} time  Unix seconds
   * @returns {number}  array index, or -1 if not found
   */
  indexOf(time) {
    return this._map.has(time) ? this._map.get(time) : -1;
  }

  /**
   * @param {number} time
   * @returns {import('../feeds/IDataFeed').Candle | null}
   */
  getCandle(time) {
    const idx = this.indexOf(time);
    return idx !== -1 ? this._data[idx] : null;
  }

  /**
   * @param {number} index
   * @returns {import('../feeds/IDataFeed').Candle | null}
   */
  getByIndex(index) {
    return this._data[index] ?? null;
  }

  get size() {
    return this._data.length;
  }

  clear() {
    this._map.clear();
    this._data = [];
  }
}
