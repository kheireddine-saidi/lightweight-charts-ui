/**
 * ExecutionEngine — thin coordinator for order/position processing.
 *
 * Delegates to three focused sub-managers:
 *   - OrderManager   : pending orders (limit/stop) lifecycle
 *   - PositionManager: open positions, SL/TP checks, per-position PnL
 *   - Portfolio      : balance, equity, reserved margin
 *
 * Two execution paths:
 *
 * LIVE mode (Binance WebSocket):
 *   - processTick(price) called on EVERY price tick (partial candles included)
 *   - Pending orders checked via FillModel.checkTickFill()
 *   - Open positions SL/TP checked via FillModel.checkSLTPTick()
 *   - No closed-candle guard needed — tick logic is inherently correct
 *
 * REPLAY / BACKTEST mode:
 *   - _onCandle(candle) called on CLOSED candles only
 *   - Uses FillModel.checkCandleFill() and FillModel.checkSLTPCandle()
 *   - Deterministic fill ordering via priceSequence()
 *
 * Public API is unchanged — all existing call sites work without modification.
 *
 * No React imports. No chart imports.
 */

import { EventBus, Events } from '../../core/EventBus';
import { FillModel }         from './FillModel';
import { OrderManager }      from './OrderManager';
import { PositionManager }   from './PositionManager';
import { Portfolio }         from './Portfolio';
import { orderIdGenerator }  from '../../core/OrderIdGenerator';
import { validateTPSL }      from '../../utils/tpslValidation';
import { calculateRiskBasedPositionSize } from '../../utils/positionSizing';
import { executionSettings } from './ExecutionSettings';

export class ExecutionEngine {
  constructor({ initialBalance = 10_000, fillMode = 'conservative' } = {}) {
    this._fillModel = new FillModel(fillMode);

    // Bind the shared TPSL validation callback so sub-managers can use it
    // without holding a reference back to ExecutionEngine.
    const validateTPSLCallback = (current, fields, status, refPrice) =>
      this._validateAndFilterTPSL(current, fields, status, refPrice);

    this.orderManager    = new OrderManager(this._fillModel, validateTPSLCallback);
    this.positionManager = new PositionManager(this._fillModel, validateTPSLCallback);
    this.portfolio       = new Portfolio(initialBalance);

    this._unsubCandle = null;
    this._started     = false;
  }

  // ─── Public property mirrors (read-only — for legacy code that accesses these directly) ──

  /** @returns {Array<object>} */
  get positions() { return this.positionManager.positions; }
  /** @returns {Array<object>} */
  get pendingOrders() { return this.orderManager.orders; }
  /** @returns {Array<object>} */
  get closedTrades() { return this.positionManager.closedTrades; }
  /** @returns {number} */
  get balance() { return this.portfolio.balance; }
  /** @returns {number} */
  get equity() { return this.portfolio.equity; }
  /** @returns {number} */
  get reservedMargin() { return this.portfolio.reservedMargin; }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start() {
    if (this._started) return;
    this._started = true;
    // Listen to closed candles for replay/backtest fills
    this._unsubCandle = EventBus.on(Events.CANDLE, ({ candle, symbol }) => {
      this._onCandle(symbol, candle);
    });
  }

  stop() {
    this._unsubCandle?.();
    this._unsubCandle = null;
    this._started = false;
  }

  // ─── Real-time tick processing (live mode) ────────────────────────────────

  /**
   * Called on every WebSocket price tick (including in-progress candles).
   * @param {string} symbol
   * @param {number} price
   * @param {number} [tickTime]
   */
  processTick(symbol, price, tickTime) {
    this.portfolio.setLastPrice(symbol, price);
    const now = tickTime ?? Math.floor(Date.now() / 1000);

    // 1. Match pending orders — symbol-scoped inside OrderManager
    const filledOrders = this.orderManager.matchTick(symbol, price, now);
    let anyOrderFilled = filledOrders.length > 0;
    for (const filledOrder of filledOrders) {
      const pos = this.positionManager.openPosition(filledOrder);
      EventBus.emit(Events.ORDER_FILLED,    { order: pos, fillPrice: pos.entryPrice, fillTime: now });
      EventBus.emit(Events.POSITION_OPENED, { position: pos });
    }
    if (anyOrderFilled) {
      EventBus.emit(Events.BALANCE_CHANGED, {
        balance: this.portfolio.balance,
        equity:  this.portfolio.equity,
        reservedMargin: this.portfolio.reservedMargin,
      });
    }

    // 2. Check SL/TP on open positions — symbol-scoped inside PositionManager
    const triggered = this.positionManager.checkSLTPTick(symbol, price, now);
    for (const { pos, closePrice, reason } of triggered) {
      this._finaliseClose(pos, closePrice, now, reason);
    }

    this._updateEquity();

    EventBus.emit(Events.EQUITY_TICK, { equity: this.portfolio.equity });
  }

  // ─── Order management ─────────────────────────────────────────────────────

  openPosition(data) {
    const id      = orderIdGenerator.next();
    const isLimit = data.type === 'limit' || data.type === 'stop';

    const pos = {
      symbol:       'BTCUSDT',
      side:         'long',
      type:         'market',
      positionSize: 0.01,
      leverage:     1,
      pnl:          0,
      pnlPercent:   0,
      openedAt:     new Date(),
      ...data,
      id,
      status:    isLimit ? 'pending' : 'open',
      entryTime: data.entryTime ?? Math.floor(Date.now() / 1000),
    };

    if (isLimit) {
      // Check for immediate fill (order at-or-beyond current market price)
      const currentPrice = this.orderManager._prevPriceBySymbol[pos.symbol] ?? null;
      if (currentPrice !== null) {
        const fillPrice = this._fillModel.checkTickFill(currentPrice, null, pos);
        if (fillPrice !== null) {
          const filledOrder = { ...pos, fillPrice, fillTime: pos.entryTime };
          const openedPos   = this.positionManager.openPosition(filledOrder);
          this.portfolio.reserveMargin(openedPos.requiredMargin ?? 0);
          // ORDER_CREATED emitted once here (immediately-filled limit orders
          // skip the bottom-of-function emit via early return).
          EventBus.emit(Events.ORDER_CREATED,   { order: pos });
          EventBus.emit(Events.ORDER_FILLED,    { order: openedPos, fillPrice, fillTime: openedPos.filledTime });
          EventBus.emit(Events.POSITION_OPENED, { position: openedPos });
          EventBus.emit(Events.BALANCE_CHANGED, {
            balance: this.portfolio.balance,
            equity:  this.portfolio.equity,
            reservedMargin: this.portfolio.reservedMargin,
          });
          return openedPos.id;
        }
      }
      this.orderManager.addOrder(pos);
      this.portfolio.reserveMargin(pos.requiredMargin ?? 0);
      EventBus.emit(Events.ORDER_CREATED, { order: pos });
      EventBus.emit(Events.BALANCE_CHANGED, {
        balance: this.portfolio.balance,
        equity:  this.portfolio.equity,
        reservedMargin: this.portfolio.reservedMargin,
      });
    } else {
      // Market order — open immediately
      const filledOrder = { ...pos, fillPrice: pos.entryPrice, fillTime: pos.entryTime };
      const openedPos   = this.positionManager.openPosition(filledOrder);
      this.portfolio.reserveMargin(openedPos.requiredMargin ?? 0);
      EventBus.emit(Events.ORDER_CREATED,   { order: pos });
      EventBus.emit(Events.POSITION_OPENED, { position: openedPos });
      EventBus.emit(Events.BALANCE_CHANGED, {
        balance: this.portfolio.balance,
        equity:  this.portfolio.equity,
        reservedMargin: this.portfolio.reservedMargin,
      });
    }

    return id;
  }

  cancelOrder(id) {
    const removed = this.orderManager.cancelOrder(id);
    if (removed) {
      this.portfolio.releaseMargin(removed.requiredMargin ?? 0);
    }
    EventBus.emit(Events.ORDER_CANCELLED, { id });
    EventBus.emit(Events.BALANCE_CHANGED, {
      balance: this.portfolio.balance,
      equity:  this.portfolio.equity,
      reservedMargin: this.portfolio.reservedMargin,
    });
  }

  /**
   * Update a position or pending order's fields. TP/SL changes are validated
   * before being applied — if invalid, TPSL_REJECTED is emitted. This is the
   * single chokepoint all SL/TP edits route through.
   */
  updatePosition(id, fields) {
    // ── Open positions branch ──
    const openPos = this.positionManager.getPosition(id);
    if (openPos) {
      // Use the portfolio's symbol-scoped last price for TPSL validation.
      const refPrice = this.portfolio.getLastPrice(openPos.symbol, openPos.entryPrice);
      this.positionManager.updatePosition(id, fields, refPrice);
      return;
    }

    // ── Pending order branch: validate then auto-resize if eligible ──
    const order = this.orderManager.getOrder(id);
    if (!order) return;

    const { safeFields } = this.orderManager.updateOrder(id, fields);

    if (safeFields.stopLoss !== undefined && !order.sizeOverridden) {
      const effectiveEntry = order.limitPrice ?? order.entryPrice;
      const sizing = calculateRiskBasedPositionSize({
        balance:       this.portfolio.balance,
        riskPercent:   executionSettings.riskPerTradePercent,
        entryPrice:    effectiveEntry,
        stopLossPrice: safeFields.stopLoss,
        leverage:      order.leverage,
      });
      if (sizing) {
        const marginDelta = sizing.requiredMargin - (order.requiredMargin ?? 0);
        this.portfolio.adjustMargin(marginDelta);
        this.orderManager.patchOrder(id, {
          positionSize:   sizing.positionSize,
          quoteSize:      sizing.quoteSize,
          requiredMargin: sizing.requiredMargin,
        });
        EventBus.emit(Events.BALANCE_CHANGED, {
          balance: this.portfolio.balance,
          equity:  this.portfolio.equity,
          reservedMargin: this.portfolio.reservedMargin,
        });
      }
    }
  }

  closePosition(id, closePrice, closeTime) {
    const pos = this.positionManager.getPosition(id);
    if (!pos) return;
    // Delegate removal to PositionManager so its internal state stays consistent.
    // We pass the closed record back only for the event payload — _finaliseClose
    // handles PnL accounting and EventBus emissions.
    this.positionManager.positions = this.positionManager.positions.filter(p => p.id !== id);
    this._finaliseClose(pos, closePrice ?? pos.entryPrice, closeTime ?? Math.floor(Date.now() / 1000), 'manual');
  }

  // ─── Replay/backtest candle processing ────────────────────────────────────

  _onCandle(symbol, candle) {
    this.portfolio.setLastPrice(symbol, candle.close);
    this.positionManager.resetCandleGuard();

    this._processPendingOrdersCandle(symbol, candle);
    this._checkSLTPCandle(symbol, candle);
    this._updateEquity();

    EventBus.emit(Events.EQUITY_TICK, { equity: this.portfolio.equity });
  }

  _processPendingOrdersCandle(symbol, candle) {
    const filledOrders = this.orderManager.matchCandle(symbol, candle);
    let anyFilled = filledOrders.length > 0;
    for (const filledOrder of filledOrders) {
      const pos = this.positionManager.openPosition(filledOrder);
      this.positionManager.markFilledThisCandle(pos.id);
      EventBus.emit(Events.ORDER_FILLED,    { order: pos, fillPrice: pos.entryPrice, fillTime: candle.time });
      EventBus.emit(Events.POSITION_OPENED, { position: pos });
    }
    if (anyFilled) {
      EventBus.emit(Events.BALANCE_CHANGED, {
        balance: this.portfolio.balance,
        equity:  this.portfolio.equity,
        reservedMargin: this.portfolio.reservedMargin,
      });
    }
  }

  _checkSLTPCandle(symbol, candle) {
    const triggered = this.positionManager.checkSLTPCandle(symbol, candle);
    for (const { pos, closePrice, reason } of triggered) {
      this._finaliseClose(pos, closePrice, candle.time, reason);
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Finalise a position close: release margin, apply PnL, push to closedTrades,
   * and emit events. Accepts already-removed pos objects (from PositionManager).
   */
  _finaliseClose(pos, closePrice, closeTime, reason = 'manual') {
    const pnl = this._calculatePnL(pos, closePrice);
    this.portfolio.releaseMargin(pos.requiredMargin ?? 0);
    this.portfolio.applyRealisedPnL(pnl);

    const closed = {
      ...pos,
      status:      'closed',
      closePrice,
      closeTime,
      closedAt:    new Date(),
      closeReason: reason,
      pnl,
      pnlPercent:  (pnl / (pos.entryPrice * pos.positionSize)) * 100,
    };
    this.positionManager.closedTrades.push(closed);

    EventBus.emit(Events.POSITION_CLOSED,  { position: closed, closePrice, closeTime, pnl, reason });
    EventBus.emit(Events.BALANCE_CHANGED,  {
      balance: this.portfolio.balance,
      equity:  this.portfolio.equity,
      reservedMargin: this.portfolio.reservedMargin,
      change: pnl,
    });
  }

  _updateEquity() {
    this.portfolio.recalcEquity(
      this.positionManager.positions,
      (pos, price) => this._calculatePnL(pos, price),
    );
  }

  _calculatePnL(pos, closePrice) {
    const direction = pos.side === 'long' ? 1 : -1;
    return (closePrice - pos.entryPrice) * direction * pos.positionSize * pos.leverage;
  }

  /**
   * Filters a fields update, dropping stopLoss/takeProfit values that would
   * be invalid (would trigger immediate market execution). Emits TPSL_REJECTED
   * for each rejected field. This is the single TPSL validation chokepoint.
   */
  _validateAndFilterTPSL(current, fields, status, refPrice) {
    if (fields.stopLoss === undefined && fields.takeProfit === undefined) {
      return fields;
    }
    const nextTP = fields.takeProfit !== undefined ? fields.takeProfit : current.takeProfit ?? null;
    const nextSL = fields.stopLoss   !== undefined ? fields.stopLoss   : current.stopLoss   ?? null;
    const result = validateTPSL(current.side, status, refPrice, nextTP, nextSL);

    if (result.valid) return fields;

    const filtered = { ...fields };
    if (result.field === 'tp') delete filtered.takeProfit;
    if (result.field === 'sl') delete filtered.stopLoss;

    EventBus.emit(Events.TPSL_REJECTED, {
      id: current.id, field: result.field, message: result.message,
    });
    return filtered;
  }

  // ─── Snapshot ─────────────────────────────────────────────────────────────

  getSnapshot() {
    return {
      balance:       this.portfolio.balance,
      equity:        this.portfolio.equity,
      positions:     this.positionManager.positions.map(p => ({ ...p })),
      pendingOrders: this.orderManager.orders.map(o => ({ ...o })),
      closedTrades:  this.positionManager.closedTrades.map(p => ({ ...p })),
    };
  }

  restoreSnapshot(snap) {
    this.portfolio.restoreSnapshot({
      balance: snap.balance,
      equity:  snap.equity,
    });
    this.positionManager.restoreSnapshot({
      positions:    snap.positions    ?? [],
      closedTrades: snap.closedTrades ?? [],
    });
    this.orderManager.restoreSnapshot(snap.pendingOrders ?? []);
  }
}

export const executionEngine = new ExecutionEngine();
