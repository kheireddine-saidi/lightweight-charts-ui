/**
 * magnetSnap — replicates LightweightCharts' internal MagnetOHLC snapping
 * algorithm, since LWC only exposes this behaviour for its own crosshair
 * rendering (via a private `_internal_align` method) and NOT through any
 * public API. Neither `chart.subscribeClick()` nor `chart.subscribeCrosshairMove()`
 * report the snapped price — both only report the raw mouse pixel position.
 *
 * This means any third-party drawing tool (our TradeSetupTool, the bundled
 * LineToolManager plugin, etc.) that wants points to respect magnet mode must
 * compute the snap itself. This utility does exactly what LWC's internal
 * `Magnet._internal_align()` does:
 *   1. Find the candle whose time is nearest the cursor's logical X position
 *   2. Compare the cursor's raw price against that candle's open/high/low/close
 *   3. Return whichever OHLC value is closest in *price* to the cursor
 *
 * @param {number} rawPrice         price computed from raw mouse Y (coordinateToPrice)
 * @param {number} logicalIndex     logical X position (coordinateToLogical)
 * @param {Array<{time:number,open:number,high:number,low:number,close:number}>} data
 * @param {boolean} magnetMode      whether magnet mode is enabled
 * @returns {number} snapped price (== rawPrice if magnetMode is false or no candle found)
 */
export function snapToOHLC(rawPrice, logicalIndex, data, magnetMode) {
  if (!magnetMode || rawPrice == null || !data?.length) return rawPrice;

  // logicalIndex is a float (e.g. 42.3) — round to the nearest integer bar index.
  const idx = Math.round(logicalIndex);
  if (idx < 0 || idx >= data.length) return rawPrice;

  const candle = data[idx];
  if (!candle) return rawPrice;

  const candidates = [candle.open, candle.high, candle.low, candle.close]
    .filter((v) => v != null && Number.isFinite(v));
  if (!candidates.length) return rawPrice;

  let nearest = candidates[0];
  let minDist = Math.abs(candidates[0] - rawPrice);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(candidates[i] - rawPrice);
    if (d < minDist) { minDist = d; nearest = candidates[i]; }
  }
  return nearest;
}

/**
 * Convenience wrapper: given pixel coordinates, the chart/series APIs, the
 * candle data array, and magnetMode, returns the magnet-aware price and the
 * logical index — ready to use for placing or dragging a drawing-tool point.
 *
 * @param {number} x          pixel X relative to chart container
 * @param {number} y          pixel Y relative to chart container
 * @param {import('lightweight-charts').IChartApi} chartApi
 * @param {import('lightweight-charts').ISeriesApi} seriesApi
 * @param {Array} data
 * @param {boolean} magnetMode
 * @returns {{ price: number|null, logical: number|null }}
 */
export function getMagnetPoint(x, y, chartApi, seriesApi, data, magnetMode) {
  if (!chartApi || !seriesApi) return { price: null, logical: null };
  let logical = null;
  let rawPrice = null;
  try { logical = chartApi.timeScale().coordinateToLogical(x); } catch { /* noop */ }
  try { rawPrice = seriesApi.coordinateToPrice(y); } catch { /* noop */ }
  if (logical == null || rawPrice == null) return { price: rawPrice, logical };

  const price = snapToOHLC(rawPrice, logical, data, magnetMode);
  return { price, logical };
}
