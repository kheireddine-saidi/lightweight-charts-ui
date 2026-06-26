/**
 * ExecutionEngine — processes orders and manages positions.
 *
 * Receives candles from EventBus (CANDLE event) and:
 *  - fills pending limit / stop orders
 *  - checks stop-loss / take-profit on open positions
 *  - calculates unrealised and realised PnL
 *  - manages account balance
 *  - emits ORDER_FILLED, POSITION_OPENED, POSITION_CLOSED, BALANCE_CHANGED
 *
 * No React imports. No chart imports.
 */

import { EventBus, Events } from '../../core/EventBus';
import { FillModel } from './FillModel';

/**
 * @typedef {'long'|'short'} Side
 * @typedef {'market'|'limit'|'stop'} OrderType
 * @typedef {'pending'|'open'|'closed'} PositionStatus
 *
 * @typedef {{
 *   id: string,
 *   symbol: string,
 *   side: Side,
 *   type: OrderType,
 *   entryPrice: number,
 *   limitPrice?: number,
 *   positionSize: number,
 *   leverage: number,
 *   stopLoss?: number,
 *   takeProfit?: number,
 *   status: PositionStatus,
 *   entryTime: number,
 *   filledTime?: number,
 *   pnl: number,
 *   pnlPercent: number,
 *   openedAt: Date,
 * }} Position
 */

export class ExecutionEngine {
  /**
   * @param {{
   *   initialBalance?: number,
   *   fillMode?: 'conservative'|'optimistic',
   * }} [options]
   */
  constructor({ initialBalance = 10_000, fillMode = 'conservative' } = {}) {
    /** @type {number} */
    this.balance = initialBalance;
    /** @type {number} */
    this.equity = initialBalance;

    /** @type {Position[]} */
    this.positions = [];
    /** @type {Position[]} */
    this.pendingOrders = [];
    /** @type {(Position & { closePrice: number, closeTime: number, closedAt: Date })[]} */
    this.closedTrades = [];

    this._fillModel = new FillModel(fillMode);
    this._unsubCandle = null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Attach to EventBus and start processing candles. */
  start() {
    this._unsubCandle = EventBus.on(Events.CANDLE, ({ candle }) => {
      this._onCandle(candle);
    });
  }

  /** Detach from EventBus. */
  stop() {
    if (this._unsubCandle) {
      this._unsubCandle();
      this._unsubCandle = null;
    }
  }

  // ─── Order Management ─────────────────────────────────────────────────────

  /**
   * Submit a new order.
   * Market orders are filled immediately at entryPrice.
   * Limit/stop orders are queued.
   * @param {Partial<Position>} data
   * @returns {string} generated position id
   */
  openPosition(data) {
    const id = crypto.randomUUID();
    const isLimit = data.type === 'limit' || data.type === 'stop';

    /** @type {Position} */
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
      this.pendingOrders.push(pos);
    } else {
      this.positions.push(pos);
      EventBus.emit(Events.POSITION_OPENED, { position: pos });
    }

    EventBus.emit(Events.ORDER_CREATED, { order: pos });
    return id;
  }

  /**
   * Cancel a pending order.
   * @param {string} id
   */
  cancelOrder(id) {
    this.pendingOrders = this.pendingOrders.filter((o) => o.id !== id);
  }

  /**
   * Update fields on an open position or pending order.
   * @param {string} id
   * @param {Partial<Position>} fields
   */
  updatePosition(id, fields) {
    const idx = this.positions.findIndex((p) => p.id === id);
    if (idx !== -1) {
      this.positions[idx] = { ...this.positions[idx], ...fields };
      return;
    }
    const oidx = this.pendingOrders.findIndex((p) => p.id === id);
    if (oidx !== -1) {
      this.pendingOrders[oidx] = { ...this.pendingOrders[oidx], ...fields };
    }
  }

  /**
   * Manually close a position at a specified price.
   * @param {string} id
   * @param {number} closePrice
   * @param {number} [closeTime]
   */
  closePosition(id, closePrice, closeTime) {
    const idx = this.positions.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const pos = this.positions[idx];
    this.positions.splice(idx, 1);
    this._finaliseClose(pos, closePrice, closeTime ?? Math.floor(Date.now() / 1000));
  }

  // ─── Serialisation (for session snapshots) ────────────────────────────────

  getSnapshot() {
    return {
      balance: this.balance,
      equity: this.equity,
      positions: this.positions.map((p) => ({ ...p })),
      pendingOrders: this.pendingOrders.map((p) => ({ ...p })),
      closedTrades: this.closedTrades.map((p) => ({ ...p })),
    };
  }

  restoreSnapshot(snap) {
    this.balance = snap.balance ?? this.balance;
    this.equity = snap.equity ?? this.equity;
    this.positions = snap.positions ?? [];
    this.pendingOrders = snap.pendingOrders ?? [];
    this.closedTrades = snap.closedTrades ?? [];
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Process a new candle: fill pending orders, check SL/TP on open positions.
   * @param {import('../../feeds/IDataFeed').Candle} candle
   */
  _onCandle(candle) {
    this._processPendingOrders(candle);
    this._checkSLTP(candle);
    this._updateEquity(candle.close);
  }

  _processPendingOrders(candle) {
    const stillPending = [];
    for (const order of this.pendingOrders) {
      const fillPrice = this._fillModel.checkLimitFill(candle, order);
      if (fillPrice !== null) {
        const filled = { ...order, status: 'open', filledTime: candle.time };
        this.positions.push(filled);
        EventBus.emit(Events.ORDER_FILLED, { order: filled, fillPrice, fillTime: candle.time });
        EventBus.emit(Events.POSITION_OPENED, { position: filled });
      } else {
        stillPending.push(order);
      }
    }
    this.pendingOrders = stillPending;
  }

  _checkSLTP(candle) {
    const toClose = [];
    const remaining = [];

    for (const pos of this.positions) {
      const result = this._fillModel.checkSLTP(candle, pos);
      if (result) {
        toClose.push({ pos, closePrice: result.price, reason: result.reason });
      } else {
        remaining.push(pos);
      }
    }

    this.positions = remaining;
    for (const { pos, closePrice } of toClose) {
      this._finaliseClose(pos, closePrice, candle.time);
    }
  }

  _finaliseClose(pos, closePrice, closeTime) {
    const pnl = this._calculatePnL(pos, closePrice);
    const closed = {
      ...pos,
      status: 'closed',
      closePrice,
      closeTime,
      closedAt: new Date(),
      pnl,
      pnlPercent: (pnl / (pos.entryPrice * pos.positionSize)) * 100,
    };
    this.closedTrades.push(closed);
    this.balance += pnl;
    EventBus.emit(Events.POSITION_CLOSED, { position: closed, closePrice, closeTime, pnl });
    EventBus.emit(Events.BALANCE_CHANGED, { balance: this.balance, equity: this.equity, change: pnl });
  }

  _updateEquity(currentPrice) {
    let unrealised = 0;
    for (const pos of this.positions) {
      unrealised += this._calculatePnL(pos, currentPrice);
    }
    this.equity = this.balance + unrealised;
  }

  /**
   * @param {Position} pos
   * @param {number} closePrice
   * @returns {number}
   */
  _calculatePnL(pos, closePrice) {
    const direction = pos.side === 'long' ? 1 : -1;
    const priceDiff = (closePrice - pos.entryPrice) * direction;
    return priceDiff * pos.positionSize * pos.leverage;
  }
}

/** Application-wide singleton execution engine. */
export const executionEngine = new ExecutionEngine();
