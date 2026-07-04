/**
 * PineObjectPool — per-indicator pool for Pine drawing objects.
 *
 * Manages ISeriesPrimitive instances for line.new(), box.new(), label.new(),
 * and polyline.new() outputs. Diffs against current pool on every full run:
 *   - New ids    → create and attachPrimitive
 *   - Existing   → update coordinates/style in place
 *   - Gone ids   → detachPrimitive and remove
 *
 * Hard cap: combined total across all 4 types ≤ 500 objects per indicator.
 * Exceeding the cap logs one warning and truncates to the first 500.
 *
 * Coordinate helpers imported from PineFillRenderer to share the same
 * bar-index→pixel conversion logic.
 */

import { pineXToPixel, priceToY } from './PineFillRenderer.js';

const POOL_CAP = 500;

// ─── Tiny draw helpers ───────────────────────────────────────────────────────

function hexToRgba(hex, alpha = 1) {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  // Handle 8-char hex (RRGGBBAA from pinets) e.g. "#F2364519"
  const h = hex.replace('#', '');
  let r, g, b, a = alpha;
  if (h.length === 8) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
    a = parseInt(h.slice(6, 8), 16) / 255;
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    return hex; // pass-through if already rgba/named
  }
  return `rgba(${r},${g},${b},${a})`;
}

function roundPx(coord, ratio) {
  return Math.round(coord * ratio);
}

// ─── Line primitive ───────────────────────────────────────────────────────────

class LineRenderer {
  constructor(source) { this._s = source; }

  draw(scope) {
    const s = this._s;
    if (s.x1px == null || s.y1px == null || s.x2px == null || s.y2px == null) return;
    scope.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(roundPx(s.x1px, hr), roundPx(s.y1px, vr));
      ctx.lineTo(roundPx(s.x2px, hr), roundPx(s.y2px, vr));
      ctx.strokeStyle = hexToRgba(s.color);
      ctx.lineWidth = (s.width ?? 1) * hr;
      ctx.stroke();
      ctx.restore();
    });
  }
}

class LinePaneView {
  constructor(source) { this._s = source; }
  update() {
    const s = this._s;
    const xloc = s.obj.xloc ?? 'bi';
    s.x1px = pineXToPixel(s.obj.x1, xloc, s.chart, s.candles);
    s.y1px = priceToY(s.obj.y1, s.series);
    s.x2px = pineXToPixel(s.obj.x2, xloc, s.chart, s.candles);
    s.y2px = priceToY(s.obj.y2, s.series);
    s.color = s.obj.color;
    s.width = s.obj.width;
  }
  renderer() { return new LineRenderer(this._s); }
}

class LinePrimitive {
  constructor(obj, chart, series, candles) {
    this._state = { obj, chart, series, candles, x1px: null, y1px: null, x2px: null, y2px: null, color: null, width: null };
    this._views = [new LinePaneView(this._state)];
  }
  paneViews() { return this._views; }
  updateAllViews() { this._views.forEach(v => v.update()); }
  update(obj) { this._state.obj = obj; }
}

// ─── Box primitive ────────────────────────────────────────────────────────────

class BoxRenderer {
  constructor(source) { this._s = source; }

  draw(scope) {
    const s = this._s;
    if (s.x1px == null || s.y1px == null || s.x2px == null || s.y2px == null) return;
    scope.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const lx = roundPx(Math.min(s.x1px, s.x2px), hr);
      const rx = roundPx(Math.max(s.x1px, s.x2px), hr);
      const ty = roundPx(Math.min(s.y1px, s.y2px), vr);
      const by = roundPx(Math.max(s.y1px, s.y2px), vr);
      const w  = rx - lx;
      const h  = by - ty;
      ctx.save();

      // Background fill
      if (s.bgcolor) {
        ctx.fillStyle = hexToRgba(s.bgcolor);
        ctx.fillRect(lx, ty, w, h);
      }

      // Border
      const bw = (s.border_width ?? 1) * hr;
      if (bw > 0 && s.border_color) {
        ctx.strokeStyle = hexToRgba(s.border_color);
        ctx.lineWidth = bw;
        ctx.strokeRect(lx, ty, w, h);
      }

      // Text
      if (s.text) {
        const fontSize = Math.max(10, Math.min(14, h * 0.4));
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = hexToRgba(s.text_color ?? '#ffffff');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.text, lx + w / 2, ty + h / 2, w - 4);
      }

      ctx.restore();
    });
  }
}

class BoxPaneView {
  constructor(source) { this._s = source; }
  update() {
    const s = this._s;
    const xloc = s.obj.xloc ?? 'bi';
    s.x1px = pineXToPixel(s.obj.left,  xloc, s.chart, s.candles);
    s.y1px = priceToY(s.obj.top,    s.series);
    s.x2px = pineXToPixel(s.obj.right, xloc, s.chart, s.candles);
    s.y2px = priceToY(s.obj.bottom, s.series);
    s.bgcolor      = s.obj.bgcolor;
    s.border_color = s.obj.border_color;
    s.border_width = s.obj.border_width;
    s.text         = s.obj.text;
    s.text_color   = s.obj.text_color;
  }
  renderer() { return new BoxRenderer(this._s); }
}

class BoxPrimitive {
  constructor(obj, chart, series, candles) {
    this._state = { obj, chart, series, candles,
      x1px: null, y1px: null, x2px: null, y2px: null,
      bgcolor: null, border_color: null, border_width: null, text: null, text_color: null };
    this._views = [new BoxPaneView(this._state)];
  }
  paneViews() { return this._views; }
  updateAllViews() { this._views.forEach(v => v.update()); }
  update(obj) { this._state.obj = obj; }
}

// ─── Label primitive ──────────────────────────────────────────────────────────

class LabelRenderer {
  constructor(source) { this._s = source; }

  draw(scope) {
    const s = this._s;
    if (s.xpx == null || s.ypx == null) return;

    scope.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();

      const x  = roundPx(s.xpx, hr);
      const y  = roundPx(s.ypx, vr);
      const fontSize = 12 * hr;
      ctx.font = `${fontSize}px sans-serif`;

      const padding  = 4 * hr;
      const textW    = ctx.measureText(s.text || '').width;
      const boxW     = textW + padding * 2;
      const boxH     = fontSize + padding * 2;

      // Position: style determines whether label is above or below the pin point
      const isDown = (s.style ?? '').includes('down');
      const boxY   = isDown ? y : y - boxH;

      // Background box
      ctx.fillStyle = hexToRgba(s.color ?? '#2196F3');
      ctx.beginPath();
      ctx.roundRect(x - boxW / 2, boxY, boxW, boxH, 3 * hr);
      ctx.fill();

      // Text
      ctx.fillStyle = hexToRgba(s.textcolor ?? '#ffffff');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text || '', x, boxY + boxH / 2);

      ctx.restore();
    });
  }
}

class LabelPaneView {
  constructor(source) { this._s = source; }
  update() {
    const s = this._s;
    const xloc = s.obj.xloc ?? 'bi';
    s.xpx      = pineXToPixel(s.obj.x, xloc, s.chart, s.candles);

    // yloc: 'pr' = price, 'ab' = above bar top, 'bl' = below bar bottom
    if (s.obj.yloc === 'pr') {
      s.ypx = priceToY(s.obj.y, s.series);
    } else {
      // For 'ab'/'bl' we'd need bar high/low — approximate with bar's price for now
      s.ypx = priceToY(s.obj.y ?? 0, s.series);
    }

    s.text      = s.obj.text;
    s.color     = s.obj.color;
    s.textcolor = s.obj.textcolor;
    s.style     = s.obj.style;
  }
  renderer() { return new LabelRenderer(this._s); }
}

class LabelPrimitive {
  constructor(obj, chart, series, candles) {
    this._state = { obj, chart, series, candles, xpx: null, ypx: null, text: null, color: null, textcolor: null, style: null };
    this._views = [new LabelPaneView(this._state)];
  }
  paneViews() { return this._views; }
  updateAllViews() { this._views.forEach(v => v.update()); }
  update(obj) { this._state.obj = obj; }
}

// ─── Polyline primitive (best-effort — pinets may return empty) ────────────────

class PolylineRenderer {
  constructor(source) { this._s = source; }

  draw(scope) {
    const s = this._s;
    if (!s.points?.length) return;
    scope.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.beginPath();
      let first = true;
      for (const pt of s.points) {
        if (pt.x == null || pt.y == null) continue;
        const px = roundPx(pt.x, hr), py = roundPx(pt.y, vr);
        if (first) { ctx.moveTo(px, py); first = false; }
        else { ctx.lineTo(px, py); }
      }
      if (!first) {
        ctx.strokeStyle = hexToRgba(s.color ?? '#888');
        ctx.lineWidth = (s.width ?? 1) * hr;
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

class PolylinePaneView {
  constructor(source) { this._s = source; }
  update() {
    const s = this._s;
    const obj = s.obj;
    // polyline.new() object shape is TBD (pinets returns [] currently)
    // Try common field names: points / vertices / pts — handle gracefully
    const rawPts = obj.points ?? obj.vertices ?? obj.pts ?? [];
    s.points = rawPts.map(pt => ({
      x: pineXToPixel(pt.index ?? pt.x ?? 0, pt.xloc ?? 'bi', s.chart, s.candles),
      y: priceToY(pt.price ?? pt.y ?? 0, s.series),
    }));
    s.color = obj.line_color ?? obj.color;
    s.width = obj.line_width ?? obj.width;
  }
  renderer() { return new PolylineRenderer(this._s); }
}

class PolylinePrimitive {
  constructor(obj, chart, series, candles) {
    this._state = { obj, chart, series, candles, points: [], color: null, width: null };
    this._views = [new PolylinePaneView(this._state)];
  }
  paneViews() { return this._views; }
  updateAllViews() { this._views.forEach(v => v.update()); }
  update(obj) { this._state.obj = obj; }
}

// ─── PineObjectPool ───────────────────────────────────────────────────────────

export class PineObjectPool {
  /**
   * @param {{ chart: object, series: object, candles: object[] }} context
   * chart   — LWC IChartApi
   * series  — LWC ISeries (main series, used for price scale + primitive attachment)
   * candles — raw candle array for bar-index→timestamp lookup
   */
  constructor({ chart, series, candles }) {
    this._chart   = chart;
    this._series  = series;
    this._candles = candles;

    /** @type {Map<string, {primitive, type}>} */
    this._pool = new Map();
    this._capWarned = false;
  }

  /**
   * Update context refs (e.g. when candles are refreshed after a tick).
   */
  updateContext({ chart, series, candles }) {
    if (chart)   this._chart   = chart;
    if (series)  this._series  = series;
    if (candles) this._candles = candles;
  }

  /**
   * Sync the pool against a new snapshot of drawing objects.
   * Called after every full Pine run.
   *
   * @param {{ lines, boxes, labels, polylines }} objects
   */
  sync({ lines = [], boxes = [], labels = [], polylines = [] }) {
    // ── Apply 500-object cap ─────────────────────────────────────────────
    const total = lines.length + boxes.length + labels.length + polylines.length;
    if (total > POOL_CAP) {
      if (!this._capWarned) {
        console.warn(
          `[PineObjectPool] drawing object count ${total} exceeds cap of ${POOL_CAP}. ` +
          `Truncating to first ${POOL_CAP} objects. This warning fires once per indicator instance.`
        );
        this._capWarned = true;
      }
      // Truncate in priority order: lines first, then boxes, then labels, then polylines
      let remaining = POOL_CAP;
      lines     = lines.slice(0, remaining);     remaining -= lines.length;
      boxes     = boxes.slice(0, remaining);     remaining -= boxes.length;
      labels    = labels.slice(0, remaining);    remaining -= labels.length;
      polylines = polylines.slice(0, remaining);
    } else {
      this._capWarned = false; // reset if count drops back below cap
    }

    // ── Build the new desired state ──────────────────────────────────────
    const desired = new Map();
    for (const obj of lines)     desired.set(`line_${obj.id}`,     { obj, type: 'line' });
    for (const obj of boxes)     desired.set(`box_${obj.id}`,      { obj, type: 'box' });
    for (const obj of labels)    desired.set(`label_${obj.id}`,    { obj, type: 'label' });
    for (const obj of polylines) desired.set(`poly_${obj.id}`,     { obj, type: 'polyline' });

    // ── Remove stale entries ─────────────────────────────────────────────
    for (const [key, { primitive }] of this._pool) {
      if (!desired.has(key)) {
        this._detach(primitive);
        this._pool.delete(key);
      }
    }

    // ── Create new / update existing ─────────────────────────────────────
    for (const [key, { obj, type }] of desired) {
      if (this._pool.has(key)) {
        // Update in place — no destroy/recreate
        const { primitive } = this._pool.get(key);
        primitive.update(obj);
      } else {
        // Create new primitive
        const primitive = this._createPrimitive(type, obj);
        if (primitive) {
          try {
            this._series.attachPrimitive(primitive);
            this._pool.set(key, { primitive, type });
          } catch (e) {
            console.warn('[PineObjectPool] attachPrimitive error:', e);
          }
        }
      }
    }
  }

  /**
   * Remove all primitives from the series and clear the pool.
   */
  destroy() {
    for (const { primitive } of this._pool.values()) {
      this._detach(primitive);
    }
    this._pool.clear();
    this._capWarned = false;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _createPrimitive(type, obj) {
    const { _chart: chart, _series: series, _candles: candles } = this;
    try {
      switch (type) {
        case 'line':     return new LinePrimitive(obj, chart, series, candles);
        case 'box':      return new BoxPrimitive(obj, chart, series, candles);
        case 'label':    return new LabelPrimitive(obj, chart, series, candles);
        case 'polyline': return new PolylinePrimitive(obj, chart, series, candles);
        default:         return null;
      }
    } catch (e) {
      console.warn(`[PineObjectPool] create ${type} error:`, e);
      return null;
    }
  }

  _detach(primitive) {
    try { this._series?.detachPrimitive(primitive); } catch { /* ignore */ }
  }
}
