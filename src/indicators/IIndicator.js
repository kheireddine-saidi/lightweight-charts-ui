/**
 * IndicatorPlugin — chart-layer adapter for an Indicator computation object.
 *
 * Lifecycle
 * ─────────
 * attach(data, chart)
 *   Called once when data is first loaded or the indicator is added.
 *   Uses setData() — acceptable here because this is a bulk initialisation.
 *
 * updateIncremental(candle, chart)   ← NEW — use during replay / live feed
 *   Calls Indicator.update(candle) — O(1) — then series.update() with
 *   only the new point. Never re-scans the full history.
 *
 * update(data, chart)                ← legacy — kept for backward compat
 *   Recomputes the last point via compute() and calls series.update().
 *   Slower than updateIncremental but safe for one-off use.
 *
 * detach(chart)
 *   Removes the series from the chart.
 *
 * No React imports.
 */

export class IndicatorPlugin {
  constructor(id, name, defaultParams = {}) {
    this.id     = id;
    this.name   = name;
    this.params = { ...defaultParams };
    /** @type {any} Lightweight Charts series instance */
    this._series = null;
    /** @type {import('./base/Indicator').Indicator | null} */
    this._indicator = null; // set by subclasses that use Indicator base class
  }

  // ── Core API ─────────────────────────────────────────────────────────────

  /**
   * Initial attach — bulk compute + setData().
   * Acceptable once on load; do not call during replay ticks.
   * @param {object[]} data   full candle array
   * @param {object}   chart  Lightweight Charts IChartApi instance
   */
  attach(data, chart) {
    if (!this._series) {
      this._series = this.createSeries(chart);
    }
    const points = this.compute(data, this.params);
    this._series.setData(points);

    // If this plugin owns an Indicator instance, seed it now so
    // updateIncremental() works correctly from this point.
    if (this._indicator) {
      this._indicator.init(data);
    }
  }

  /**
   * Incremental update — O(1). Use during replay and live feed.
   * Calls Indicator.update(candle) then series.update() with the single
   * new point. Never scans the full history.
   *
   * Falls back to legacy update() if _indicator is not set.
   *
   * @param {import('../feeds/IDataFeed').Candle} candle  new candle
   * @param {object} chart  Lightweight Charts IChartApi instance
   */
  updateIncremental(candle, chart) {
    if (!this._series) {
      // Not yet attached — nothing to update
      return;
    }

    if (this._indicator) {
      // Fast path: incremental O(1) computation
      const point = this._indicator.update(candle);
      if (point) {
        this._series.update(point);
      }
      return;
    }

    // Slow fallback: recompute last point (legacy behaviour)
    // This branch is only hit for indicators that haven't been migrated
    // to extend Indicator base class yet.
    this.update(null, chart); // null triggers the legacy path
  }

  /**
   * Legacy update — recomputes the last data point from the compute()
   * method and calls series.update(). Use updateIncremental() instead
   * whenever possible.
   *
   * @param {object[] | null} data  full candle array (or null for noop)
   * @param {object} chart
   */
  update(data, chart) {
    if (!this._series) {
      if (data) this.attach(data, chart);
      return;
    }
    if (!data || data.length === 0) return;
    const points = this.compute(data, this.params);
    if (points.length > 0) {
      this._series.update(points[points.length - 1]);
    }
  }

  /**
   * Remove series from chart and release internal state.
   * @param {object} chart
   */
  detach(chart) {
    if (this._series) {
      try { chart.removeSeries(this._series); } catch { /* ignore */ }
      this._series = null;
    }
    if (this._indicator) {
      this._indicator.reset();
    }
  }

  // ── Overrideable ─────────────────────────────────────────────────────────

  /**
   * Bulk compute all points from a full candle array.
   * Override in subclasses. Used only by attach() and legacy update().
   * @param {object[]} _data
   * @param {object}   _params
   * @returns {{ time: number, value: number }[]}
   */
  compute(_data, _params) { return []; }

  /**
   * Create and return the Lightweight Charts series for this indicator.
   * Must be overridden in subclasses.
   * @param {object} _chart
   * @returns {object}  series instance
   */
  createSeries(_chart) { throw new Error('IndicatorPlugin.createSeries() not implemented'); }
}
