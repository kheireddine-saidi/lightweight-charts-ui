/**
 * FillModel — determines fill prices for orders.
 *
 * Fill logic (correct market semantics):
 * ─────────────────────────────────────
 * LONG LIMIT (buy limit):
 *   - If limitPrice >= currentPrice → fill immediately at currentPrice (above-market buy = market order)
 *   - If limitPrice < currentPrice  → fill when price ticks DOWN to or below limitPrice
 *
 * SHORT LIMIT (sell limit):
 *   - If limitPrice <= currentPrice → fill immediately at currentPrice (below-market sell = market order)
 *   - If limitPrice > currentPrice  → fill when price ticks UP to or above limitPrice
 *
 * SL/TP use the same real-time tick logic — no need to wait for candle close.
 *
 * checkTickFill() — called on EVERY live price tick (including in-progress candles)
 * checkSLTPTick() — called on EVERY live price tick for open positions
 *
 * For replay candles we synthesise ticks from OHLCV using priceSequence().
 */
export class FillModel {
  /**
   * @param {'conservative'|'optimistic'} [mode]
   */
  constructor(mode = 'conservative') {
    this.mode = mode;
  }

  setMode(mode) {
    this.mode = mode;
  }

  /**
   * Synthetic intra-candle price path for replay/backtesting.
   * conservative: open → high → low → close  (SL hits before TP for longs)
   * optimistic:   open → low → high → close
   * @param {{ open:number, high:number, low:number, close:number }} candle
   * @returns {number[]}
   */
  priceSequence(candle) {
    const { open, high, low, close } = candle;
    return this.mode === 'conservative'
      ? [open, high, low, close]
      : [open, low, high, close];
  }

  /**
   * Real-time fill check — called on every price tick.
   *
   * For pending limit/stop orders:
   *   Long limit  ≥ currentPrice → immediate fill at currentPrice
   *   Long limit  < currentPrice → fill when currentPrice ticks ≤ limitPrice
   *   Short limit ≤ currentPrice → immediate fill at currentPrice
   *   Short limit > currentPrice → fill when currentPrice ticks ≥ limitPrice
   *
   * @param {number} currentPrice  live tick price
   * @param {number} prevPrice     previous tick price (for crossover detection)
   * @param {{ side:string, type:string, limitPrice?:number, entryPrice:number }} order
   * @returns {number|null}  fill price or null
   */
  checkTickFill(currentPrice, prevPrice, order) {
    const limitPrice = order.limitPrice ?? order.entryPrice;
    if (limitPrice == null) return null;

    if (order.type === 'market') {
      // Market orders are filled immediately when submitted (handled by ExecutionEngine.openPosition)
      return null;
    }

    if (order.type === 'limit') {
      if (order.side === 'long') {
        // Buy limit: fill at or above market → immediate; otherwise wait for price to drop to limit
        if (limitPrice >= currentPrice) return currentPrice;
        // Crossed from above to at/below limit (price ticked down through)
        if (prevPrice !== null && prevPrice > limitPrice && currentPrice <= limitPrice) return limitPrice;
      } else {
        // Sell limit: fill at or below market → immediate; otherwise wait for price to rise to limit
        if (limitPrice <= currentPrice) return currentPrice;
        // Crossed from below to at/above limit (price ticked up through)
        if (prevPrice !== null && prevPrice < limitPrice && currentPrice >= limitPrice) return limitPrice;
      }
    }

    if (order.type === 'stop') {
      if (order.side === 'long') {
        // Buy stop: fill when price rises to stop (breakout long)
        if (currentPrice >= limitPrice) return limitPrice;
      } else {
        // Sell stop: fill when price drops to stop (breakout short)
        if (currentPrice <= limitPrice) return limitPrice;
      }
    }

    return null;
  }

  /**
   * Real-time SL/TP check — called on every price tick.
   * @param {number} currentPrice
   * @param {{ side:string, stopLoss?:number, takeProfit?:number }} position
   * @returns {{ price:number, reason:'sl'|'tp' }|null}
   */
  checkSLTPTick(currentPrice, position) {
    const { stopLoss: sl, takeProfit: tp, side } = position;

    if (side === 'long') {
      if (sl != null && currentPrice <= sl) return { price: sl, reason: 'sl' };
      if (tp != null && currentPrice >= tp) return { price: tp, reason: 'tp' };
    } else {
      if (sl != null && currentPrice >= sl) return { price: sl, reason: 'sl' };
      if (tp != null && currentPrice <= tp) return { price: tp, reason: 'tp' };
    }

    return null;
  }

  /**
   * Candle-based fill for replay/backtesting — iterates through synthetic
   * price sequence for deterministic fill ordering.
   * @param {{ open:number,high:number,low:number,close:number }} candle
   * @param {{ side:string, type:string, limitPrice?:number, entryPrice:number }} order
   * @returns {number|null}
   */
  checkCandleFill(candle, order) {
    const prices = this.priceSequence(candle);
    let prev = null;
    for (const p of prices) {
      const fill = this.checkTickFill(p, prev, order);
      if (fill !== null) return fill;
      prev = p;
    }
    return null;
  }

  /**
   * Candle-based SL/TP for replay/backtesting.
   * @param {{ open:number,high:number,low:number,close:number }} candle
   * @param {{ side:string, stopLoss?:number, takeProfit?:number }} position
   * @returns {{ price:number, reason:'sl'|'tp' }|null}
   */
  checkSLTPCandle(candle, position) {
    const { sl, tp } = { sl: position.stopLoss, tp: position.takeProfit };
    if (!sl && !tp) return null;

    for (const price of this.priceSequence(candle)) {
      const result = this.checkSLTPTick(price, position);
      if (result) return result;
    }
    return null;
  }

  /** Market fill price — candle open (replay) or live price */
  marketFill(candle) {
    return candle.open;
  }
}
