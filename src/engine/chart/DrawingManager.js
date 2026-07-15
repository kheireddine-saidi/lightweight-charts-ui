/**
 * DrawingManager — owns the drawing tool and timer lifecycle for one chart instance.
 *
 * Extracted from ChartComponent in Phase 6.
 *
 * Responsibilities:
 *  - Create and attach LineToolManager to a series (once per series lifetime)
 *  - Install the magnet-aware coordinateToPrice wrapper on the series
 *  - Bridge LineToolManager alert events to React callbacks
 *  - Create and attach PriceScaleTimer
 *  - Expose sync methods called by ChartComponent useEffects:
 *      syncActiveTool(tool)
 *      syncDrawingsLocked(locked)
 *      syncDrawingsHidden(hidden)
 *      syncTimerVisible(visible, series)
 *  - zoomChart(zoomIn) — pure viewport arithmetic
 *  - Expose lineToolManager and priceScaleTimer getters for ChartComponent refs
 *
 * No React imports. No EventBus. No data fetching.
 * All live-value reads use getter functions supplied at construction.
 */

import { LineToolManager, PriceScaleTimer } from '../../plugins/line-tools/line-tools.js';
import { snapToOHLC } from '../../utils/magnetSnap';
import { EventBus, Events } from '../../core/EventBus';
import { useChartSettingsStore } from '../../stores/chartSettingsStore';
import { GlobalDrawingStore } from './GlobalDrawingStore';

// Module-level counter for unique DrawingManager instance IDs
let _managerIdCounter = 0;

/** Tool name → LineToolManager tool string */
const TOOL_MAP = {
  cursor:            'None',
  eraser:            'Eraser',
  trendline:         'TrendLine',
  arrow:             'Arrow',
  ray:               'Ray',
  extended_line:     'ExtendedLine',
  horizontal:        'HorizontalLine',
  horizontal_ray:    'HorizontalRay',
  vertical:          'VerticalLine',
  cross_line:        'CrossLine',
  parallel_channel:  'ParallelChannel',
  fibonacci:         'FibRetracement',
  fib_extension:     'FibExtension',
  pitchfork:         'Pitchfork',
  brush:             'Brush',
  highlighter:       'Highlighter',
  rectangle:         'Rectangle',
  circle:            'Circle',
  path:              'Path',
  text:              'Text',
  callout:           'Callout',
  price_label:       'PriceLabel',
  pattern:           'Pattern',
  triangle:          'Triangle',
  abcd:              'ABCD',
  xabcd:             'XABCD',
  elliott_impulse:   'ElliottImpulseWave',
  elliott_correction:'ElliottCorrectionWave',
  head_and_shoulders:'HeadAndShoulders',
  prediction:        'LongPosition',
  prediction_short:  'ShortPosition',
  date_range:        'DateRange',
  price_range:       'PriceRange',
  date_price_range:  'DatePriceRange',
  measure:           'Measure',
  // Non-LTM tools — handled separately
  trade_setup:       'None',
  zoom_in:           'None',
  zoom_out:          'None',
  remove:            'None',
};

export { TOOL_MAP };

export class DrawingManager {
  /**
   * @param {{
   *   symbol:               string,
   *   getActiveTool:        () => string,
   *   getMagnetMode:        () => boolean,
   *   getMagnetLastLogical: () => number | null,
   *   getFullData:          () => object[],
   *   onToolUsed:           (() => void) | null,
   *   onAlertsSync:         ((alerts: object[]) => void) | null,
   *   onAlertTriggered:     ((evt: object) => void) | null,
   * }} opts
   */
  constructor(opts) {
    this._symbol              = opts.symbol;
    this._getActiveTool       = opts.getActiveTool;
    this._getMagnetMode       = opts.getMagnetMode;
    this._getMagnetLastLogical= opts.getMagnetLastLogical;
    this._getFullData         = opts.getFullData;
    this._onToolUsed          = opts.onToolUsed ?? null;
    this._onAlertsSync        = opts.onAlertsSync ?? null;
    this._onAlertTriggered    = opts.onAlertTriggered ?? null;
    this._onDrawingChanged    = opts.onDrawingChanged ?? null;
    this._managerId           = ++_managerIdCounter;
    this._symbol              = opts.symbol ?? null;
    this._unsubDrawingSync    = null;

    /** @type {object | null} LineToolManager instance */
    this._manager = null;
    /** @type {object | null} PriceScaleTimer instance */
    this._timer   = null;
  }

  // ─── Getters used by ChartComponent refs ────────────────────────────────

  get lineToolManager()  { return this._manager; }
  get priceScaleTimer()  { return this._timer; }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Attach LineToolManager to `series` and install the magnet wrapper.
   * Idempotent — safe to call multiple times; only creates once.
   *
   * @param {object} series  LWC series API
   * @param {object} chart   LWC chart API (for DEV globals only)
   */
  initializeLineTools(series, chart) {
    if (this._manager) return; // already initialised

    const manager = new LineToolManager();

    // ── Magnet-aware coordinateToPrice wrapper ──────────────────────────
    // LTM reads price via series.coordinateToPrice(y) with no X info.
    // We intercept it and snap to the nearest OHLC value when magnet is active.
    if (!series.__originalCoordinateToPrice) {
      series.__originalCoordinateToPrice = series.coordinateToPrice.bind(series);
      series.coordinateToPrice = (y) => {
        const rawPrice = series.__originalCoordinateToPrice(y);
        if (rawPrice == null || !this._getMagnetMode()) return rawPrice;
        const data = this._getFullData();
        const idx  = this._getMagnetLastLogical();
        if (!data?.length || idx == null) return rawPrice;
        return snapToOHLC(rawPrice, idx, data, true);
      };
    }

    // ── logicalToCoordinate wrapper — the core fix for drawing drift ────────
    //
    // The plugin stores all points as { logical: barIndex, price }.
    // Bar indices shift whenever historical data is prepended (scroll-back loads),
    // causing every drawing to drift left.
    //
    // Strategy: intercept logicalToCoordinate so that when the plugin renders
    // logicalToCoordinate(point.logical), we:
    //   1. Look up the timestamp stored on the point (point.time) via a reverse map
    //      logical → time that we maintain from the drawing tools.
    //   2. Convert that timestamp to the CURRENT correct logical index via timeToIndex().
    //   3. Return the coordinate for that current index.
    //
    // The plugin never knows — it always gets the right pixel for the right time.
    //
    // We also wrap coordinateToLogical to stamp .time on points at click time,
    // so the reverse map is always populated with original click timestamps.

    const origLogicalToCoordinate = chart.timeScale().logicalToCoordinate.bind(chart.timeScale());
    const origCoordinateToLogical = chart.timeScale().coordinateToLogical.bind(chart.timeScale());
    const origCoordinateToTime    = chart.timeScale().coordinateToTime.bind(chart.timeScale());
    const origTimeToIndex         = chart.timeScale().timeToIndex?.bind(chart.timeScale());

    // Reverse map: stale logical index → Unix timestamp (populated from tool points)
    // Rebuilt whenever a tool is added, moved, or data changes.
    const logicalToTimeMap = new Map();

    // Stamp a single point's logical→time into the map using the data array.
    // Called only when logical and data ARE in sync (click, drag-end, or initial load).
    // NEVER called after a prepend — doing so would corrupt the map with wrong times.
    // Keys are always rounded to integer so float logicals (e.g. 199.7) map correctly.
    const stampPoint = (point, data) => {
      if (!point || point.logical == null) return;
      const key = Math.round(point.logical);
      if (point.time != null) {
        logicalToTimeMap.set(key, point.time);
        return;
      }
      const t = (key >= 0 && key < data.length) ? data[key]?.time : null;
      if (t != null) { point.time = t; logicalToTimeMap.set(key, t); }
    };

    // Register all current tool points into the map.
    // Safe to call ONLY when data and tool logical indices are in sync.
    const stampAllTools = () => {
      const data = this._getFullData() ?? [];
      const tools = manager._tools ?? [];
      tools.forEach(tool => {
        stampPoint(tool._p1, data); stampPoint(tool._p2, data);
        stampPoint(tool._p3, data); stampPoint(tool._point, data);
        tool._points?.forEach(p => stampPoint(p, data));
        if (tool._logical != null && tool._logicalTime == null) {
          const idx = Math.round(tool._logical);
          const data2 = this._getFullData() ?? [];
          const t = (idx >= 0 && idx < data2.length) ? data2[idx]?.time : null;
          if (t != null) { tool._logicalTime = t; logicalToTimeMap.set(idx, t); }
        }
      });
    };
    this._stampAllTools = stampAllTools;
    // No rebuildLogicalToTimeMap exposed — callers must NOT rebuild on prepend.

    // Wrap logicalToCoordinate: remap stale logical → current logical via timestamp
    chart.timeScale().logicalToCoordinate = (logical) => {
      if (logical == null) return null;
      const key = Math.round(logical);
      const storedTime = logicalToTimeMap.get(key);
      if (storedTime != null && origTimeToIndex) {
        try {
          const currentLogical = origTimeToIndex(storedTime, true);
          if (currentLogical != null) return origLogicalToCoordinate(currentLogical);
        } catch { /* fall through */ }
      }
      return origLogicalToCoordinate(logical);
    };

    // Wrap coordinateToLogical: stamp .time on points at the moment of placement
    chart.timeScale().coordinateToLogical = (x) => {
      const logical = origCoordinateToLogical(x);
      if (logical !== null) {
        const time = origCoordinateToTime(x);
        if (time != null) logicalToTimeMap.set(Math.round(logical), time);
      }
      return logical;
    };

    // Patch _endDrag to rebuild the map after every drag (logical values change)
    const origEndDrag = manager._endDrag?.bind(manager);
    if (origEndDrag) {
      manager._endDrag = () => {
        origEndDrag();
        stampAllTools();
        // Save updated coordinates to GlobalDrawingStore after drag
        const dragged = manager._dragState?.tool ?? manager._selectedTool;
        if (dragged) saveTool(dragged);
        this._onDrawingChanged?.();
      };
    }

    // ── startTool wrapper — fires onToolUsed when tool is cancelled ─────
    const originalStartTool = manager.startTool.bind(manager);
    manager.startTool = (tool) => {
      originalStartTool(tool);
      const activeTool = this._getActiveTool();
      const isZoom = activeTool === 'zoom_in' || activeTool === 'zoom_out';
      if (
        (tool === 'None' || tool === null) &&
        activeTool !== null &&
        activeTool !== 'cursor' &&
        !isZoom
      ) {
        this._onToolUsed?.();
      }
    };

    series.attachPrimitive(manager);
    this._manager = manager;

    // ── Drawing sync via GlobalDrawingStore ─────────────────────────────────
    //
    // Architecture: drawings are global objects stored in GlobalDrawingStore keyed
    // by symbol. Each chart renders its own lightweight clone of every drawing in
    // the store for its symbol. When a drawing is added/updated/deleted the store
    // is updated and all subscriber charts re-apply the full store state.
    //
    // A "mirror" is a per-chart primitive cloned from the source tool. Mirrors are
    // lightweight — they share the source prototype for rendering logic but have
    // their own _chart, _series, and {logical,price} coordinate objects.

    const symbol = this._symbol;
    const managerId = this._managerId;

    /** Convert { time, price } → { logical, price, time } for THIS chart */
    const makeLocalPoint = (p) => {
      if (!p?.time) return null;
      const ts = chart.timeScale();
      let logical = null;
      try { logical = ts.timeToIndex(p.time, true) ?? null; } catch { /**/ }
      if (logical == null) return null;
      const pt = { logical, price: p.price, time: p.time };
      logicalToTimeMap.set(Math.round(logical), p.time);
      return pt;
    };

    /** Extract { time, price } points from a live tool */
    const extractPoints = (tool) => {
      const pt = (p) => (p?.time != null) ? { time: p.time, price: p.price } : null;
      const rawPoints = [
        pt(tool._p1), pt(tool._p2), pt(tool._p3), pt(tool._point),
        ...(tool._points?.map(pt) ?? []),
      ].filter(Boolean);
      // Deduplicate by time (e.g. _p1 and _point are often the same)
      const seen = new Set();
      return rawPoints.filter(p => {
        const k = `${p.time}:${p.price}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };

    /** Create a mirror primitive for a global drawing def on THIS chart */
    const createMirror = (def) => {
      if (!def.toolRef) return null;
      try {
        // Create a new object of the same (private) class using prototype inheritance.
        // This gives us the rendering methods without needing the private constructor.
        const mirror = Object.create(Object.getPrototypeOf(def.toolRef));

        // Copy only the safe, chart-independent properties from the source.
        // We deliberately exclude _views, _paneViews, _options (renderer state) and
        // will set them fresh below.
        const skip = new Set(['_chart','_series','_isSelected','_isDragging',
                              '_dragState','_views','_paneViews']);
        Object.keys(def.toolRef).forEach(k => {
          if (!skip.has(k)) mirror[k] = def.toolRef[k];
        });

        // Assign THIS chart's instances
        mirror._chart  = chart;
        mirror._series = series;
        mirror._isSelected = false;
        mirror._isDragging = false;

        // Recalculate local {logical,price} coordinates from global {time,price}
        const pts = def.points.map(makeLocalPoint);
        if (pts.some(p => p == null)) return null; // not all times in this chart's data

        if (mirror._p1 != null)     mirror._p1    = pts[0] ?? mirror._p1;
        if (mirror._p2 != null)     mirror._p2    = pts[1] ?? mirror._p2;
        if (mirror._p3 != null)     mirror._p3    = pts[2] ?? mirror._p3;
        if (mirror._point != null)  mirror._point = pts[0] ?? mirror._point;
        if (mirror._points != null) mirror._points = pts;

        mirror._syncId  = def.syncId;
        mirror.toolType = def.toolType;

        // Re-initialise renderer views so they bind to this chart (not the source)
        if (typeof mirror._initViews === 'function') {
          try { mirror._initViews(); } catch { /**/ }
        }

        return mirror;
      } catch (err) {
        console.warn('[DrawingManager] createMirror failed:', err);
        return null;
      }
    };


    // Number of clicks required to complete each tool type
    const TOOL_CLICK_COUNT = {
      TrendLine: 2, Arrow: 2, Ray: 2, ExtendedLine: 2,
      HorizontalLine: 1, VerticalLine: 1, CrossLine: 1, HorizontalRay: 1,
      FibRetracement: 2, FibExtension: 3, FibChannel: 3, FibSpeedResistanceFan: 3,
      FibCircles: 2, FibTimezone: 1, FibWedge: 3,
      ParallelChannel: 3, Pitchfork: 3,
      GannBox: 2, GannSquareFixed: 2, GannFan: 2,
      Rectangle: 2, Triangle: 3, Ellipse: 2, Brush: 2, Highlighter: 2,
      Path: 2,  // Path ends on double-click; we send 2 identical final points
      DatePriceRange: 2,
      XABCD: 5, ABCD: 4,
      ElliottImpulse: 6, ElliottCorrection: 4,
      HeadAndShoulders: 7,
      Measure: 2,
    };

    /**
     * Programmatically place a drawing on this chart by simulating the exact
     * same click events the plugin receives from real user interaction.
     * This creates properly initialized tool objects with correct renderer views.
     */
    const placeDrawingViaClicks = (def) => {
      const { toolType, points, options, syncId } = def;
      const ts = chart.timeScale();
      const clickCount = TOOL_CLICK_COUNT[toolType] ?? 2;

      // We need at least as many points as clicks
      if (points.length === 0) return false;

      // Save and restore the active tool type so we don't disrupt the UI
      const prevToolType = manager._activeToolType;

      try {
        // Start the tool
        manager.startTool(toolType);

        // Simulate each click
        for (let i = 0; i < clickCount; i++) {
          const pt = points[Math.min(i, points.length - 1)];
          const x = ts.timeToCoordinate(pt.time);
          const y = series.priceToCoordinate(pt.price);
          if (x == null || y == null) {
            manager.startTool('None');
            return false;
          }
          manager._clickHandler({ point: { x, y }, time: pt.time });
        }

        // Find the newly created tool (it will be the last one without a _syncId)
        const newTool = (manager._tools ?? []).slice().reverse()
          .find(t => !t._syncId || t._syncId === syncId);
        if (newTool) {
          newTool._syncId = syncId;
          // Apply options
          if (options && typeof newTool.applyOptions === 'function') {
            try { newTool.applyOptions(options); } catch { /**/ }
          }
        }

        return true;
      } catch (err) {
        console.warn('[DrawingManager] placeDrawingViaClicks failed:', err);
        try { manager.startTool('None'); } catch { /**/ }
        return false;
      } finally {
        // Restore the previous active tool type
        if (manager._activeToolType !== 'None' && manager._activeTool === null) {
          // Tool was completed — restore to None (cursor mode)
          if (prevToolType === 'None') manager.startTool('None');
        }
      }
    };

    /** Full re-render: sync all global drawings for this symbol onto this chart */
    const applyGlobalStore = () => {
      const settings = useChartSettingsStore.getState();
      if (!settings.syncDrawingsAcrossSymbol) return;

      const globalDefs = GlobalDrawingStore.getAll(symbol);
      const existingMirrors = (manager._tools ?? []).filter(t => t._syncId);
      const globalIds = new Set(globalDefs.map(d => d.syncId));

      // Remove mirrors whose global def was deleted
      existingMirrors.forEach(mirror => {
        if (!globalIds.has(mirror._syncId)) {
          try { manager.deleteTool(mirror, true); } catch { /**/ }
        }
      });

      // Add / update for each global def not owned by this manager
      globalDefs.forEach(def => {
        if (def.sourceManagerId === managerId) return; // own drawing

        const existing = (manager._tools ?? []).find(t => t._syncId === def.syncId);
        if (existing) {
          // Update coordinates by moving each point to the new logical position
          const pts = def.points.map(makeLocalPoint).filter(Boolean);
          if (pts.length > 0) {
            const allPoints = [existing._p1, existing._p2, existing._p3].filter(Boolean);
            pts.forEach((pt, i) => {
              if (allPoints[i]) Object.assign(allPoints[i], pt);
            });
            if (existing._point) Object.assign(existing._point, pts[0]);
            if (existing._points) existing._points = pts;
          }
          if (def.options) try { Object.assign(existing._options ?? {}, def.options); } catch { /**/ }
          existing.updateAllViews?.();
        } else {
          // Place via programmatic clicks — creates a proper tool with correct views
          placeDrawingViaClicks(def);
        }
      });

      manager.requestUpdate?.();
    };

    // Subscribe to GlobalDrawingStore changes
    this._unsubDrawingSync?.();
    this._unsubDrawingSync = GlobalDrawingStore.subscribe(applyGlobalStore);

    // Wrap _addTool: stamp new tool's points into the map right after creation.
    const origAddTool = manager._addTool.bind(manager);
    manager._addTool = (tool, type, skipHistory) => {
      origAddTool(tool, type, skipHistory);
      const data = this._getFullData() ?? [];
      stampPoint(tool._p1, data); stampPoint(tool._p2, data);
      stampPoint(tool._p3, data); stampPoint(tool._point, data);
      tool._points?.forEach(p => stampPoint(p, data));
      this._onDrawingChanged?.();
    };

    /** Save a tool to GlobalDrawingStore (called on create and update) */
    const saveTool = (tool) => {
      // Don't save tools that were placed by another manager via sync —
      // they already exist in the store and re-saving would trigger another
      // apply → place → save loop.
      if (tool._syncId && !tool._syncId.startsWith(`${managerId}-`)) return;

      if (!tool._syncId) {
        tool._syncId = `${managerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      const data2 = this._getFullData() ?? [];
      stampPoint(tool._p1, data2); stampPoint(tool._p2, data2);
      stampPoint(tool._p3, data2); stampPoint(tool._point, data2);
      tool._points?.forEach(p => stampPoint(p, data2));

      const points = extractPoints(tool);
      if (points.length === 0) return;

      let options = null;
      try { options = tool._options ? JSON.parse(JSON.stringify(tool._options)) : null; } catch { /**/ }

      GlobalDrawingStore.set(symbol, {
        syncId:          tool._syncId,
        toolType:        tool.toolType,
        points,
        options,
        toolRef:         tool,
        sourceManagerId: managerId,
      });
    };

    // Wrap _selectTool — fires when a drawing is fully completed (all points placed).
    // This is the correct place to save because _addTool fires on intermediate clicks.
    const origSelectTool = manager._selectTool?.bind(manager);
    if (origSelectTool) {
      manager._selectTool = (tool) => {
        origSelectTool(tool);
        // _activeTool === null means the drawing just completed (not mid-placement)
        if (tool && manager._activeTool === null) {
          saveTool(tool);
        }
      };
    }

    // Wrap deleteTool to remove from GlobalDrawingStore
    const origDeleteTool = manager.deleteTool?.bind(manager);
    if (origDeleteTool) {
      manager.deleteTool = (tool, skipHistory) => {
        origDeleteTool(tool, skipHistory);
        if (tool._syncId) {
          GlobalDrawingStore.delete(symbol, tool._syncId);
        }
      };
    }

    // ── Alert bridge ────────────────────────────────────────────────────
    this._bridgeAlerts(manager);

    if (import.meta.env.DEV) {
      window.lineToolManager  = manager;
      window.chartInstance    = chart;
      window.seriesInstance   = series;
    }
  }

  /**
   * Create and attach a PriceScaleTimer to `series`.
   * Idempotent — safe to call multiple times; only creates once.
   * If already created, updates the timeframeSeconds.
   *
   * @param {object} series           LWC series API
   * @param {number} intervalSeconds  candle interval in seconds
   * @param {boolean} visible         initial visibility
   */
  initializePriceScaleTimer(series, intervalSeconds, visible = false) {
    if (!this._timer) {
      const timer = new PriceScaleTimer({
        timeframeSeconds: intervalSeconds,
        visible,
        textColor:   '#FFFFFF',
        yOffset:     19,
        textPadding: 0.95,
      });
      series.attachPrimitive(timer);
      this._timer = timer;
    } else {
      this._timer.applyOptions({ timeframeSeconds: intervalSeconds });
    }
  }

  /**
   * Sync the active drawing tool into LineToolManager.
   * Handles special action tools (lock_all, hide_drawings, clear_all, etc.)
   * and delegates standard tools through TOOL_MAP.
   *
   * @param {string}      activeTool
   * @param {() => void}  onToolUsed  callback to reset tool to cursor
   */
  syncActiveTool(activeTool, onToolUsed) {
    const manager = this._manager;
    if (!manager) return;
    // When activeTool is null/falsy (deactivated), reset the plugin to 'None'
    if (!activeTool) {
      if (typeof manager.startTool === 'function') manager.startTool('None');
      return;
    }

    // ── Special action tools ─────────────────────────────────────────────
    if (activeTool === 'trade_setup') {
      if (typeof manager.startTool === 'function') manager.startTool('None');
      return;
    }
    if (activeTool === 'lock_all' || activeTool === 'hide_drawings' || activeTool === 'show_timer') {
      onToolUsed?.();
      return;
    }
    if (activeTool === 'clear_all') {
      if (typeof manager.clearTools === 'function') manager.clearTools();
      onToolUsed?.();
      return;
    }

    // ── Standard drawing tools ───────────────────────────────────────────
    const mapped = TOOL_MAP[activeTool] ?? 'None';
    if (typeof manager.startTool === 'function') {
      manager.startTool(mapped);
    }
  }

  /**
   * Sync the drawings-locked state into LineToolManager.
   * @param {boolean} locked
   */
  syncDrawingsLocked(locked) {
    const manager = this._manager;
    if (!manager) return;
    const current = typeof manager.areDrawingsLocked === 'function'
      ? manager.areDrawingsLocked()
      : false;
    if (locked === current) return;
    if (locked) {
      manager.lockAllDrawings?.();
    } else {
      manager.unlockAllDrawings?.();
    }
  }

  /**
   * Sync the drawings-hidden state into LineToolManager.
   * @param {boolean} hidden
   */
  syncDrawingsHidden(hidden) {
    const manager = this._manager;
    if (!manager) return;
    const current = typeof manager.areDrawingsHidden === 'function'
      ? manager.areDrawingsHidden()
      : false;
    if (hidden === current) return;
    if (hidden) {
      manager.hideAllDrawings?.();
    } else {
      manager.showAllDrawings?.();
    }
  }

  /**
   * Sync timer visibility and the native last-value label.
   * @param {boolean} visible
   * @param {object|null} series  LWC series (for lastValueVisible toggle)
   */
  syncTimerVisible(visible, series) {
    if (!this._timer) return;
    if (typeof this._timer.setVisible === 'function') {
      this._timer.setVisible(visible);
    }
    // Native price label is mutually exclusive with our custom timer
    series?.applyOptions?.({ lastValueVisible: !visible });
  }

  /**
   * Zoom the chart viewport in or out by a fixed factor.
   * Pure arithmetic — no drawing-tool state involved.
   *
   * @param {object}  chart   LWC chart API
   * @param {boolean} zoomIn  true = zoom in (shrink range), false = zoom out
   */
  zoomChart(chart, zoomIn = true) {
    if (!chart) return;
    try {
      const timeScale   = chart.timeScale();
      const visible     = timeScale.getVisibleLogicalRange();
      if (!visible) return;
      const { from, to } = visible;
      const factor      = zoomIn ? 0.8 : 1.25;
      const center      = (from + to) / 2;
      const half        = ((to - from) * factor) / 2;
      timeScale.setVisibleLogicalRange({ from: center - half, to: center + half });
    } catch (err) {
      console.warn('[DrawingManager] zoomChart failed:', err);
    }
  }

  // ─── Cross-timeframe drawing persistence ────────────────────────────────

  /**
   * Extract the current state of all drawings, converting bar indices (logical)
   * to Unix timestamps so coordinates survive a timeframe or symbol change.
   *
   * @param {Array<{time: number}>} data  the current chart dataset (used for logical→time)
   * @returns {Array<object>} serialisable drawing state
   */
  extractDrawingState(data) {
    if (!this._manager) return [];
    const tools = this._manager._tools ?? [];
    const chart = this._manager.chart;

    // Sync .time on all tools one final time before extracting —
    // this covers any drag that happened after the last _endDrag sync.
    this._syncToolTimes(tools, chart);

    // Fallback: if .time is still missing (e.g. chart not ready for logicalToCoordinate),
    // derive it from the data array.
    const logicalToTimeFromData = (logical) => {
      if (logical == null || !data || data.length === 0) return null;
      const idx = Math.round(logical);
      if (idx < 0 || idx >= data.length) return null;
      return data[idx]?.time ?? null;
    };

    const getTime = (point, prop = 'time') => {
      return point?.[prop] ?? logicalToTimeFromData(point?.logical) ?? null;
    };

    return tools.map(tool => {
      const state = {};
      if (tool._p1    != null) state._p1    = { time: getTime(tool._p1),    price: tool._p1.price };
      if (tool._p2    != null) state._p2    = { time: getTime(tool._p2),    price: tool._p2.price };
      if (tool._p3    != null) state._p3    = { time: getTime(tool._p3),    price: tool._p3.price };
      if (tool._point != null) state._point = { time: getTime(tool._point), price: tool._point.price };
      if (tool._points != null) state._points = tool._points.map(p => ({ time: getTime(p), price: p.price }));
      if (tool._price   !== undefined) state._price = tool._price;
      if (tool._logical !== undefined) state._logical = { time: tool._logicalTime ?? logicalToTimeFromData(tool._logical) };
      if (tool._options != null) {
        try { state._options = JSON.parse(JSON.stringify(tool._options)); } catch { /* ignore */ }
      }
      return { state, tool };
    });
  }

  /**
   * Restore drawing coordinates after a timeframe change by patching each tool's
   * logical index values in-place using the new dataset for time→logical lookup.
   * The drawings themselves are NOT recreated — only their coordinates are updated.
   *
   * @param {Array<object>} savedState  result of extractDrawingState()
   * @param {Array<{time: number}>} newData  the new dataset after timeframe change
   */
  restoreDrawingState(savedState, newData) {
    if (!savedState || savedState.length === 0 || !newData || newData.length === 0) return;

    // Build a time→index map for fast lookup
    const timeToLogical = new Map();
    newData.forEach((bar, i) => {
      if (bar.time != null) timeToLogical.set(bar.time, i);
    });

    // Binary search for the nearest bar when exact time not found
    const findNearest = (time) => {
      if (time == null) return null;
      const exact = timeToLogical.get(time);
      if (exact !== undefined) return exact;
      // Find nearest bar by time
      let lo = 0, hi = newData.length - 1, best = 0, bestDiff = Infinity;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const diff = Math.abs(newData[mid].time - time);
        if (diff < bestDiff) { bestDiff = diff; best = mid; }
        if (newData[mid].time < time) lo = mid + 1;
        else hi = mid - 1;
      }
      return best;
    };

    const toLogical = (saved) => {
      if (!saved || saved.time == null) return null;
      return findNearest(saved.time);
    };

    savedState.forEach(({ state, tool }) => {
      if (!tool) return;
      try {
        let changed = false;

        // Helper: convert a saved {time, price} to {logical, price, time}
        // .time is preserved on the restored point so the next extract reads it directly.
        const makePoint = (saved) => {
          if (!saved) return null;
          const l = toLogical(saved);
          if (l === null) return null;
          return { logical: l, price: saved.price, time: saved.time };
        };

        if (state._p1 != null)    { const p = makePoint(state._p1);    if (p) { tool._p1    = p; changed = true; } }
        if (state._p2 != null)    { const p = makePoint(state._p2);    if (p) { tool._p2    = p; changed = true; } }
        if (state._p3 != null)    { const p = makePoint(state._p3);    if (p) { tool._p3    = p; changed = true; } }
        if (state._point != null) { const p = makePoint(state._point); if (p) { tool._point = p; changed = true; } }

        if (state._points != null) {
          const pts = state._points.map(makePoint).filter(Boolean);
          if (pts.length > 0) { tool._points = pts; changed = true; }
        }
        if (state._logical != null) {
          const l = toLogical(state._logical);
          if (l !== null) {
            tool._logical     = l;
            tool._logicalTime = state._logical.time; // preserve for next extract
            changed = true;
          }
        }

        if (changed && typeof tool.updateAllViews === 'function') {
          tool.updateAllViews();
        }
      } catch (err) {
        console.warn('[DrawingManager] restoreDrawingState: failed to patch tool:', err);
      }
    });
  }

  /**
   * Sync .time onto every { logical, price } point of the given tools.
   * Called after tool creation and after drag operations.
   * @param {object[]} tools
   * @param {object} chart
   */
  _syncToolTimes(tools, chart) {
    // Use the timeScale's timeToIndex/indexToTime-equivalent via coordinateToTime,
    // but also accept a data array for reliable off-screen bar lookup.
    const ts = chart?.timeScale();
    const data = this._getFullData?.() ?? null;

    const toTime = (logical) => {
      if (logical == null) return null;
      const idx = Math.round(logical);
      // Primary: look up directly in the data array — works for any bar including
      // those scrolled off-screen where logicalToCoordinate returns null.
      if (data && idx >= 0 && idx < data.length && data[idx]?.time != null) {
        return data[idx].time;
      }
      // Fallback: coordinate conversion (only works for visible bars)
      if (!ts) return null;
      try {
        const coord = ts.logicalToCoordinate(idx);
        if (coord == null) return null;
        return ts.coordinateToTime(coord);
      } catch { return null; }
    };

    tools.forEach(tool => {
      try {
        if (tool._p1    != null && tool._p1.logical    != null) tool._p1.time    = toTime(tool._p1.logical);
        if (tool._p2    != null && tool._p2.logical    != null) tool._p2.time    = toTime(tool._p2.logical);
        if (tool._p3    != null && tool._p3.logical    != null) tool._p3.time    = toTime(tool._p3.logical);
        if (tool._point != null && tool._point.logical != null) tool._point.time = toTime(tool._point.logical);
        if (tool._points != null) tool._points.forEach(p => { if (p.logical != null) p.time = toTime(p.logical); });
        if (tool._logical != null) tool._logicalTime = toTime(tool._logical);
      } catch { /* ignore */ }
    });
  }

  /**
   * Clean up subscriptions. Call when the chart unmounts.
   */
  destroy() {
    this._unsubDrawingSync?.();
    this._unsubDrawingSync = null;
  }

  /**
   * Update the symbol used for alert primitives (called on symbol change).
   * @param {string} symbol
   */
  setSymbol(symbol) {
    this._symbol = symbol;
    try {
      const alerts = this._manager?._userPriceAlerts;
      if (alerts && typeof alerts.setSymbolName === 'function') {
        alerts.setSymbolName(symbol);
      }
    } catch { /* ignore */ }
  }

  /**
   * Detach LineToolManager from its series and clear all state.
   * Call from the series-type-change useEffect cleanup.
   *
   * @param {object|null} series  the series the manager is attached to
   */
  detachFromSeries(series) {
    if (!this._manager) return;
    try { this._manager.clearTools(); }    catch (_) { /* ignore */ }
    try { series?.detachPrimitive(this._manager); } catch { /* ignore */ }
    if (import.meta.env.DEV) {
      window.lineToolManager = null;
      window.chartInstance   = null;
      window.seriesInstance  = null;
    }
    this._manager = null;
  }

  /**
   * Full teardown. Call on chart unmount.
   */
  destroy() {
    this._manager = null;
    this._timer   = null;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _bridgeAlerts(manager) {
    try {
      const userAlerts = manager._userPriceAlerts;
      if (!userAlerts) return;

      if (typeof userAlerts.setSymbolName === 'function') {
        userAlerts.setSymbolName(this._symbol);
      }

      // Sync alert list to React state (Alerts tab)
      if (
        typeof userAlerts.alertsChanged === 'function' &&
        typeof userAlerts.alerts       === 'function' &&
        this._onAlertsSync
      ) {
        userAlerts.alertsChanged().subscribe(() => {
          try {
            const raw    = userAlerts.alerts() || [];
            const mapped = raw.map(a => ({
              id:        a.id,
              price:     a.price,
              condition: a.condition || 'crossing',
              type:      a.type      || 'price',
            }));
            this._onAlertsSync(mapped);
          } catch (err) {
            console.warn('[DrawingManager] alert sync error:', err);
          }
        }, manager);
      }

      // Fire alert triggered event
      if (typeof userAlerts.alertTriggered === 'function' && this._onAlertTriggered) {
        userAlerts.alertTriggered().subscribe((evt) => {
          try {
            this._onAlertTriggered({
              externalId: evt.alertId,
              price:      evt.alertPrice,
              timestamp:  evt.timestamp,
              direction:  evt.direction,
              condition:  evt.condition,
            });
          } catch (err) {
            console.warn('[DrawingManager] alertTriggered error:', err);
          }
        }, manager);
      }
    } catch (err) {
      console.warn('[DrawingManager] alert bridge failed:', err);
    }
  }
}
