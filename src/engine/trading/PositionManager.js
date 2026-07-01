/**
 * PositionManager — manages open positions lifecycle.
 *
 * Responsible for:
 *   - Opening positions (from filled orders or direct market orders)
 *   - Closing positions (manual, SL, TP)
 *   - SL/TP updates with validation (via ExecutionEngine callback)
 *   - Per-position PnL calculation
 *   - SL/TP tick and candle checking via FillModel
 *
 * Pure data manager — no EventBus emissions.
 *
 * No React imports. No chart imports.
 */

import { FillModel } from './FillModel';

export class PositionManager {
  /**
   * @param {FillModel} fillModel  shared FillModel instance from ExecutionEngine
   * @param {(current, fields, status, refPrice) => object} validateTPSL  callback
   */
  constructor(fillModel, validateTPSL) {
    this._fillModel    = fillModel;
    this._validateTPSL = validateTPSL;
    /** @type {Array<object>} open positions */
    this.positions     = [];
    /** @type {Array<object>} closed trade history */
    this.closedTrades  = [];
    /**
     * Set of position IDs filled in the current candle — used to prevent
     * same-candle SL/TP on newly opened positions (replay/backtest).
     * @type {Set<string>}
     */
    this._filledThisCandle = new Set();
  }

  // ─── Open ───────────────────────────────────────────────────────────────────

  /**
   * Promote a filled order into an open position.
   * @param {object} filledOrder  order with fillPrice and fillTime attached
   * @returns {object}  the newly created position object
   */
  openPosition(filledOrder) {
    const pos = {
      ...filledOrder,
      status:      'open',
      entryPrice:  filledOrder.fillPrice,
      filledTime:  filledOrder.fillTime,
    };
    // Remove fill-only staging fields
    delete pos.fillPrice;
    delete pos.fillTime;

    this.positions.push(pos);
    return pos;
  }

  // ─── Close ──────────────────────────────────────────────────────────────────

  /**
   * Close a position by id.
   * @param {string} id
   * @param {number} closePrice
   * @param {number} closeTime    unix timestamp (seconds)
   * @param {string} [reason='manual']
   * @returns {object|null}  closed trade record (with pnl) or null if not found
   */
  closePosition(id, closePrice, closeTime, reason = 'manual') {
    const idx = this.positions.findIndex(p => p.id === id);
    if (idx === -1) return null;

    const [pos] = this.positions.splice(idx, 1);
    const pnl   = this._calculatePnL(pos, closePrice);

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
    this.closedTrades.push(closed);
    return closed;
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  /**
   * Update SL/TP on an open position (validated).
   * @param {string} id
   * @param {object} fields
   * @param {number} refPrice  current market price for validation
   * @returns {{ position: object|null, safeFields: object }}
   */
  updatePosition(id, fields, refPrice) {
    const idx = this.positions.findIndex(p => p.id === id);
    if (idx === -1) return { position: null, safeFields: {} };

    const pos        = this.positions[idx];
    const safeFields = this._validateTPSL(pos, fields, 'open', refPrice ?? pos.entryPrice);
    this.positions[idx] = { ...pos, ...safeFields };
    return { position: this.positions[idx], safeFields };
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  /** @param {string} [symbol]  filter by symbol or return all */
  getPositions(symbol) {
    return symbol ? this.positions.filter(p => p.symbol === symbol) : this.positions;
  }

  /** @param {string} id */
  getPosition(id) {
    return this.positions.find(p => p.id === id) ?? null;
  }

  // ─── SL/TP checking (tick) ──────────────────────────────────────────────────

  /**
   * Check SL/TP for all open positions on the given symbol against a live tick.
   * Returns triggered positions removed from the internal array.
   * @param {string} symbol
   * @param {number} price
   * @param {number} time
   * @returns {Array<{ pos:object, closePrice:number, reason:string }>}
   */
  checkSLTPTick(symbol, price, time) {
    const toClose   = [];
    const remaining = [];
    for (const pos of this.positions) {
      if (pos.symbol !== symbol) { remaining.push(pos); continue; }
      const result = this._fillModel.checkSLTPTick(price, pos);
      if (result) {
        toClose.push({ pos, closePrice: result.price, reason: result.reason });
      } else {
        remaining.push(pos);
      }
    }
    this.positions = remaining;
    return toClose;
  }

  // ─── SL/TP checking (candle) ────────────────────────────────────────────────

  /**
   * Reset the same-candle fill guard. Call at the start of each candle.
   */
  resetCandleGuard() {
    this._filledThisCandle = new Set();
  }

  /**
   * Mark a position id as filled in the current candle (skips SL/TP for it).
   * @param {string} id
   */
  markFilledThisCandle(id) {
    this._filledThisCandle.add(id);
  }

  /**
   * Check SL/TP for all open positions on the given symbol against a candle.
   * Skips positions filled in the same candle.
   * @param {string} symbol
   * @param {{ open:number, high:number, low:number, close:number, time:number }} candle
   * @returns {Array<{ pos:object, closePrice:number, reason:string }>}
   */
  checkSLTPCandle(symbol, candle) {
    const toClose   = [];
    const remaining = [];
    for (const pos of this.positions) {
      if (pos.symbol !== symbol)             { remaining.push(pos); continue; }
      if (this._filledThisCandle.has(pos.id)) { remaining.push(pos); continue; }

      const result = this._fillModel.checkSLTPCandle(candle, pos);
      if (result) {
        toClose.push({ pos, closePrice: result.price, reason: result.reason });
      } else {
        remaining.push(pos);
      }
    }
    this.positions = remaining;
    return toClose;
  }

  // ─── PnL ────────────────────────────────────────────────────────────────────

  /**
   * Calculate PnL for a position at a given price.
   * @param {object} pos
   * @param {number} price
   * @returns {number}
   */
  _calculatePnL(pos, price) {
    const direction = pos.side === 'long' ? 1 : -1;
    return (price - pos.entryPrice) * direction * pos.positionSize * pos.leverage;
  }

  /**
   * Get unrealised PnL for a single position at a given price.
   * @param {object} pos
   * @param {number} currentPrice
   * @returns {number}
   */
  getUnrealisedPnL(pos, currentPrice) {
    return this._calculatePnL(pos, currentPrice);
  }

  // ─── Snapshot support ───────────────────────────────────────────────────────

  getSnapshot() {
    return {
      positions:    this.positions.map(p => ({ ...p })),
      closedTrades: this.closedTrades.map(p => ({ ...p })),
    };
  }

  restoreSnapshot({ positions, closedTrades } = {}) {
    this.positions    = (positions    ?? []).map(p => ({ ...p }));
    this.closedTrades = (closedTrades ?? []).map(p => ({ ...p }));
  }
}
