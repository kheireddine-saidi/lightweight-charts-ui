/**
 * IndicatorRenderer — owns the PineTS indicator lifecycle for one chart instance.
 *
 * Responsibilities:
 *  - Maintain a PineTSRuntime (create once, update candles on reload)
 *  - Synchronise enabled indicators with IndicatorEngine (tick-time debounced re-runs)
 *  - Run all enabled Pine indicators on demand (full re-run on data change)
 *  - Dispatch each plot type to the correct LWC renderer:
 *      lineSeries/histograms → LineSeries/HistogramSeries
 *      markers               → createSeriesMarkers primitive on main series
 *      barOverlays           → BarSeries / CandlestickSeries
 *      hlines                → series.createPriceLine()
 *      fills/linefills       → PineFillRenderer primitives (Step 3)
 *      lines/boxes/labels    → PineObjectPool (Step 4)
 *      tables                → emitted via onTables callback for React overlay (Step 5)
 *  - Manage all created resources in per-indicator maps for clean lifecycle
 */

import { LineSeries, HistogramSeries, BarSeries, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { PineTSRuntime }   from '../../indicators/PineTSRuntime';
import { IndicatorEngine } from './IndicatorEngine';
import { useIndicatorStore } from '../../stores/indicatorStore';
import { PineFillRenderer, PineHlineFillRenderer, PineLinefillRenderer } from './PineFillRenderer.js';
import { PineObjectPool } from './PineObjectPool.js';

// ── Marker size → LWC pixel approximation ────────────────────────────────────
const SIZE_MAP = { tiny: 8, small: 12, normal: 16, large: 20, huge: 26, auto: 14 };

// ── Marker location → LWC position string ────────────────────────────────────
function locationToPosition(loc) {
  switch (loc) {
    case 'AboveBar':       return 'aboveBar';
    case 'BelowBar':       return 'belowBar';
    case 'AbsolutePrice':  return 'inBar';
    case 'Top':            return 'aboveBar';
    case 'Bottom':         return 'belowBar';
    default:               return 'aboveBar';
  }
}

// ── Marker shape → LWC shape string ─────────────────────────────────────────
function pineShapeToLWC(pineShape, char) {
  // plotchar: render as text via 'text' shape if LWC supports it, else circle
  if (char) return 'circle';
  switch (pineShape) {
    case 'shape_arrow_up':      return 'arrowUp';
    case 'shape_arrow_down':    return 'arrowDown';
    case 'shape_triangle_up':   return 'arrowUp';
    case 'shape_triangle_down': return 'arrowDown';
    case 'shape_square':        return 'square';
    case 'shape_diamond':       return 'square';
    case 'shape_circle':        return 'circle';
    case 'shape_cross':         return 'circle';
    case 'shape_xcross':        return 'circle';
    case 'shape_flag':          return 'arrowUp';
    case 'shape_label_up':      return 'arrowUp';
    case 'shape_label_down':    return 'arrowDown';
    default:                    return 'circle';
  }
}

export class IndicatorRenderer {
  /**
   * @param {{
   *   indicatorRegistry: object,
   *   chartId?: number,
   *   onTables?: (indicatorId: string, tables: object[]) => void,
   * }} opts
   */
  constructor({ indicatorRegistry, chartId = null, onTables = null }) {
    this._registry      = indicatorRegistry;
    this._chartId       = chartId;
    this._onTables      = onTables;
    this._pineRuntime   = null;
    this._engine        = null;
    this._chart         = null;
    this._mainSeries    = null;   // reference to chart's main series for marker attachment

    /** @type {Record<string, object[]>} indicatorId → LWC series array */
    this._pineSeries    = {};

    /** @type {Record<string, object[]>} indicatorId → price line objects */
    this._pinePriceLines = {};

    /**
     * @type {Record<string, object|null>} indicatorId → createSeriesMarkers primitive
     * One primitive per indicator, holds all markers for that indicator batched.
     */
    this._pineMarkerPrimitives = {};

    /** @type {Record<string, object[]>} indicatorId → PineFillRenderer/PineHlineFillRenderer instances */
    this._pineFillPrimitives = {};

    /** @type {Record<string, PineObjectPool>} indicatorId → object pool */
    this._pineObjectPools = {};

    /**
     * @type {Record<string, {pane: object, paneIndex: number}|null>}
     * indicatorId → dedicated LWC pane for overlay=false indicators.
     * null means the indicator uses the main (pane 0) price scale.
     */
    this._pinePanes = {};
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  setChart(chart) {
    this._chart = chart;
    if (this._engine) {
      this._engine.setChart(chart);
    }
  }

  /** Set the main chart series reference (needed for marker primitive attachment). */
  setMainSeries(series) {
    this._mainSeries = series;
  }

  async run(data, symbol, interval) {
    const chart = this._chart;
    if (!chart || !data?.length) return;

    // ── PineTSRuntime lifecycle ──────────────────────────────────────────
    const symbolInfo = (symbol || interval) ? { symbol, interval } : undefined;
    if (!this._pineRuntime) {
      this._pineRuntime = new PineTSRuntime(data, symbolInfo);
    } else {
      this._pineRuntime.updateCandles(data, symbolInfo);
    }

    // ── IndicatorEngine sync ─────────────────────────────────────────────
    // Pine indicators are applied per-chart (UserIndicator.appliedChartIds),
    // not globally — a chart only runs the indicators explicitly assigned to
    // its own chartId, so different charts can show different indicators.
    const enabledInds = this._chartId == null
      ? []
      : useIndicatorStore.getState().indicators.filter(
          i => (i.appliedChartIds ?? []).includes(this._chartId)
        );

    if (!this._engine) {
      this._engine = new IndicatorEngine(
        this._registry,
        this._pineRuntime,
        chart,
        {
          pineDebounceMs: 100,
          onPineResult: (id, result) => {
            // Tick-time incremental results: apply series data updates only
            // (no series creation/destruction — that only happens in full run())
            this._applyTickResult(id, result);
          },
        },
      );
    } else {
      this._engine._pineRuntime = this._pineRuntime;
      this._engine._chart       = chart;
    }

    this._engine._data = Array.isArray(data) ? data : [];
    this._engine.updatePine(enabledInds);

    // ── Remove resources for disabled indicators ─────────────────────────
    const currentIds = new Set(enabledInds.map(i => i.id));

    for (const [id, _seriesList] of Object.entries(this._pineSeries)) {
      if (!currentIds.has(id)) {
        // Remove series/primitives first so the pane is empty before removal
        this._removeSeriesForId(id);
        this._removePriceLinesForId(id);
        this._removeMarkersForId(id);
        this._removeFillsForId(id);
        this._removePoolForId(id);
        this._removePaneForId(id);
      }
    }

    // ── Full re-run of all enabled indicators ────────────────────────────
    for (const ind of enabledInds) {
      const result = await this._pineRuntime.run(ind.source, ind.params);
      if (!this._chart) return; // chart destroyed mid-run
      if (result.error) {
        console.warn(`[IndicatorRenderer] ${ind.title}:`, result.error);
        continue;
      }

      if (result.title && result.title !== ind.title) {
        useIndicatorStore.getState().upsert({ ...ind, title: result.title });
      }

      await this._applyFullResult(ind.id, result, data);
    }
  }

  updateIncremental(candle) {
    if (this._engine) {
      this._engine.updateIncremental(candle);
    }
  }

  runWithData(data, symbol, interval) {
    if (this._engine) {
      this._engine.runPineWithData(data);
    }
    return this.run(data, symbol, interval);
  }

  destroy() {
    const allIds = new Set([
      ...Object.keys(this._pineSeries),
      ...Object.keys(this._pinePriceLines),
      ...Object.keys(this._pineMarkerPrimitives),
      ...Object.keys(this._pineFillPrimitives),
      ...Object.keys(this._pineObjectPools),
      ...Object.keys(this._pinePanes),
    ]);
    // Step 1: Remove all series, primitives, and pools first.
    // Panes must be removed AFTER their series are gone to avoid LWC assertions.
    for (const id of allIds) {
      this._removeSeriesForId(id);
      this._removePriceLinesForId(id);
      this._removeMarkersForId(id);
      this._removeFillsForId(id);
      this._removePoolForId(id);
    }
    // Step 2: Remove panes (now empty)
    for (const id of allIds) {
      this._removePaneForId(id);
    }
    this._pineSeries           = {};
    this._pinePriceLines       = {};
    this._pineMarkerPrimitives = {};
    this._pineFillPrimitives   = {};
    this._pineObjectPools      = {};
    this._pinePanes            = {};
    this._lastTableLengths     = {};
    this._engine      = null;
    this._pineRuntime = null;
    this._chart       = null;
    this._mainSeries  = null;
  }

  // ─── Private: apply a full run result ────────────────────────────────────

  async _applyFullResult(indicatorId, result, _data) {
    const chart = this._chart;
    if (!chart) return;

    // Tear down everything for this indicator before rebuilding
    this._removeSeriesForId(indicatorId);
    this._removePriceLinesForId(indicatorId);
    this._removeMarkersForId(indicatorId);
    this._removeFillsForId(indicatorId);
    // Destroy the pool so its primitives detach from the old series before we
    // create a new one. The pool is recreated below with the fresh series ref.
    this._removePoolForId(indicatorId);

    const newSeries = [];

    // ── Pane management for overlay=false indicators ─────────────────────
    // overlay=true  → pane 0 (main chart), addSeries with paneIndex=0
    // overlay=false → dedicated sub-pane via chart.addPane()
    //
    // LWC 5 API:
    //   chart.addPane()          → PaneApi (has .paneIndex(), .addSeries())
    //   pane.addSeries(def,opts) → delegates to chart.addSeries(def,opts,pane.paneIndex())
    //   chart.removePane(index)  → removes pane by integer index
    //
    // We store the PaneApi object and use pane.paneIndex() at call time so the
    // index is always current (it shifts when other panes are removed).

    let targetPane = null; // null → use chart.addSeries with paneIndex=0

    if (result.overlay === false) {
      const existing = this._pinePanes[indicatorId];
      if (existing?.pane) {
        // Reuse the pane from a previous run of this indicator
        targetPane = existing.pane;
      } else {
        try {
          targetPane = chart.addPane();
          // setPreserveEmptyPane(true) prevents LWC from auto-removing the pane
          // when series are temporarily absent during teardown/rebuild
          targetPane.setPreserveEmptyPane?.(true);
          this._pinePanes[indicatorId] = { pane: targetPane };
        } catch (e) {
          console.warn('[IndicatorRenderer] addPane failed, falling back to main pane:', e);
          this._pinePanes[indicatorId] = null;
        }
      }
    } else {
      // overlay=true: use main pane, clean up any stale sub-pane from a previous run
      this._removePaneForId(indicatorId);
      this._pinePanes[indicatorId] = null;
    }

    // Helper: add series to the right pane
    const addSeriesTo = (type, opts) => {
      if (targetPane) {
        return targetPane.addSeries(type, opts);
      }
      return chart.addSeries(type, { ...opts, priceScaleId: 'right' }, 0);
    };

    // ── 1. Line series ─────────────────────────────────────────────────────
    for (const s of result.lineSeries ?? []) {
      if (!s.data.length) continue;
      try {
        const lwcSeries = addSeriesTo(LineSeries, {
          lineWidth:        s.lineWidth ?? 1,
          color:            s.color,
          title:            s.name,
          lastValueVisible: true,
          priceLineVisible: false,
        });
        lwcSeries.setData(s.data);
        newSeries.push(lwcSeries);
      } catch (e) {
        console.warn('[IndicatorRenderer] line series error:', e);
      }
    }

    // ── 2. Histogram / columns series ─────────────────────────────────────
    for (const s of result.histograms ?? []) {
      if (!s.data.length) continue;
      try {
        const lwcSeries = addSeriesTo(HistogramSeries, {
          color:            s.color,
          title:            s.name,
          lastValueVisible: true,
          priceLineVisible: false,
        });
        lwcSeries.setData(s.data);
        newSeries.push(lwcSeries);
      } catch (e) {
        console.warn('[IndicatorRenderer] histogram series error:', e);
      }
    }

    // ── 3. Bar / candle overlays ──────────────────────────────────────────
    for (const overlay of result.barOverlays ?? []) {
      if (!overlay.data.length) continue;
      try {
        const SeriesType = overlay.style === 'candle' ? CandlestickSeries : BarSeries;
        const lwcSeries = addSeriesTo(SeriesType, {
          lastValueVisible: false,
          priceLineVisible: false,
        });
        lwcSeries.setData(overlay.data.map(d => ({
          time:      d.time,
          open:      d.open,
          high:      d.high,
          low:       d.low,
          close:     d.close,
          color:     d.color,
          wickColor: d.wickColor,
        })));
        newSeries.push(lwcSeries);
      } catch (e) {
        console.warn('[IndicatorRenderer] bar overlay error:', e);
      }
    }

    this._pineSeries[indicatorId] = newSeries;

    // ── 4. hlines → price lines on the first line series (or standalone) ──
    const priceLinesHost = newSeries[0] ?? null;
    const newPriceLines  = [];
    if (priceLinesHost) {
      for (const h of result.hlines ?? []) {
        try {
          const pl = priceLinesHost.createPriceLine({
            price:       h.value,
            color:       h.color,
            lineWidth:   h.lineWidth,
            lineStyle:   this._lwcLineStyle(h.lineStyle),
            axisLabelVisible: true,
            title:       h.title,
          });
          newPriceLines.push({ line: pl, host: priceLinesHost });
        } catch (e) {
          console.warn('[IndicatorRenderer] price line error:', e);
        }
      }
    }
    this._pinePriceLines[indicatorId] = newPriceLines;

    // ── 5. Markers (plotshape / plotchar / plotarrow) ─────────────────────
    if ((result.markers ?? []).length > 0 && this._mainSeries) {
      try {
        const lwcMarkers = result.markers
          .filter(m => m.time != null)
          .sort((a, b) => a.time - b.time)
          .map(m => ({
            time:     m.time,
            position: locationToPosition(m.location),
            color:    m.color,
            shape:    pineShapeToLWC(m.shape, m.char),
            text:     m.char ?? m.text ?? '',
            size:     SIZE_MAP[m.size] ?? 14,
          }));
        const primitive = createSeriesMarkers(this._mainSeries, lwcMarkers);
        this._pineMarkerPrimitives[indicatorId] = primitive;
      } catch (e) {
        console.warn('[IndicatorRenderer] markers error:', e);
      }
    }

    // ── 6. Tables — emit via callback for React overlay (Step 5) ──────────
    if (this._onTables && (result.tables ?? []).length > 0) {
      this._onTables(indicatorId, result.tables);
    } else if (this._onTables && (result.tables ?? []).length === 0) {
      // Clear any previously rendered tables for this indicator
      this._onTables(indicatorId, []);
    }

    // ── 7. Fills (fill() between two plots or two hlines) ─────────────────
    const fillHostSeries = newSeries[0] ?? this._mainSeries;
    const newFillPrims   = [];

    if (fillHostSeries) {
      // Build a lookup: plot title/key → data array, for resolving fill() refs
      const plotDataByTitle = {};
      for (const s of [...(result.lineSeries ?? []), ...(result.histograms ?? [])]) {
        plotDataByTitle[s.name] = s.data;
      }
      // Also add hlines by title for hline-to-hline fills
      const hlineByTitle = {};
      for (const h of (result.hlines ?? [])) {
        hlineByTitle[h.title] = h.value;
      }

      for (const f of (result.fills ?? [])) {
        try {
          const d1 = plotDataByTitle[f.plot1];
          const d2 = plotDataByTitle[f.plot2];
          const v1 = hlineByTitle[f.plot1];
          const v2 = hlineByTitle[f.plot2];

          if (d1 && d2) {
            // plot-to-plot fill
            const prim = new PineFillRenderer({
              series1Data: d1,
              series2Data: d2,
              color:       f.color,
              chart:       chart,
              series:      fillHostSeries,
              candles:     _data,
            });
            fillHostSeries.attachPrimitive(prim);
            newFillPrims.push({ prim, host: fillHostSeries });
          } else if (v1 != null && v2 != null) {
            // hline-to-hline fill
            const prim = new PineHlineFillRenderer({
              value1: v1, value2: v2,
              color:  f.color,
              chart:  chart,
              series: fillHostSeries,
            });
            fillHostSeries.attachPrimitive(prim);
            newFillPrims.push({ prim, host: fillHostSeries });
          }
        } catch (e) {
          console.warn('[IndicatorRenderer] fill error:', e);
        }
      }

      // Linefills (linefill.new()) grouped by color — one primitive for all entries
      if ((result.linefills ?? []).length > 0) {
        // Group by color to batch similar fills
        const byColor = {};
        for (const lf of result.linefills) {
          const c = lf.color ?? 'rgba(128,128,128,0.2)';
          (byColor[c] = byColor[c] ?? []).push(lf);
        }
        for (const [color, entries] of Object.entries(byColor)) {
          try {
            const prim = new PineLinefillRenderer({
              entries, color,
              chart:   chart,
              series:  fillHostSeries,
              candles: _data,
            });
            fillHostSeries.attachPrimitive(prim);
            newFillPrims.push({ prim, host: fillHostSeries });
          } catch (e) {
            console.warn('[IndicatorRenderer] linefill error:', e);
          }
        }
      }
    }
    this._pineFillPrimitives[indicatorId] = newFillPrims;

    // ── 8. Object pool: lines, boxes, labels, polylines ───────────────────
    if (!this._pineObjectPools[indicatorId]) {
      this._pineObjectPools[indicatorId] = new PineObjectPool({
        chart:   chart,
        series:  this._mainSeries ?? (newSeries[0] ?? null),
        candles: _data,
      });
    } else {
      this._pineObjectPools[indicatorId].updateContext({
        chart:   chart,
        series:  this._mainSeries ?? (newSeries[0] ?? null),
        candles: _data,
      });
    }
    this._pineObjectPools[indicatorId].sync({
      lines:     result.lines     ?? [],
      boxes:     result.boxes     ?? [],
      labels:    result.labels    ?? [],
      polylines: result.polylines ?? [],
    });
  }

  // ─── Private: apply tick-time incremental result ─────────────────────────

  _applyTickResult(indicatorId, result) {
    const seriesList = this._pineSeries[indicatorId];
    if (!seriesList?.length) return;

    // Match by order: lineSeries first, then histograms, then bar overlays.
    // On a tick we only update data, never recreate series.
    const allOutputSeries = [
      ...(result.lineSeries ?? []),
      ...(result.histograms ?? []),
    ];

    allOutputSeries.forEach((out, i) => {
      const lwcSeries = seriesList[i];
      if (!lwcSeries || !out?.data?.length) return;
      try {
        // For tick updates, just update the last bar rather than full setData
        const last = out.data[out.data.length - 1];
        if (last) lwcSeries.update(last);
      } catch { /* chart may be in teardown */ }
    });

    // Update markers on tick — replace full marker set (pinets returns full snapshot)
    if ((result.markers ?? []).length > 0 && this._mainSeries) {
      const existing = this._pineMarkerPrimitives[indicatorId];
      if (existing) {
        try {
          const lwcMarkers = result.markers
            .filter(m => m.time != null)
            .sort((a, b) => a.time - b.time)
            .map(m => ({
              time:     m.time,
              position: locationToPosition(m.location),
              color:    m.color,
              shape:    pineShapeToLWC(m.shape, m.char),
              text:     m.char ?? m.text ?? '',
              size:     SIZE_MAP[m.size] ?? 14,
            }));
          existing.setMarkers(lwcMarkers);
        } catch { /* ignore */ }
      }
    }

    // Sync object pool on tick — line.new()/box.new()/label.new() may move each bar.
    // Pool.sync() is diff-based so this is cheap when objects haven't changed.
    const pool = this._pineObjectPools[indicatorId];
    if (pool) {
      try {
        pool.sync({
          lines:     result.lines     ?? [],
          boxes:     result.boxes     ?? [],
          labels:    result.labels    ?? [],
          polylines: result.polylines ?? [],
        });
      } catch { /* ignore */ }
    }

    // Update tables on tick — table.new() with barstate.islast refreshes every close
    if (this._onTables) {
      const tables = result.tables ?? [];
      // Only emit if tables changed (length comparison avoids thrashing React state)
      const existing = this._lastTableLengths?.[indicatorId] ?? -1;
      if (tables.length !== existing || tables.length > 0) {
        this._onTables(indicatorId, tables);
        if (!this._lastTableLengths) this._lastTableLengths = {};
        this._lastTableLengths[indicatorId] = tables.length;
      }
    }
  }

  // ─── Private: cleanup helpers ─────────────────────────────────────────────

  _removeSeriesForId(id) {
    const seriesList = this._pineSeries[id] ?? [];
    for (const s of seriesList) {
      try { this._chart?.removeSeries(s); } catch { /* ignore */ }
    }
    delete this._pineSeries[id];
  }

  _removePriceLinesForId(id) {
    const priceLines = this._pinePriceLines[id] ?? [];
    for (const { line, host } of priceLines) {
      try { host?.removePriceLine(line); } catch { /* ignore */ }
    }
    delete this._pinePriceLines[id];
  }

  _removeMarkersForId(id) {
    const prim = this._pineMarkerPrimitives[id];
    if (prim) {
      try { prim.setMarkers([]); } catch { /* ignore */ }
    }
    delete this._pineMarkerPrimitives[id];
  }

  _removeFillsForId(id) {
    const fills = this._pineFillPrimitives[id] ?? [];
    for (const { prim, host } of fills) {
      try { host?.detachPrimitive(prim); } catch { /* ignore */ }
    }
    delete this._pineFillPrimitives[id];
  }

  _removePoolForId(id) {
    const pool = this._pineObjectPools[id];
    if (pool) {
      pool.destroy();
      delete this._pineObjectPools[id];
    }
  }

  _removePaneForId(id) {
    const entry = this._pinePanes[id];
    if (entry?.pane) {
      try {
        // Use the live paneIndex() from the PaneApi — safer than a stored integer
        // since other pane removals shift indices.
        const liveIndex = entry.pane.paneIndex?.();
        if (typeof liveIndex === 'number' && liveIndex > 0) {
          this._chart?.removePane(liveIndex);
        }
      } catch { /* chart may already be destroyed or pane already gone */ }
    }
    delete this._pinePanes[id];
  }

  /**
   * After a pane is removed all higher pane indices shift down by 1.
   * We store PaneApi objects (not integers) so pane.paneIndex() always returns
   * the current live index — no re-sync needed. This method is kept as a no-op
   * for callers that previously relied on it.
   */
  _refreshPaneIndices() {
    // No-op: pane.paneIndex() is computed live by LWC, so stored PaneApi objects
    // are always authoritative without manual re-sync.
  }

  // ─── Private: style helpers ───────────────────────────────────────────────

  _lwcLineStyle(pineStyle) {
    // LWC LineStyle enum values: 0=Solid, 1=Dotted, 2=Dashed, 3=LargeDashed, 4=SparseDotted
    switch (pineStyle) {
      case 'dashed':  return 2;
      case 'dotted':  return 1;
      default:        return 0; // solid
    }
  }
}
