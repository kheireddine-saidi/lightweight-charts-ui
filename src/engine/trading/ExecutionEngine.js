/**
 * ExecutionEngine — processes orders and manages positions.
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
 * No React imports. No chart imports.
 */

import { EventBus, Events } from '../../core/EventBus';
import { FillModel } from './FillModel';
import { orderIdGenerator } from '../../core/OrderIdGenerator';
import { validateTPSL } from '../../utils/tpslValidation';

export class ExecutionEngine {
  constructor({ initialBalance = 10_000, fillMode = 'conservative' } = {}) {
    this.balance = initialBalance;
    this.equity  = initialBalance;
    this.reservedMargin = 0;   // margin locked in open positions + pending orders
    this.positions    = [];
    this.pendingOrders = [];
    this.closedTrades = [];
    this._fillModel   = new FillModel(fillMode);
    this._unsubCandle = null;
    this._prevPrice   = null;   // for crossover detection in tick mode
    this._filledThisCandle = new Set();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start() {
    // Listen to closed candles for replay/backtest fills
    this._unsubCandle = EventBus.on(Events.CANDLE, ({ candle }) => {
      this._onCandle(candle);
    });
  }

  stop() {
    this._unsubCandle?.();
    this._unsubCandle = null;
  }

  // ─── Real-time tick processing (live mode) ────────────────────────────────

  /**
   * Called on every WebSocket price tick (including in-progress candles).
   * This is the correct path for live order fills — immediate, not end-of-candle.
   * @param {number} price
   * @param {number} [tickTime]
   */
  processTick(price, tickTime) {
    const now = tickTime ?? Math.floor(Date.now() / 1000);
    const prev = this._prevPrice;

    // 1. Check pending orders (fills happen immediately when price crosses limit)
    const stillPending = [];
    let anyOrderFilled = false;
    for (const order of this.pendingOrders) {
      const fillPrice = this._fillModel.checkTickFill(price, prev, order);
      if (fillPrice !== null) {
        const filled = { ...order, status: 'open', filledTime: now, entryPrice: fillPrice };
        this.positions.push(filled);
        anyOrderFilled = true;
        EventBus.emit(Events.ORDER_FILLED,    { order: filled, fillPrice, fillTime: now });
        EventBus.emit(Events.POSITION_OPENED, { position: filled });
      } else {
        stillPending.push(order);
      }
    }
    this.pendingOrders = stillPending;
    // Notify immediately so the pending-orders list (UI) and margin display
    // refresh the instant a fill happens — not on the next unrelated event.
    if (anyOrderFilled) {
      EventBus.emit(Events.BALANCE_CHANGED, { balance: this.balance, equity: this.equity, reservedMargin: this.reservedMargin });
    }

    // 2. Check SL/TP on open positions (same tick — fill just happened on previous loop)
    const toClose = [];
    const remaining = [];
    for (const pos of this.positions) {
      const result = this._fillModel.checkSLTPTick(price, pos);
      if (result) {
        toClose.push({ pos, closePrice: result.price, reason: result.reason });
      } else {
        remaining.push(pos);
      }
    }
    this.positions = remaining;
    for (const { pos, closePrice, reason } of toClose) {
      this._finaliseClose(pos, closePrice, now, reason);
    }

    this._prevPrice = price;
    this._updateEquity(price);
    // Lightweight per-tick notification — only equity changes (unrealised PnL),
    // not balance/reservedMargin. Kept separate from BALANCE_CHANGED so we don't
    // spam the heavier "things actually changed" semantics on every single tick.
    EventBus.emit(Events.EQUITY_TICK, { equity: this.equity });
  }

  // ─── Order management ─────────────────────────────────────────────────────

  openPosition(data) {
    const id = orderIdGenerator.next();
    const isLimit = data.type === 'limit' || data.type === 'stop';

    const pos = {
      symbol: 'BTCUSDT',
      side: 'long',
      type: 'market',
      positionSize: 0.01,
      leverage: 1,
      pnl: 0,
      pnlPercent: 0,
      openedAt: new Date(),
      ...data,
      id,
      status: isLimit ? 'pending' : 'open',
      entryTime: data.entryTime ?? Math.floor(Date.now() / 1000),
    };

    if (isLimit) {
      // Check immediate fill: if limit is at-or-beyond current market, fill now
      if (this._prevPrice !== null) {
        const fillPrice = this._fillModel.checkTickFill(this._prevPrice, null, pos);
        if (fillPrice !== null) {
          const filled = { ...pos, status: 'open', filledTime: pos.entryTime, entryPrice: fillPrice };
          this.positions.push(filled);
          this.reservedMargin += (filled.requiredMargin ?? 0);
          EventBus.emit(Events.ORDER_CREATED,   { order: filled });
          EventBus.emit(Events.ORDER_FILLED,    { order: filled, fillPrice, fillTime: filled.filledTime });
          EventBus.emit(Events.POSITION_OPENED, { position: filled });
          EventBus.emit(Events.BALANCE_CHANGED, { balance: this.balance, equity: this.equity, reservedMargin: this.reservedMargin });
          return filled.id;
        }
      }
      this.pendingOrders.push(pos);
      this.reservedMargin += (pos.requiredMargin ?? 0);
      EventBus.emit(Events.BALANCE_CHANGED, { balance: this.balance, equity: this.equity, reservedMargin: this.reservedMargin });
    } else {
      this.positions.push(pos);
      this.reservedMargin += (pos.requiredMargin ?? 0);
      EventBus.emit(Events.POSITION_OPENED, { position: pos });
      EventBus.emit(Events.BALANCE_CHANGED, { balance: this.balance, equity: this.equity, reservedMargin: this.reservedMargin });
    }

    EventBus.emit(Events.ORDER_CREATED, { order: pos });
    return id;
  }

  cancelOrder(id) {
    const order = this.pendingOrders.find(o => o.id === id);
    if (order) this.reservedMargin = Math.max(0, this.reservedMargin - (order.requiredMargin ?? 0));
    this.pendingOrders = this.pendingOrders.filter((o) => o.id !== id);
    EventBus.emit(Events.ORDER_CANCELLED, { id });
    EventBus.emit(Events.BALANCE_CHANGED, { balance: this.balance, equity: this.equity, reservedMargin: this.reservedMargin });
  }

  /**
   * Update a position or pending order's fields. TP/SL changes are validated
   * before being applied — if the new value would trigger an immediate
   * market execution (wrong side of current price for open positions, or
   * wrong side of entry price for pending orders), the change is REJECTED
   * (the field is left unchanged) and a TPSL_REJECTED event is emitted so
   * any UI surface (PositionsPanel, TradingPanel, chart drag handles) can
   * show a warning bubble. This is the single chokepoint all SL/TP edits
   * route through, regardless of which UI triggered them.
   */
  updatePosition(id, fields) {
    const idx = this.positions.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const pos = this.positions[idx];
      const safeFields = this._validateAndFilterTPSL(pos, fields, 'open', this._prevPrice ?? pos.entryPrice);
      this.positions[idx] = { ...pos, ...safeFields };
      return;
    }
    const oidx = this.pendingOrders.findIndex((p) => p.id === id);
    if (oidx !== -1) {
      const order = this.pendingOrders[oidx];
      const safeFields = this._validateAndFilterTPSL(order, fields, 'pending', order.entryPrice);
      this.pendingOrders[oidx] = { ...order, ...safeFields };
    }
  }

  /**
   * Filters a fields update, dropping stopLoss/takeProfit values that would
   * be invalid (would trigger an immediate market execution). Emits
   * TPSL_REJECTED for each rejected field so the UI can surface a warning.
   */
  _validateAndFilterTPSL(current, fields, status, refPrice) {
    if (fields.stopLoss === undefined && fields.takeProfit === undefined) {
      return fields; // nothing TP/SL related to validate
    }
    const nextTP = fields.takeProfit !== undefined ? fields.takeProfit : current.takeProfit ?? null;
    const nextSL = fields.stopLoss   !== undefined ? fields.stopLoss   : current.stopLoss   ?? null;
    const result = validateTPSL(current.side, status, refPrice, nextTP, nextSL);

    if (result.valid) return fields;

    // Reject only the offending field — keep the other field's change if it was valid.
    const filtered = { ...fields };
    if (result.field === 'tp') delete filtered.takeProfit;
    if (result.field === 'sl') delete filtered.stopLoss;

    EventBus.emit(Events.TPSL_REJECTED, {
      id: current.id, field: result.field, message: result.message,
    });
    return filtered;
  }

  closePosition(id, closePrice, closeTime) {
    const idx = this.positions.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const pos = this.positions.splice(idx, 1)[0];
    this._finaliseClose(pos, closePrice, closeTime ?? Math.floor(Date.now() / 1000), 'manual');
  }

  // ─── Replay/backtest candle processing ────────────────────────────────────

  _onCandle(candle) {
    this._filledThisCandle = new Set();
    this._processPendingOrdersCandle(candle);
    this._checkSLTPCandle(candle);
    this._updateEquity(candle.close);
    this._prevPrice = candle.close;
    EventBus.emit(Events.EQUITY_TICK, { equity: this.equity });
  }

  _processPendingOrdersCandle(candle) {
    const stillPending = [];
    let anyFilled = false;
    for (const order of this.pendingOrders) {
      const fillPrice = this._fillModel.checkCandleFill(candle, order);
      if (fillPrice !== null) {
        const filled = { ...order, status: 'open', filledTime: candle.time, entryPrice: fillPrice };
        this.positions.push(filled);
        this._filledThisCandle.add(filled.id);
        anyFilled = true;
        EventBus.emit(Events.ORDER_FILLED,    { order: filled, fillPrice, fillTime: candle.time });
        EventBus.emit(Events.POSITION_OPENED, { position: filled });
      } else {
        stillPending.push(order);
      }
    }
    this.pendingOrders = stillPending;
    // Margin was already reserved at order placement time — no change to reservedMargin
    // here, but the UI (pending list, free margin display) needs to refresh.
    if (anyFilled) {
      EventBus.emit(Events.BALANCE_CHANGED, { balance: this.balance, equity: this.equity, reservedMargin: this.reservedMargin });
    }
  }

  _checkSLTPCandle(candle) {
    const toClose  = [];
    const remaining = [];
    for (const pos of this.positions) {
      // Skip newly filled positions — cannot SL/TP in same candle as fill
      if (this._filledThisCandle.has(pos.id)) {
        remaining.push(pos);
        continue;
      }
      const result = this._fillModel.checkSLTPCandle(candle, pos);
      if (result) {
        toClose.push({ pos, closePrice: result.price, reason: result.reason });
      } else {
        remaining.push(pos);
      }
    }
    this.positions = remaining;
    for (const { pos, closePrice, reason } of toClose) {
      this._finaliseClose(pos, closePrice, candle.time, reason);
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  _finaliseClose(pos, closePrice, closeTime, reason = 'manual') {
    const pnl = this._calculatePnL(pos, closePrice);
    // Release margin and credit PnL to balance
    this.reservedMargin = Math.max(0, this.reservedMargin - (pos.requiredMargin ?? 0));
    this.balance += pnl;
    const closed = {
      ...pos,
      status: 'closed',
      closePrice,
      closeTime,
      closedAt:   new Date(),
      closeReason: reason,
      pnl,
      pnlPercent: (pnl / (pos.entryPrice * pos.positionSize)) * 100,
    };
    this.closedTrades.push(closed);
    EventBus.emit(Events.POSITION_CLOSED,  { position: closed, closePrice, closeTime, pnl, reason });
    EventBus.emit(Events.BALANCE_CHANGED,  { balance: this.balance, equity: this.equity, reservedMargin: this.reservedMargin, change: pnl });
  }

  _updateEquity(currentPrice) {
    let unrealised = 0;
    for (const pos of this.positions) {
      unrealised += this._calculatePnL(pos, currentPrice);
    }
    this.equity = this.balance + unrealised;
  }

  _calculatePnL(pos, closePrice) {
    const direction = pos.side === 'long' ? 1 : -1;
    return (closePrice - pos.entryPrice) * direction * pos.positionSize * pos.leverage;
  }

  getSnapshot() {
    return {
      balance: this.balance,
      equity:  this.equity,
      positions:     this.positions.map((p) => ({ ...p })),
      pendingOrders: this.pendingOrders.map((p) => ({ ...p })),
      closedTrades:  this.closedTrades.map((p) => ({ ...p })),
    };
  }

  restoreSnapshot(snap) {
    this.balance       = snap.balance ?? this.balance;
    this.equity        = snap.equity  ?? this.equity;
    this.positions     = snap.positions     ?? [];
    this.pendingOrders = snap.pendingOrders ?? [];
    this.closedTrades  = snap.closedTrades  ?? [];
  }
}

export const executionEngine = new ExecutionEngine();
