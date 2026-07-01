/**
 * positionSizing — shared position-sizing utility.
 *
 * Used identically by both TradingPanel.jsx (new orders) and
 * ExecutionEngine.js (pending-order resize on SL drag). Keeping this in
 * utils/ mirrors the precedent set by utils/tpslValidation.js.
 *
 * No React imports. No side effects.
 */

/**
 * calculateRiskBasedPositionSize — position size such that if stopLossPrice
 * is hit, the loss equals exactly riskPercent of balance.
 *
 * Uses the same PnL formula as ExecutionEngine._calculatePnL /
 * TradingPanel's existing risk-display calc:
 *   loss = slDistance * positionSize * leverage
 *
 * @param {{ balance:number, riskPercent:number, entryPrice:number, stopLossPrice:number, leverage:number }} params
 * @returns {{ positionSize:number, quoteSize:number, requiredMargin:number } | null}
 *   null if inputs are invalid (zero/negative price, zero SL distance, zero leverage).
 */
export function calculateRiskBasedPositionSize({ balance, riskPercent, entryPrice, stopLossPrice, leverage }) {
  if (!entryPrice || !stopLossPrice || !leverage || balance <= 0) return null;
  const slDistance = Math.abs(entryPrice - stopLossPrice);
  if (slDistance === 0) return null;

  const riskAmount = balance * (riskPercent / 100);
  const positionSize = riskAmount / (slDistance * leverage);
  const quoteSize = positionSize * entryPrice;
  const requiredMargin = quoteSize / leverage;

  return { positionSize, quoteSize, requiredMargin };
}
