/**
 * OrderManager — manages pending orders (limit/stop) lifecycle.
 *
 * Responsible for:
 *   - Adding, cancelling, and updating pending orders
 *   - TPSL validation on updates (delegated to ExecutionEngine callback)
 *   - Matching orders against ticks and candles via FillModel
 *
 * Pure data manager — no EventBus emissions. The coordinator (ExecutionEngine)
 * reads results and emits events.
 *
 * No React imports. No chart imports.
 */

import { FillModel } from './FillModel';

export class OrderManager {
  /**
   * @param {FillModel} fillModel  shared FillModel instance from ExecutionEngine
   * @param {(current, fields, status, refPrice) => object} validateTPSL
   *   Callback to ExecutionEngine._validateAndFilterTPSL — keeps validation
   *   logic in one place while allowing the manager to remain event-free.
   */
  constructor(fillModel, validateTPSL) {
    this._fillModel   = fillModel;
    this._validateTPSL = validateTPSL;
    /** @type {Array<object>} */
    this.orders       = [];
    /**
     * Last known price per symbol for crossover detection.
     * Keyed by symbol string so multi-symbol order books are correct.
     * @type {Record<string, number>}
     */
    this._prevPriceBySymbol = {};
  }

  // ─── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Add a new pending order.
   * @param {object} orderData  fully-formed order object (already has id from EE)
   * @returns {object}  the stored order
   */
  addOrder(orderData) {
    const order = { ...orderData };
    this.orders.push(order);
    return order;
  }

  /**
   * Cancel an order by id.
   * @param {string} id
   * @returns {object|null}  the removed order, or null if not found
   */
  cancelOrder(id) {
    const idx = this.orders.findIndex(o => o.id === id);
    if (idx === -1) return null;
    const [removed] = this.orders.splice(idx, 1);
    return removed;
  }

  /**
   * Update a pending order's fields (SL/TP, size, etc.) with TPSL validation.
   * @param {string} id
   * @param {object} rawFields   proposed changes
   * @returns {{ order: object|null, safeFields: object }}
   *   order  - updated order or null if not found
   *   safeFields - the validated (possibly pruned) fields that were applied
   */
  updateOrder(id, rawFields) {
    const idx = this.orders.findIndex(o => o.id === id);
    if (idx === -1) return { order: null, safeFields: {} };

    const order = this.orders[idx];
    const safeFields = this._validateTPSL(order, rawFields, 'pending', order.entryPrice);
    this.orders[idx] = { ...order, ...safeFields };
    return { order: this.orders[idx], safeFields };
  }

  /**
   * Directly patch an order (bypasses validation — used for margin-resize side effects).
   * @param {string} id
   * @param {object} fields
   */
  patchOrder(id, fields) {
    const idx = this.orders.findIndex(o => o.id === id);
    if (idx === -1) return;
    this.orders[idx] = { ...this.orders[idx], ...fields };
  }

  /** @param {string} id */
  getOrder(id) {
    return this.orders.find(o => o.id === id) ?? null;
  }

  // ─── Tick / Candle matching ─────────────────────────────────────────────────

  /**
   * Match pending orders against a live price tick.
   * Updates internal prevPrice for crossover detection.
   * @param {string} symbol
   * @param {number} price
   * @param {number} time  unix timestamp (seconds)
   * @returns {Array<object>}  orders that filled (each has fillPrice, fillTime added)
   */
  matchTick(symbol, price, time) {
    const prevPrice = this._prevPriceBySymbol[symbol] ?? null;
    const filled    = [];
    const remaining = [];

    for (const order of this.orders) {
      if (order.symbol !== symbol) { remaining.push(order); continue; }

      const fillPrice = this._fillModel.checkTickFill(price, prevPrice, order);
      if (fillPrice !== null) {
        filled.push({ ...order, fillPrice, fillTime: time });
      } else {
        remaining.push(order);
      }
    }

    this.orders                      = remaining;
    this._prevPriceBySymbol[symbol]  = price;
    return filled;
  }

  /**
   * Match pending orders against a closed candle (replay/backtest).
   * @param {string} symbol
   * @param {{ open:number, high:number, low:number, close:number, time:number }} candle
   * @returns {Array<object>}  orders that filled
   */
  matchCandle(symbol, candle) {
    const filled    = [];
    const remaining = [];

    for (const order of this.orders) {
      if (order.symbol !== symbol) { remaining.push(order); continue; }

      const fillPrice = this._fillModel.checkCandleFill(candle, order);
      if (fillPrice !== null) {
        filled.push({ ...order, fillPrice, fillTime: candle.time });
      } else {
        remaining.push(order);
      }
    }

    this.orders                      = remaining;
    this._prevPriceBySymbol[symbol]  = candle.close;
    return filled;
  }

  // ─── Snapshot support ───────────────────────────────────────────────────────

  getSnapshot() {
    return this.orders.map(o => ({ ...o }));
  }

  restoreSnapshot(orders) {
    this.orders = (orders ?? []).map(o => ({ ...o }));
  }
}
