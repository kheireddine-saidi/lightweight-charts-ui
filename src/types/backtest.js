/**
 * BacktestResult — reproducible backtest result model.
 *
 * A BacktestResult must contain enough metadata to reproduce the run from
 * scratch. Never store only the final PnL.
 *
 * Structure:
 * ──────────
 * BacktestResult {
 *   id              — UUID
 *   symbol          — e.g. "BTCUSDT"
 *   timeframe       — e.g. "5m"
 *   startTime       — Unix seconds (first candle)
 *   endTime         — Unix seconds (last candle)
 *   strategyName    — human-readable strategy name
 *   strategyVersion — semver string
 *   dataVersion     — hash or tag of the dataset used
 *   trades          — closed trade array
 *   equityCurve     — [{time, equity}] sampled at each closed trade
 *   metrics {
 *     pnl            — total net PnL
 *     winRate        — 0–1
 *     maxDrawdown    — 0–1 (fraction of peak equity)
 *     profitFactor   — gross profit / gross loss
 *     expectancy     — average PnL per trade
 *   }
 * }
 */

/**
 * @typedef {{
 *   id: string,
 *   symbol: string,
 *   timeframe: string,
 *   startTime: number,
 *   endTime: number,
 *   strategyName: string,
 *   strategyVersion: string,
 *   dataVersion: string,
 *   trades: ClosedTrade[],
 *   equityCurve: EquityPoint[],
 *   metrics: BacktestMetrics,
 *   createdAt: string,
 * }} BacktestResult
 *
 * @typedef {{
 *   id: string,
 *   symbol: string,
 *   side: 'long'|'short',
 *   type: 'market'|'limit'|'stop',
 *   entryPrice: number,
 *   closePrice: number,
 *   positionSize: number,
 *   leverage: number,
 *   stopLoss?: number,
 *   takeProfit?: number,
 *   entryTime: number,
 *   closeTime: number,
 *   pnl: number,
 *   pnlPercent: number,
 * }} ClosedTrade
 *
 * @typedef {{ time: number, equity: number }} EquityPoint
 *
 * @typedef {{
 *   pnl: number,
 *   winRate: number,
 *   maxDrawdown: number,
 *   profitFactor: number,
 *   expectancy: number,
 * }} BacktestMetrics
 */

/**
 * Build a BacktestResult from raw closed trades and account context.
 *
 * @param {{
 *   symbol: string,
 *   timeframe: string,
 *   strategyName?: string,
 *   strategyVersion?: string,
 *   dataVersion?: string,
 *   initialBalance?: number,
 *   trades: ClosedTrade[],
 * }} params
 * @returns {BacktestResult}
 */
export function buildBacktestResult({
  symbol,
  timeframe,
  strategyName = 'Manual',
  strategyVersion = '0.0.1',
  dataVersion = 'unknown',
  initialBalance = 10_000,
  trades = [],
}) {
  const sorted = [...trades].sort((a, b) => a.closeTime - b.closeTime);

  const metrics = computeMetrics(sorted, initialBalance);
  const equityCurve = buildEquityCurve(sorted, initialBalance);

  return {
    id: crypto.randomUUID(),
    symbol,
    timeframe,
    startTime: sorted[0]?.entryTime ?? 0,
    endTime: sorted[sorted.length - 1]?.closeTime ?? 0,
    strategyName,
    strategyVersion,
    dataVersion,
    trades: sorted,
    equityCurve,
    metrics,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Compute summary metrics from an ordered list of closed trades.
 *
 * @param {ClosedTrade[]} trades
 * @param {number} initialBalance
 * @returns {BacktestMetrics}
 */
export function computeMetrics(trades, initialBalance = 10_000) {
  if (trades.length === 0) {
    return { pnl: 0, winRate: 0, maxDrawdown: 0, profitFactor: 0, expectancy: 0 };
  }

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let totalPnL = 0;

  for (const t of trades) {
    totalPnL += t.pnl;
    if (t.pnl > 0) { grossProfit += t.pnl; wins++; }
    else { grossLoss += Math.abs(t.pnl); }
  }

  const winRate = wins / trades.length;
  const profitFactor = grossLoss === 0 ? Infinity : grossProfit / grossLoss;
  const expectancy = totalPnL / trades.length;

  // Max drawdown: peak-to-trough on equity curve
  const curve = buildEquityCurve(trades, initialBalance);
  let peak = initialBalance;
  let maxDD = 0;
  for (const pt of curve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = (peak - pt.equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    pnl: totalPnL,
    winRate,
    maxDrawdown: maxDD,
    profitFactor,
    expectancy,
  };
}

/**
 * @param {ClosedTrade[]} trades
 * @param {number} initialBalance
 * @returns {EquityPoint[]}
 */
function buildEquityCurve(trades, initialBalance) {
  let equity = initialBalance;
  const curve = [{ time: trades[0]?.entryTime ?? 0, equity }];
  for (const t of trades) {
    equity += t.pnl;
    curve.push({ time: t.closeTime, equity });
  }
  return curve;
}

/**
 * Validate that a BacktestResult object has all required fields.
 * @param {unknown} result
 * @returns {result is BacktestResult}
 */
export function isValidBacktestResult(result) {
  if (!result || typeof result !== 'object') return false;
  const required = ['id', 'symbol', 'timeframe', 'startTime', 'endTime', 'trades', 'metrics'];
  return required.every((k) => k in result);
}
