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
    if (!manager || !activeTool) return;

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
    } catch (_) { /* ignore */ }
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
    try { series?.detachPrimitive(this._manager); } catch (_) { /* ignore */ }
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
