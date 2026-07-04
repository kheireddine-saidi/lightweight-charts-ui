/**
 * PineFillRenderer — ISeriesPrimitive that shades the area between two
 * numeric series (from fill() or linefill()) or two constant hline levels.
 *
 * One primitive instance per fill()/linefill() call.
 * Recreated on each full indicator run (fills aren't performance-critical).
 *
 * Coordinate conversion helpers are shared with PineObjectPool (Step 4).
 *
 * The LWC ISeriesPrimitive contract:
 *   - paneViews() → PaneView[]
 *   - Each PaneView: update() + renderer() → Renderer
 *   - Renderer: draw(scope) using scope.useBitmapCoordinateSpace(({context,...}) => ...)
 */

// ─── Coordinate helpers ──────────────────────────────────────────────────────

/**
 * Convert a bar-index (0-based integer) to a pixel x coordinate.
 * Returns null if the bar is off-screen.
 *
 * @param {number} barIndex  zero-based bar index
 * @param {object} chart     LWC IChartApi
 * @param {object[]} candles raw candle array (used to map index → timestamp)
 */
export function barIndexToX(barIndex, chart, candles) {
  if (barIndex < 0 || barIndex >= candles.length) return null;
  const ts = candles[barIndex]?.time;
  if (ts == null) return null;
  return chart.timeScale().timeToCoordinate(ts);
}

/**
 * Convert an ms timestamp (xloc=bt) to a pixel x coordinate.
 * LWC timeScale uses seconds; pinets bt values are ms.
 *
 * @param {number} msTimestamp  unix timestamp in milliseconds
 * @param {object} chart        LWC IChartApi
 */
export function msTimestampToX(msTimestamp, chart) {
  return chart.timeScale().timeToCoordinate(msTimestamp / 1000);
}

/**
 * Convert a Pine xloc x-value to pixel x.
 * @param {number} x
 * @param {'bi'|'bt'} xloc
 * @param {object} chart
 * @param {object[]} candles
 */
export function pineXToPixel(x, xloc, chart, candles) {
  if (xloc === 'bt') return msTimestampToX(x, chart);
  return barIndexToX(x, chart, candles);
}

/**
 * Convert a price to pixel y using a series's price scale.
 * @param {number} price
 * @param {object} series  LWC ISeries
 */
export function priceToY(price, series) {
  return series.priceToCoordinate(price);
}

// ─── Fill polygon renderer ────────────────────────────────────────────────────

/**
 * Renderer: draws a filled polygon between two y-value arrays at the same
 * x positions.
 *
 * points1 and points2 are parallel arrays of {x, y} pixel coords (or null).
 * We walk forward along points1 and backward along points2 to form a closed polygon.
 */
class FillRenderer {
  constructor(points1, points2, color) {
    this._points1 = points1;
    this._points2 = points2;
    this._color   = color;
  }

  draw(scope) {
    const p1 = this._points1;
    const p2 = this._points2;
    if (!p1.length || !p2.length) return;

    scope.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.beginPath();

      // Walk forward along upper boundary
      let started = false;
      for (const pt of p1) {
        if (pt.x == null || pt.y == null) continue;
        const px = Math.round(pt.x * hr);
        const py = Math.round(pt.y * vr);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else { ctx.lineTo(px, py); }
      }

      // Walk backward along lower boundary to close the polygon
      for (let i = p2.length - 1; i >= 0; i--) {
        const pt = p2[i];
        if (pt.x == null || pt.y == null) continue;
        ctx.lineTo(Math.round(pt.x * hr), Math.round(pt.y * vr));
      }

      ctx.closePath();
      ctx.fillStyle = this._color;
      ctx.fill();
      ctx.restore();
    });
  }
}

/**
 * PaneView: holds resolved pixel coords, rebuilt on update().
 */
class FillPaneView {
  constructor(source) {
    this._source  = source;
    this._points1 = [];
    this._points2 = [];
  }

  update() {
    const { series1Data, series2Data, chart, series, candles } = this._source;
    this._points1 = _resolvePoints(series1Data, chart, series, candles);
    this._points2 = _resolvePoints(series2Data, chart, series, candles);
  }

  renderer() {
    return new FillRenderer(this._points1, this._points2, this._source.color);
  }
}

/**
 * Resolve a data array (time+value pairs) into pixel {x, y} arrays.
 * Returns null entries for off-screen bars.
 */
function _resolvePoints(data, chart, series, _candles) {
  if (!data?.length) return [];
  return data.map(pt => {
    const x = chart.timeScale().timeToCoordinate(pt.time);
    const y = pt.value != null ? series.priceToCoordinate(pt.value) : null;
    return { x, y };
  }).filter(pt => pt.x != null && pt.y != null);
}

/**
 * PineFillRenderer — ISeriesPrimitive that fills between two data sets.
 *
 * Usage:
 *   const prim = new PineFillRenderer({
 *     series1Data: [{time, value}, ...],   // upper boundary
 *     series2Data: [{time, value}, ...],   // lower boundary
 *     color: 'rgba(41,98,255,0.2)',
 *     chart,    // LWC IChartApi
 *     series,   // LWC ISeries (price scale reference)
 *     candles,  // raw candle array for bar-index→timestamp lookup
 *   });
 *   mainSeries.attachPrimitive(prim);
 *   // later:
 *   mainSeries.detachPrimitive(prim);
 */
export class PineFillRenderer {
  constructor({ series1Data, series2Data, color, chart, series, candles }) {
    this._view = new FillPaneView({
      series1Data,
      series2Data,
      color: color ?? 'rgba(41,98,255,0.2)',
      chart,
      series,
      candles,
    });
    this._paneViews = [this._view];
  }

  paneViews() {
    return this._paneViews;
  }

  /** Called by LWC before each draw — update pixel coords. */
  updateAllViews() {
    this._view.update();
  }

  /** Detach this primitive from whatever series it's attached to. */
  detach(series) {
    try { series?.detachPrimitive(this); } catch { /* ignore */ }
  }
}

// ─── Hline fill variant ───────────────────────────────────────────────────────

/**
 * PineHlineFillRenderer — fills between two constant horizontal levels.
 * Uses the same polygon approach but with flat lines spanning the visible range.
 */
class HlineFillPaneView {
  constructor(source) {
    this._source = source;
    this._points1 = [];
    this._points2 = [];
  }

  update() {
    const { value1, value2, chart, series } = this._source;
    const ts = chart.timeScale();
    const range = ts.getVisibleRange();
    if (!range) { this._points1 = []; this._points2 = []; return; }

    // Two points per flat line — left edge and right edge of visible range
    const x0 = ts.timeToCoordinate(range.from);
    const x1 = ts.timeToCoordinate(range.to);
    const y1 = series.priceToCoordinate(value1);
    const y2 = series.priceToCoordinate(value2);

    if (x0 == null || x1 == null || y1 == null || y2 == null) {
      this._points1 = []; this._points2 = []; return;
    }

    this._points1 = [{ x: x0, y: y1 }, { x: x1, y: y1 }];
    this._points2 = [{ x: x0, y: y2 }, { x: x1, y: y2 }];
  }

  renderer() {
    return new FillRenderer(this._points1, this._points2, this._source.color);
  }
}

export class PineHlineFillRenderer {
  constructor({ value1, value2, color, chart, series }) {
    this._view = new HlineFillPaneView({ value1, value2, color: color ?? 'rgba(128,128,128,0.2)', chart, series });
    this._paneViews = [this._view];
  }

  paneViews() { return this._paneViews; }
  updateAllViews() { this._view.update(); }
  detach(series) { try { series?.detachPrimitive(this); } catch { /* ignore */ } }
}

// ─── Linefill variant ─────────────────────────────────────────────────────────

/**
 * PineLinefillRenderer — fills between two line segments (from linefill.new()).
 *
 * Each linefill entry contains line1 and line2 as full line objects.
 * We sample each line at matching bar positions (x1→x2 with linear interpolation)
 * and fill the polygon between them.
 */
class LinefillPaneView {
  constructor(source) {
    this._source = source;
    this._points1 = [];
    this._points2 = [];
  }

  update() {
    const { entries, chart, series, candles } = this._source;
    const pts1 = [], pts2 = [];

    for (const entry of entries) {
      const { line1, line2 } = entry;
      if (!line1 || !line2) continue;

      // Each line: x1,y1 → x2,y2. We use the endpoint (x2,y2) as the representative point.
      const xloc = line1.xloc ?? 'bi';
      const x1   = pineXToPixel(line1.x2, xloc, chart, candles);
      const y1   = line1.y2 != null ? series.priceToCoordinate(line1.y2) : null;
      const x2   = pineXToPixel(line2.x2, xloc, chart, candles);
      const y2   = line2.y2 != null ? series.priceToCoordinate(line2.y2) : null;

      if (x1 != null && y1 != null) pts1.push({ x: x1, y: y1 });
      if (x2 != null && y2 != null) pts2.push({ x: x2, y: y2 });
    }

    this._points1 = pts1;
    this._points2 = pts2;
  }

  renderer() {
    return new FillRenderer(this._points1, this._points2, this._source.color);
  }
}

export class PineLinefillRenderer {
  /**
   * @param {{ entries: PineLinefillObject[], color: string, chart, series, candles }}
   */
  constructor({ entries, color, chart, series, candles }) {
    this._view = new LinefillPaneView({
      entries,
      color: color ?? 'rgba(128,128,128,0.2)',
      chart,
      series,
      candles,
    });
    this._paneViews = [this._view];
  }

  paneViews() { return this._paneViews; }
  updateAllViews() { this._view.update(); }
  detach(series) { try { series?.detachPrimitive(this); } catch { /* ignore */ } }
}
