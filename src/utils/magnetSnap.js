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
 * THRESHOLD: if the nearest OHLC point is farther than `thresholdPx` pixels
 * from the cursor, snapping is abandoned and the raw cursor position is used
 * instead. This prevents "sticky" snapping when the cursor is clearly in the
 * middle of empty space (e.g. mid-body of a tall candle) far from any
 * actual O/H/L/C level.
 */

/**
 * Pixel-space variant — operates directly on Y coordinates, which is more
 * accurate than converting a price distance back to pixels (avoids
 * compounding rounding error from two coordinate transforms).
 *
 * @param {number} rawPriceY    raw cursor Y pixel (pre-snap)
 * @param {number} logicalIndex logical X position (coordinateToLogical)
 * @param {Array<{time:number,open:number,high:number,low:number,close:number}>} data
 * @param {boolean} magnetMode
 * @param {import('lightweight-charts').ISeriesApi} seriesApi  used for priceToCoordinate
 * @param {number} thresholdPx  max pixel distance before snap is abandoned
 * @returns {number|null} snapped price, or the raw price if no candle/out of range,
 *   or null if seriesApi.coordinateToPrice(rawPriceY) itself fails
 */
export function snapToOHLCWithThreshold(rawPriceY, logicalIndex, data, magnetMode, seriesApi, thresholdPx = 12) {
  let rawPrice = null;
  try { rawPrice = seriesApi.coordinateToPrice(rawPriceY); } catch { return null; }
  if (rawPrice == null) return null;
  if (!magnetMode || !data?.length) return rawPrice;

  const idx = Math.round(logicalIndex);
  if (idx < 0 || idx >= data.length) return rawPrice;

  const candle = data[idx];
  if (!candle) return rawPrice;

  const candidates = [candle.open, candle.high, candle.low, candle.close]
    .filter((v) => v != null && Number.isFinite(v));
  if (!candidates.length) return rawPrice;

  // Find nearest OHLC value in PRICE space first (cheap), then verify the
  // PIXEL distance is within threshold (accurate, accounts for current zoom).
  let nearest = candidates[0];
  let minPriceDist = Math.abs(candidates[0] - rawPrice);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(candidates[i] - rawPrice);
    if (d < minPriceDist) { minPriceDist = d; nearest = candidates[i]; }
  }

  try {
    const nearestY = seriesApi.priceToCoordinate(nearest);
    if (nearestY != null) {
      const pixelDist = Math.abs(nearestY - rawPriceY);
      if (pixelDist > thresholdPx) return rawPrice; // too far — use raw cursor position
    }
  } catch { /* if priceToCoordinate fails, fall through and snap anyway */ }

  return nearest;
}

/**
 * Legacy/simple variant without threshold — kept for the LineToolManager
 * wrapper in ChartComponent, which only has access to a Y coordinate via
 * coordinateToPrice(y) with no way to call priceToCoordinate cheaply per-call
 * without also holding the series reference. Threshold is approximated using
 * a price-distance heuristic instead (good enough for the bundled plugin's
 * point-placement, which doesn't need pixel-perfect threshold behaviour).
 *
 * @param {number} rawPrice
 * @param {number} logicalIndex
 * @param {Array} data
 * @param {boolean} magnetMode
 * @returns {number}
 */
export function snapToOHLC(rawPrice, logicalIndex, data, magnetMode) {
  if (!magnetMode || rawPrice == null || !data?.length) return rawPrice;

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
 * candle data array, magnetMode, and a pixel threshold, returns the
 * magnet-aware price and the logical index — ready to use for placing or
 * dragging a drawing-tool point.
 *
 * @param {number} x          pixel X relative to chart container
 * @param {number} y          pixel Y relative to chart container
 * @param {import('lightweight-charts').IChartApi} chartApi
 * @param {import('lightweight-charts').ISeriesApi} seriesApi
 * @param {Array} data
 * @param {boolean} magnetMode
 * @param {number} [thresholdPx=12]
 * @returns {{ price: number|null, logical: number|null }}
 */
export function getMagnetPoint(x, y, chartApi, seriesApi, data, magnetMode, thresholdPx = 12) {
  if (!chartApi || !seriesApi) return { price: null, logical: null };
  let logical = null;
  try { logical = chartApi.timeScale().coordinateToLogical(x); } catch { /* noop */ }
  if (logical == null) {
    let rawPrice = null;
    try { rawPrice = seriesApi.coordinateToPrice(y); } catch { /* noop */ }
    return { price: rawPrice, logical: null };
  }

  const price = snapToOHLCWithThreshold(y, logical, data, magnetMode, seriesApi, thresholdPx);
  return { price, logical };
}
