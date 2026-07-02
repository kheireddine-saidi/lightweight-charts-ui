/**
 * IndicatorRenderer — owns the PineTS indicator lifecycle for one chart instance.
 *
 * Extracted from ChartComponent.runPineIndicators in Phase 5.
 *
 * Responsibilities:
 *  - Maintain a PineTSRuntime (create once, update candles on reload)
 *  - Synchronise enabled indicators with IndicatorEngine (tick-time debounced re-runs)
 *  - Run all enabled Pine indicators on demand (full re-run on data change)
 *  - Manage per-indicator LWC series (remove stale, create new)
 *  - Update the indicator store's title when PineTS reports a different name
 *
 * Does NOT own React state, EventBus subscriptions, or series data rendering.
 * ChartComponent calls renderer.run(data) whenever the candle array changes.
 */

import { LineSeries } from 'lightweight-charts';
import { PineTSRuntime }   from '../../indicators/PineTSRuntime';
import { IndicatorEngine } from './IndicatorEngine';
import { useIndicatorStore } from '../../stores/indicatorStore';

export class IndicatorRenderer {
  /**
   * @param {{
   *   indicatorRegistry: object,   IndicatorRegistry instance (built-ins)
   * }} opts
   */
  constructor({ indicatorRegistry }) {
    this._registry      = indicatorRegistry;
    this._pineRuntime   = null;      // PineTSRuntime, created lazily
    this._engine        = null;      // IndicatorEngine facade, created lazily
    this._chart         = null;      // current LWC chart API
    /** @type {Record<string, object[]>} indicatorId → LWC series array */
    this._pineSeries    = {};
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Set (or update) the LWC chart reference.
   * Call after chart creation and after every series swap.
   * @param {object} chart  LWC chart API
   */
  setChart(chart) {
    this._chart = chart;
    if (this._engine) {
      this._engine.setChart(chart);
    }
  }

  /**
   * Run all enabled Pine indicators against the supplied candle data.
   * Creates/updates PineTSRuntime and IndicatorEngine on first call.
   * Safe to call with an empty data array (returns immediately).
   *
   * @param {object[]} data  raw candles [{time,open,high,low,close}]
   * @returns {Promise<void>}
   */
  async run(data) {
    const chart = this._chart;
    if (!chart || !data?.length) return;

    // ── PineTSRuntime lifecycle ──────────────────────────────────────────
    if (!this._pineRuntime) {
      this._pineRuntime = new PineTSRuntime(data);
    } else {
      this._pineRuntime.updateCandles(data);
    }

    // ── IndicatorEngine sync ─────────────────────────────────────────────
    // The engine holds per-indicator wrappers that handle debounced tick updates.
    const enabledInds = useIndicatorStore.getState().indicators.filter(i => i.enabled);

    if (!this._engine) {
      this._engine = new IndicatorEngine(
        this._registry,
        this._pineRuntime,
        chart,
        {
          pineDebounceMs: 100,
          onPineResult: () => {
            // Tick-time incremental results are handled by IndicatorEngine internally.
            // Full re-runs are driven by this.run() calls from ChartComponent.
          },
        },
      );
    } else {
      this._engine._pineRuntime = this._pineRuntime;
      this._engine._chart       = chart;
    }

    this._engine._data = Array.isArray(data) ? data : [];
    this._engine.updatePine(enabledInds);

    // ── Full re-run of all enabled indicators ────────────────────────────
    const currentIds = new Set(enabledInds.map(i => i.id));

    // Remove series for indicators that were disabled since last run
    for (const [id, seriesList] of Object.entries(this._pineSeries)) {
      if (!currentIds.has(id)) {
        for (const s of seriesList) {
          try { chart.removeSeries(s); } catch (_) { /* ignore */ }
        }
        delete this._pineSeries[id];
      }
    }

    // Run each enabled indicator and sync its output series
    for (const ind of enabledInds) {
      const result = await this._pineRuntime.run(ind.source, ind.params);
      // Chart may have been destroyed mid-run (symbol/interval change)
      if (!this._chart) return;
      if (result.error) {
        console.warn(`[IndicatorRenderer] ${ind.title}:`, result.error);
        continue;
      }

      // Propagate title changes back to the store (PineTS may resolve a display name)
      if (result.title && result.title !== ind.title) {
        useIndicatorStore.getState().upsert({ ...ind, title: result.title });
      }

      // Remove old series for this indicator before creating new ones
      const oldSeries = this._pineSeries[ind.id] ?? [];
      for (const s of oldSeries) {
        try { this._chart.removeSeries(s); } catch (_) { /* ignore */ }
      }

      const newSeries = [];
      for (const seriesOut of result.series) {
        if (!seriesOut.data.length) continue;
        try {
          const ls = this._chart.addSeries(LineSeries, {
            lineWidth:          seriesOut.lineWidth ?? 1,
            color:              seriesOut.color,
            title:              seriesOut.name,
            priceScaleId:       'right',
            lastValueVisible:   true,
            priceLineVisible:   false,
          });
          ls.setData(seriesOut.data);
          newSeries.push(ls);
        } catch (e) {
          console.warn('[IndicatorRenderer] series add error:', e);
        }
      }
      this._pineSeries[ind.id] = newSeries;
    }
  }

  /**
   * Incremental update — called on every live tick (fast path).
   * Delegates to IndicatorEngine which handles debouncing.
   * @param {object} candle  latest normalised candle
   */
  updateIncremental(candle) {
    if (this._engine) {
      this._engine.updateIncremental(candle);
    }
  }

  /**
   * Force a full Pine re-run with explicitly provided data
   * (used after pagination prepend when dataRef already updated).
   * @param {object[]} data
   */
  runWithData(data) {
    if (this._engine) {
      this._engine.runPineWithData(data);
    }
    return this.run(data);
  }

  /**
   * Remove all Pine series from the chart and clear internal state.
   * Call on unmount or when the chart is destroyed.
   */
  destroy() {
    for (const seriesList of Object.values(this._pineSeries)) {
      for (const s of seriesList) {
        try { this._chart?.removeSeries(s); } catch (_) { /* ignore */ }
      }
    }
    this._pineSeries  = {};
    this._engine      = null;
    this._pineRuntime = null;
    this._chart       = null;
  }
}
