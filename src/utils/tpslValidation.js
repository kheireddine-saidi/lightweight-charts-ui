/**
 * tpslValidation — shared TP/SL placement validation used by both
 * PositionsPanel (editing open positions / pending orders) and
 * TradingPanel (placing/editing new orders).
 *
 * Rules:
 * ── Open positions (side relative to CURRENT MARKET PRICE) ──
 *   Long:  TP must be ABOVE current price.  SL must be BELOW current price.
 *          If TP <= price  → would execute as an immediate market sell → invalid.
 *          If SL >= price  → would execute as an immediate market sell → invalid.
 *   Short: TP must be BELOW current price.  SL must be ABOVE current price.
 *          If TP >= price  → would execute as an immediate market buy  → invalid.
 *          If SL <= price  → would execute as an immediate market buy  → invalid.
 *
 * ── Pending orders (side relative to the order's ENTRY PRICE, not market) ──
 *   Long:  TP must be ABOVE entry. SL must be BELOW entry.
 *   Short: TP must be BELOW entry. SL must be ABOVE entry.
 *   (A pending order hasn't filled yet, so "current price" is irrelevant —
 *    what matters is whether TP/SL would immediately trigger relative to
 *    where the position will actually open.)
 */

/**
 * @param {'long'|'short'} side
 * @param {'open'|'pending'} status
 * @param {number} referencePrice  current market price (open) or entry price (pending)
 * @param {number|null} tp
 * @param {number|null} sl
 * @returns {{ valid: boolean, field: 'tp'|'sl'|null, message: string|null }}
 */
export function validateTPSL(side, status, referencePrice, tp, sl) {
  if (side === 'long') {
    if (tp != null && tp <= referencePrice) {
      return {
        valid: false,
        field: 'tp',
        message: status === 'pending'
          ? 'Take Profit must be above the entry price for a long order.'
          : 'Price is above Take Profit — this would execute a market sell immediately.',
      };
    }
    if (sl != null && sl >= referencePrice) {
      return {
        valid: false,
        field: 'sl',
        message: status === 'pending'
          ? 'Stop Loss must be below the entry price for a long order.'
          : 'Price is below Stop Loss — this would execute a market sell immediately.',
      };
    }
  } else {
    // short
    if (tp != null && tp >= referencePrice) {
      return {
        valid: false,
        field: 'tp',
        message: status === 'pending'
          ? 'Take Profit must be below the entry price for a short order.'
          : 'Price is below Take Profit — this would execute a market buy immediately.',
      };
    }
    if (sl != null && sl <= referencePrice) {
      return {
        valid: false,
        field: 'sl',
        message: status === 'pending'
          ? 'Stop Loss must be above the entry price for a short order.'
          : 'Price is above Stop Loss — this would execute a market buy immediately.',
      };
    }
  }
  return { valid: true, field: null, message: null };
}
