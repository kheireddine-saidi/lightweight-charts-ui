/**
 * FillModel — determines fill prices for orders within a single OHLCV candle.
 *
 * Because this simulator operates on 1-minute candle granularity (not tick data),
 * we must make an assumption about the intra-candle price path.
 *
 * Modes
 * ─────
 * conservative  open → high → low → close   (worst-case for longs, SL first)
 * optimistic    open → low → high → close   (best-case for longs, TP first)
 *
 * For each candle, the fill model determines:
 *  - whether a limit / stop order triggers
 *  - whether an open position's SL or TP is hit
 *  - which price level is reached first
 *
 * No React imports. No chart imports.
 */

/**
 * @typedef {'conservative'|'optimistic'} FillMode
 *
 * @typedef {{ time:number, open:number, high:number, low:number, close:number, volume?:number }} Candle
 *
 * @typedef {{
 *   id: string,
 *   side: 'long'|'short',
 *   type: 'market'|'limit'|'stop',
 *   limitPrice?: number,
 *   stopLoss?: number,
 *   takeProfit?: number,
 *   entryPrice: number,
 * }} Order
 */

export class FillModel {
  /** @param {FillMode} [mode='conservative'] */
  constructor(mode = 'conservative') {
    this.setMode(mode);
  }

  /**
   * Change the fill mode at runtime.
   * @param {FillMode} mode
   */
  setMode(mode) {
    if (mode !== 'conservative' && mode !== 'optimistic') {
      throw new Error(`FillModel: unknown mode "${mode}". Use 'conservative' or 'optimistic'.`);
    }
    /** @type {FillMode} */
    this.mode = mode;
  }

  /**
   * Intra-candle price sequence based on the current mode.
   * Returns the sequence of prices in the order they are assumed to occur.
   * @param {Candle} candle
   * @returns {number[]}
   */
  priceSequence(candle) {
    const { open, high, low, close } = candle;
    return this.mode === 'conservative'
      ? [open, high, low, close]   // conservative: high before low
      : [open, low, high, close];  // optimistic:   low before high
  }

  /**
   * Check whether a pending limit / stop order is filled by this candle.
   *
   * @param {Candle} candle
   * @param {Order} order
   * @returns {number|null}  fill price, or null if not filled
   */
  checkLimitFill(candle, order) {
    const triggerPrice = order.limitPrice ?? order.entryPrice;
    if (triggerPrice == null) return null;

    const { low, high } = candle;

    if (order.type === 'limit') {
      // Long limit: fill if candle low touches or goes below limit price
      if (order.side === 'long' && low <= triggerPrice && high >= candle.open) {
        return triggerPrice;
      }
      // Short limit: fill if candle high touches or exceeds limit price
      if (order.side === 'short' && high >= triggerPrice) {
        return triggerPrice;
      }
    }

    if (order.type === 'stop') {
      // Long stop-entry: fill if candle high reaches stop price
      if (order.side === 'long' && high >= triggerPrice) {
        return Math.max(triggerPrice, candle.open); // slippage: open if gapped
      }
      // Short stop-entry: fill if candle low reaches stop price
      if (order.side === 'short' && low <= triggerPrice) {
        return Math.min(triggerPrice, candle.open);
      }
    }

    return null;
  }

  /**
   * Check whether an open position's SL or TP is hit by this candle.
   *
   * Respects the price sequence for the current mode so that "which comes
   * first" is deterministic.
   *
   * @param {Candle} candle
   * @param {Order} position
   * @returns {{ price: number, reason: 'sl'|'tp' } | null}
   */
  checkSLTP(candle, position) {
    const { stopLoss: sl, takeProfit: tp, side } = position;
    if (!sl && !tp) return null;

    const sequence = this.priceSequence(candle);

    for (const price of sequence) {
      // Stop-loss check
      if (sl != null) {
        if (side === 'long' && price <= sl) return { price: sl, reason: 'sl' };
        if (side === 'short' && price >= sl) return { price: sl, reason: 'sl' };
      }
      // Take-profit check
      if (tp != null) {
        if (side === 'long' && price >= tp) return { price: tp, reason: 'tp' };
        if (side === 'short' && price <= tp) return { price: tp, reason: 'tp' };
      }
    }

    return null;
  }

  /**
   * Determine the fill price for a market order (always the candle open).
   * In live mode the actual WebSocket price is used instead.
   * @param {Candle} candle
   * @returns {number}
   */
  marketFill(candle) {
    return candle.open;
  }
}
