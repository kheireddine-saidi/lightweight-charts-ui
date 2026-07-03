/**
 * TradeVisualizationManager — pure projection of ExecutionEngine state onto chart drawings.
 *
 * Responsibilities (audit §B.2):
 *   - Maintain a map of positionId → drawing objects (zones, lines, labels).
 *   - Subscribe to relevant EventBus events and update chart drawings.
 *   - Never handle user drag interactions (those remain in TradeSetupTool.jsx).
 *   - Always reflect engine state; visual is a read-only mirror of the engine.
 *
 * Subscribed events:
 *   ORDER_FILLED      → create trade box / entry marker
 *   POSITION_CLOSED   → remove / dim the trade box
 *   TPSL_REJECTED     → snap SL/TP drawing back to engine's actual values
 *   POSITION_UPDATED  → update SL/TP drawing lines
 *
 * Integration: instantiate once per chart in ChartComponent and call
 *   manager.setChart(chartApi, seriesApi)  after the chart is ready.
 *   manager.destroy()                       on unmount.
 *
 * No React imports. No chart-library imports (uses the API passed in).
 */

import { EventBus, Events } from '../../core/EventBus';
import { executionEngine }   from '../trading/ExecutionEngine';

export class TradeVisualizationManager {
  /**
   * @param {object} [options]
   * @param {Function} [options.onZoneCreate]   callback(positionId, zoneData) — lets ChartComponent add a committed zone
   * @param {Function} [options.onZoneUpdate]   callback(positionId, fields)   — lets ChartComponent update a committed zone
   * @param {Function} [options.onZoneRemove]   callback(positionId)           — lets ChartComponent remove a committed zone
   */
  constructor(options = {}) {
    this._onZoneCreate  = options.onZoneCreate  ?? null;
    this._onZoneUpdate  = options.onZoneUpdate  ?? null;
    this._onZoneRemove  = options.onZoneRemove  ?? null;

    /**
     * positionId → { entryMarkerId, slLineId, tpLineId, status }
     * @type {Map<string, object>}
     */
    this._drawings = new Map();

    // Chart API references — set via setChart()
    this._chart  = null;
    this._series = null;

    // EventBus unsubscribe functions
    this._unsubs = [];

    this._bindEvents();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Set or update the chart and series references.
   * Safe to call multiple times (e.g., on chart type change).
   *
   * @param {object} chart   Lightweight Charts IChartApi instance
   * @param {object} series  Main series instance
   */
  setChart(chart, series) {
    this._chart  = chart;
    this._series = series;
  }

  /**
   * Tear down all subscriptions. Call on component unmount.
   */
  destroy() {
    for (const unsub of this._unsubs) {
      try { unsub(); } catch { /* ignore */ }
    }
    this._unsubs = [];
    this._drawings.clear();
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  _bindEvents() {
    this._unsubs.push(
      EventBus.on(Events.ORDER_FILLED,      (p) => this._onOrderFilled(p)),
      EventBus.on(Events.POSITION_CLOSED,   (p) => this._onPositionClosed(p)),
      EventBus.on(Events.TPSL_REJECTED,     (p) => this._onTpslRejected(p)),
      EventBus.on(Events.POSITION_UPDATED,  (p) => this._onPositionUpdated(p)),
      EventBus.on(Events.ORDER_CANCELLED,   (p) => this._onOrderCancelled(p)),
    );
  }

  /**
   * A pending order was filled — create the trade zone drawing.
   * payload: { order, fillPrice, fillTime }
   */
  _onOrderFilled({ order, fillPrice, fillTime }) {
    if (!order) return;

    const positionId = order.positionId ?? order.id;
    if (!positionId) return;

    // Retrieve full position data from engine for accurate SL/TP
    const position = this._getPosition(positionId);
    const sl = position?.stopLoss  ?? order.stopLoss;
    const tp = position?.takeProfit ?? order.takeProfit;

    const zoneData = {
      positionId,
      entryPrice:  fillPrice ?? order.price,
      stopLoss:    sl,
      takeProfit:  tp,
      side:        order.side,
      fillTime:    fillTime,
      status:      'open',
    };

    this._drawings.set(positionId, { status: 'open' });

    if (this._onZoneCreate) {
      this._onZoneCreate(positionId, zoneData);
    }
  }

  /**
   * A position was closed — remove or mark the drawing.
   * payload: { position, closePrice, closeTime, pnl }
   */
  _onPositionClosed({ position }) {
    if (!position?.id) return;
    const positionId = position.id;

    const drawing = this._drawings.get(positionId);
    if (drawing) {
      drawing.status = 'closed';
    }

    if (this._onZoneRemove) {
      this._onZoneRemove(positionId);
    }

    this._drawings.delete(positionId);
  }

  /**
   * SL/TP update was rejected by the engine — snap the drawing back to the
   * engine's actual values.
   * payload: { positionId, field, rejectedValue, actualValue }
   */
  _onTpslRejected({ positionId, field, actualValue }) {
    if (!positionId) return;

    // Read the engine's current authoritative values for this position
    const position = this._getPosition(positionId);
    if (!position) return;

    const fields = {
      stopLoss:   position.stopLoss,
      takeProfit: position.takeProfit,
    };

    // If we have a specific field/value, honour it (belt-and-suspenders)
    if (field && actualValue !== undefined) {
      fields[field] = actualValue;
    }

    if (this._onZoneUpdate) {
      this._onZoneUpdate(positionId, fields);
    }
  }

  /**
   * SL/TP or other position fields changed.
   * payload: { position } or { positionId, stopLoss, takeProfit }
   */
  _onPositionUpdated(payload) {
    const position   = payload?.position;
    const positionId = position?.id ?? payload?.positionId;
    if (!positionId) return;

    const enginePos = this._getPosition(positionId) ?? position ?? payload;
    if (!enginePos) return;

    const fields = {};
    if (enginePos.stopLoss   !== undefined) fields.stopLoss   = enginePos.stopLoss;
    if (enginePos.takeProfit !== undefined) fields.takeProfit = enginePos.takeProfit;
    if (enginePos.entryPrice !== undefined) fields.entryPrice = enginePos.entryPrice;

    if (Object.keys(fields).length && this._onZoneUpdate) {
      this._onZoneUpdate(positionId, fields);
    }
  }

  /**
   * A pending order was cancelled (no fill) — remove its pending zone.
   * payload: { order }
   */
  _onOrderCancelled({ order }) {
    if (!order) return;
    const positionId = order.positionId ?? order.id;
    if (!positionId) return;

    if (this._drawings.has(positionId)) {
      this._drawings.delete(positionId);
      if (this._onZoneRemove) {
        this._onZoneRemove(positionId);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Look up a position across open positions and closed trades.
   * @param {string} positionId
   * @returns {object|null}
   */
  _getPosition(positionId) {
    try {
      const open = executionEngine.positions?.find(p => p.id === positionId);
      if (open) return open;
      const closed = executionEngine.closedTrades?.find(p => p.id === positionId);
      return closed ?? null;
    } catch {
      return null;
    }
  }
}
