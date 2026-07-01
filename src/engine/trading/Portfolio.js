/**
 * Portfolio — manages account-level accounting.
 *
 * Responsible for:
 *   - Balance (realised PnL bookkeeping)
 *   - Equity (balance + unrealised PnL across all open positions)
 *   - Reserved margin (locked in pending orders + open positions)
 *   - Last-price tracking per symbol (for equity recalculation)
 *
 * Pure data manager — no EventBus emissions, no order/position logic.
 *
 * No React imports. No chart imports.
 */

export class Portfolio {
  /**
   * @param {number} [initialBalance=10000]
   */
  constructor(initialBalance = 10_000) {
    this.balance        = initialBalance;
    this.equity         = initialBalance;
    this.reservedMargin = 0;
    /** @type {Record<string, number>} symbol → last known price */
    this._lastPriceBySymbol = {};
  }

  // ─── Price tracking ─────────────────────────────────────────────────────────

  /**
   * Update the last known price for a symbol.
   * @param {string} symbol
   * @param {number} price
   */
  setLastPrice(symbol, price) {
    this._lastPriceBySymbol[symbol] = price;
  }

  /**
   * Get the last known price for a symbol, falling back to a default.
   * @param {string} symbol
   * @param {number} [fallback=0]
   * @returns {number}
   */
  getLastPrice(symbol, fallback = 0) {
    return this._lastPriceBySymbol[symbol] ?? fallback;
  }

  // ─── Equity ─────────────────────────────────────────────────────────────────

  /**
   * Recalculate equity from current open positions.
   * Calls the provided PnL function (supplied by ExecutionEngine to avoid
   * duplicating _calculatePnL logic here).
   *
   * @param {Array<object>} positions   open positions from PositionManager
   * @param {(pos: object, price: number) => number} calcPnL  PnL fn
   * @returns {number}  updated equity
   */
  recalcEquity(positions, calcPnL) {
    let unrealised = 0;
    for (const pos of positions) {
      const price = this._lastPriceBySymbol[pos.symbol] ?? pos.entryPrice;
      unrealised += calcPnL(pos, price);
    }
    this.equity = this.balance + unrealised;
    return this.equity;
  }

  // ─── Balance / PnL ──────────────────────────────────────────────────────────

  /**
   * Credit (or debit) a realised PnL to balance.
   * Equity is NOT updated here — call recalcEquity() after if needed.
   * @param {number} pnl
   */
  applyRealisedPnL(pnl) {
    this.balance += pnl;
  }

  // ─── Margin ─────────────────────────────────────────────────────────────────

  /**
   * Lock margin for a new order/position.
   * @param {number} amount
   */
  reserveMargin(amount) {
    this.reservedMargin += amount;
  }

  /**
   * Release previously locked margin (on cancel, fill, or close).
   * Clamps to 0 to avoid floating-point drift.
   * @param {number} amount
   */
  releaseMargin(amount) {
    this.reservedMargin = Math.max(0, this.reservedMargin - amount);
  }

  /**
   * Adjust margin by a delta (positive = reserve more, negative = release).
   * Useful for resize operations where the old and new margin differ.
   * @param {number} delta  newMargin - oldMargin
   */
  adjustMargin(delta) {
    this.reservedMargin = Math.max(0, this.reservedMargin + delta);
  }

  // ─── Snapshot support ───────────────────────────────────────────────────────

  getSnapshot() {
    return {
      balance:        this.balance,
      equity:         this.equity,
      reservedMargin: this.reservedMargin,
    };
  }

  restoreSnapshot({ balance, equity, reservedMargin } = {}) {
    if (balance        != null) this.balance        = balance;
    if (equity         != null) this.equity         = equity;
    if (reservedMargin != null) this.reservedMargin = reservedMargin;
  }
}
