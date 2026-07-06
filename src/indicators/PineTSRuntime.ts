/**
 * PineTSRuntime — executes Pine Script indicators using pinets.
 *
 * Key design decisions:
 * - One PineTS instance per runtime (reused across runs) → avoids MaxListeners leak
 * - Source is pre-processed to strip unsupported parameters before execution
 * - Inputs are parsed statically from source (pinets doesn't expose them pre-run)
 * - Inputs are passed to Indicator constructor by their title name
 * - Indicator title is read from ctx.indicator.title after first run
 */
import { PineTS, Indicator } from 'pinets';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PineInputType = 'int' | 'float' | 'bool' | 'string' | 'color' | 'source' | 'timeframe';

export interface PineInputDef {
  varName:  string;
  title:    string;
  type:     PineInputType;
  default:  unknown;
  minval?:  number | null;
  maxval?:  number | null;
  step?:    number | null;
  options?: string[] | null;
}

export interface PineSeriesOutput {
  name:      string;
  color:     string;
  lineWidth: number;
  style:     string;   // 'style_line' | 'style_histogram' | 'style_circles' | 'style_stepline' | 'style_area' | 'style_columns'
  data:      { time: number; value: number }[];
}

export interface PineMarkerOutput {
  time:     number;
  shape:    string;     // e.g. 'shape_triangle_up', 'shape_arrow_up'
  location: string;     // 'AboveBar' | 'BelowBar' | 'AbsolutePrice' | 'Top' | 'Bottom'
  color:    string;
  size:     string;     // 'tiny' | 'small' | 'normal' | 'large' | 'huge' | 'auto'
  char?:    string;     // plotchar only
  text?:    string;
}

export interface PineBarOverlayOutput {
  style:     'bar' | 'candle';
  data:      { time: number; open: number; high: number; low: number; close: number; color: string; wickColor?: string }[];
}

export interface PineHlineOutput {
  title:     string;
  value:     number;
  color:     string;
  lineStyle: string;   // 'solid' | 'dashed' | 'dotted'
  lineWidth: number;
}

export interface PineFillOutput {
  plot1:  string;   // key name in ctx.plots for first boundary
  plot2:  string;   // key name in ctx.plots for second boundary
  color:  string;
}

// Drawing object types — field shapes confirmed by Step 0 verification
export interface PineLineObject {
  id:           number;
  x1:           number;  // bar index (xloc=bi) or ms timestamp (xloc=bt)
  y1:           number;  // price
  x2:           number;
  y2:           number;
  xloc:         'bi' | 'bt';
  extend:       string;
  color:        string;
  style:        string;
  width:        number;
  force_overlay: boolean;
  _deleted:     boolean;
}

export interface PineBoxObject {
  id:            number;
  left:          number;  // x (bar index or ms)
  top:           number;  // price
  right:         number;
  bottom:        number;
  xloc:          'bi' | 'bt';
  extend:        string;
  border_color:  string;
  border_style:  string;
  border_width:  number;
  bgcolor:       string;
  text:          string;
  text_color:    string;
  text_size:     string;
  text_halign:   string;
  text_valign:   string;
  force_overlay: boolean;
  _deleted:      boolean;
}

export interface PineLabelObject {
  id:            number;
  x:             number;  // bar index or ms
  y:             number;  // price (when yloc='pr') or 0 for bar-relative
  text:          string;
  xloc:          'bi' | 'bt';
  yloc:          string;  // 'pr' | 'ab' | 'bl'
  color:         string;
  style:         string;
  textcolor:     string;
  size:          string;
  textalign:     string;
  tooltip:       string;
  force_overlay: boolean;
  _deleted:      boolean;
}

export interface PinePolylineObject {
  id:            number;
  // field shape TBD — pinets returns empty array for polyline.new() in step 0
  [key: string]: unknown;
}

export interface PineLinefillObject {
  id:            number;
  line1:         PineLineObject;
  line2:         PineLineObject;
  color:         string;
  force_overlay: boolean;
  _deleted:      boolean;
}

export interface PineTableCell {
  text:            string;
  width:           number;
  height:          number;
  text_color:      string;
  text_halign:     string;
  text_valign:     string;
  text_size:       string;
  bgcolor:         string;
  tooltip:         string;
  text_font_family:string;
  _merged:         boolean;
  _merge_parent:   null | unknown;
}

export interface PineTableObject {
  id:            number;
  position:      string;  // 'top_right' | 'top_left' | 'top_center' | 'bottom_right' | etc.
  columns:       number;
  rows:          number;
  bgcolor:       string;
  frame_color:   string;
  frame_width:   number;
  border_color:  string;
  border_width:  number;
  force_overlay: boolean;
  _deleted:      boolean;
  cells:         PineTableCell[][];  // cells[col][row]
  merges:        unknown[];
}

/**
 * Categorized result from a full Pine run.
 * Backward-compatible: result.series still present for old call sites.
 */
export interface PineRunResult {
  // ── Backward-compat ─────────────────────────────────────────────────────
  /** @deprecated Use lineSeries + histograms instead. Will be removed eventually. */
  series:      PineSeriesOutput[];

  title?:      string;
  error?:      string;
  /** True when the script declares indicator(..., overlay=true). */
  overlay:     boolean;

  // ── Categorized outputs ──────────────────────────────────────────────────
  lineSeries:    PineSeriesOutput[];       // style_line / style_stepline / style_area / style_circles
  histograms:    PineSeriesOutput[];       // style_histogram / style_columns
  markers:       PineMarkerOutput[];       // plotshape / plotchar / plotarrow
  barOverlays:   PineBarOverlayOutput[];   // plotbar / plotcandle
  hlines:        PineHlineOutput[];        // hline()
  fills:         PineFillOutput[];         // fill()
  lines:         PineLineObject[];         // line.new()
  boxes:         PineBoxObject[];          // box.new()
  labels:        PineLabelObject[];        // label.new()
  polylines:     PinePolylineObject[];     // polyline.new() (may be empty — pinets limitation)
  linefills:     PineLinefillObject[];     // linefill.new()
  tables:        PineTableObject[];        // table.new()
}

// ─── Source pre-processing ────────────────────────────────────────────────────

const UNSUPPORTED_INDICATOR_PARAMS = [
  /,?\s*scale\s*=\s*scale\.\w+/g,
  /,?\s*timeframe_gaps\s*=\s*\w+/g,
  /,?\s*calc_bars_count\s*=\s*\d+/g,
  /,?\s*dynamic_requests\s*=\s*\w+/g,
  /,?\s*behind_chart\s*=\s*\w+/g,
];

function preprocessSource(source: string): string {
  let s = source;
  for (const re of UNSUPPORTED_INDICATOR_PARAMS) {
    s = s.replace(re, '');
  }
  return s;
}

// ─── Static input parser ─────────────────────────────────────────────────────

function splitArgs(s: string): string[] {
  const result: string[] = [];
  let depth = 0, cur = '', inStr = false, strChar = '';
  for (const ch of s) {
    if (!inStr && (ch === '"' || ch === "'")) { inStr = true; strChar = ch; cur += ch; continue; }
    if (inStr && ch === strChar) { inStr = false; cur += ch; continue; }
    if (!inStr && '([{'.includes(ch)) depth++;
    else if (!inStr && ')]}'.includes(ch)) depth--;
    if (!inStr && ch === ',' && depth === 0) { result.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) result.push(cur);
  return result;
}

function findNamed(args: string[], name: string): string | null {
  const a = args.find(a => a.trim().startsWith(name + '='));
  return a ? a.trim().slice(name.length + 1).trim() : null;
}

function findNamedArray(raw: string, name: string): string[] | null {
  const m = raw.match(new RegExp(name + '\\s*=\\s*\\[([^\\]]+)\\]'));
  if (!m) return null;
  return m[1].split(',').map(s => s.trim().replace(/^[\"']|[\"']$/g, ''));
}

function parseDefaultValue(def: string, type: PineInputType): unknown {
  if (!def) return null;
  def = def.trim();
  if (type === 'bool')  return def === 'true';
  if (type === 'int')   return parseInt(def);
  if (type === 'float') return parseFloat(def);
  if (type === 'color') return def.replace(/^color\./, '#').toLowerCase();
  return def.replace(/^[\"']|[\"']$/g, '');
}

export function parsePineInputs(source: string): PineInputDef[] {
  const inputs: PineInputDef[] = [];
  const re = /(\w+)\s*=\s*input\.(int|float|bool|string|color|source|timeframe)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const [, varName, type, argsRaw] = m;
    const args = splitArgs(argsRaw);
    const def = args[0]?.trim() || '';
    const titleNamed = findNamed(args, 'title');
    const titlePos = args[1]?.trim().match(/^[\"'](.+)[\"']$/)?.[1];
    const title = titleNamed?.replace(/^[\"']|[\"']$/g, '') ?? titlePos ?? varName;
    const minvalStr = findNamed(args, 'minval');
    const maxvalStr = findNamed(args, 'maxval');
    const stepStr   = findNamed(args, 'step');
    const options   = findNamedArray(argsRaw, 'options');
    inputs.push({
      varName,
      title,
      type: type as PineInputType,
      default: parseDefaultValue(def, type as PineInputType),
      minval:  minvalStr ? parseFloat(minvalStr) : null,
      maxval:  maxvalStr ? parseFloat(maxvalStr) : null,
      step:    stepStr   ? parseFloat(stepStr)   : null,
      options,
    });
  }
  return inputs;
}

export function parsePineTitle(source: string): string {
  const m = source.match(/indicator\s*\(\s*[\"']([^\"']+)[\"']/);
  return m?.[1] ?? 'Untitled Indicator';
}

// ─── Categorized plot extractor ───────────────────────────────────────────────

/** Keys that hold drawing-object arrays — extracted differently from numeric series. */
const DRAWING_OBJECT_KEYS = new Set([
  '__lines__', '__boxes__', '__labels__', '__polylines__', '__linefills__', '__tables__',
]);

/**
 * Styles that map to plain numeric line series (LineSeries or HistogramSeries).
 * Everything else is a marker, bar overlay, hline, fill, or drawing object.
 */
const LINE_STYLES   = new Set(['style_line', 'style_stepline', 'style_area', 'style_circles']);
const HISTO_STYLES  = new Set(['style_histogram', 'style_columns']);
const MARKER_STYLES = new Set(['shape', 'char']);
const BAR_STYLES    = new Set(['bar', 'candle']);

/**
 * Unwrap the drawing-object array from a special collection entry.
 * pinets wraps these as: { data: [{ time, value: <array of objects> }], options: {style} }
 * We want the objects inside data[0].value, filtered for non-deleted entries.
 */
function unwrapDrawingObjects(entry: any): any[] {
  if (!entry?.data?.length) return [];
  const arr = entry.data[0]?.value;
  if (!Array.isArray(arr)) return [];
  return arr.filter((obj: any) => obj && !obj._deleted);
}

/**
 * Walk ctx.plots once and bucket every entry by options.style into PineRunResult.
 * Replaces the old extractSeries() with a fully categorized result.
 */
function extractAll(ctx: any): PineRunResult {
  const plots = ctx.plots ?? {};

  const lineSeries:  PineSeriesOutput[]     = [];
  const histograms:  PineSeriesOutput[]     = [];
  const markers:     PineMarkerOutput[]     = [];
  const barOverlays: PineBarOverlayOutput[] = [];
  const hlines:      PineHlineOutput[]      = [];
  const fills:       PineFillOutput[]       = [];

  for (const [key, plot] of Object.entries(plots) as [string, any][]) {
    if (DRAWING_OBJECT_KEYS.has(key)) continue;
    if (!plot?.data || !Array.isArray(plot.data)) continue;

    // pinets only sets options.style when the Pine script passes an EXPLICIT
    // style= argument (e.g. plot(x, style=plot.style_histogram)). A plain
    // plot(x) call — far and away the most common form, and exactly what a
    // bare RSI/MA script uses — omits the key entirely even though Pine's
    // own default for plot() is style_line. Previously this whole entry was
    // skipped, silently dropping every plain-plot indicator's output (most
    // visibly on overlay=false/pane indicators, since those tend to plot a
    // single unstyled series and end up with nothing at all — no series, no
    // scale). Default to style_line so plain plot() calls render like Pine
    // actually specifies. hline()/fill()/plotshape()/plotchar()/plotbar()/
    // plotcandle() all set options.style explicitly, so they're unaffected.
    const style = (plot?.options?.style as string | undefined) ?? 'style_line';

    // ── hline ───────────────────────────────────────────────────────────────
    if (style === 'hline') {
      const level = plot.data?.[0]?.value;
      if (level != null && Number.isFinite(Number(level))) {
        hlines.push({
          title:     plot.title ?? key,
          value:     Number(level),
          color:     plot.options.color ?? '#888',
          lineStyle: plot.options.linestyle ?? 'solid',
          lineWidth: plot.options.linewidth ?? 1,
        });
      }
      continue;
    }

    // ── fill ────────────────────────────────────────────────────────────────
    if (style === 'fill') {
      fills.push({
        plot1: plot.options.plot1 ?? '',
        plot2: plot.options.plot2 ?? '',
        color: plot.options.color ?? 'rgba(0,0,0,0)',
      });
      continue;
    }

    // ── markers: plotshape / plotchar (plotarrow also style='shape') ─────────
    if (MARKER_STYLES.has(style)) {
      const isChar = style === 'char';
      for (const pt of (plot.data ?? []) as any[]) {
        // value is true/false for shape/char; numeric for arrow (sign → direction)
        const active = pt?.value === true || (typeof pt?.value === 'number' && pt.value !== 0);
        if (!active) continue;
        const opts = pt.options ?? {};
        const globalOpts = plot.options ?? {};
        const isArrow    = opts.shape === 'shape_arrow_up' || opts.shape === 'shape_arrow_down';
        markers.push({
          time:     pt.time as number,
          shape:    opts.shape ?? globalOpts.shape ?? (isChar ? 'text' : 'shape_triangle_up'),
          location: opts.location ?? globalOpts.location ?? 'AboveBar',
          color:    opts.color ?? globalOpts.color ?? '#2962ff',
          size:     opts.size  ?? globalOpts.size  ?? 'normal',
          char:     isChar ? (globalOpts.char ?? '●') : undefined,
          text:     opts.text ?? undefined,
        });
        void isArrow; // consumed above via opts.shape
      }
      continue;
    }

    // ── bar / candle overlays ─────────────────────────────────────────────────
    if (BAR_STYLES.has(style)) {
      const isCandle = style === 'candle';
      const ohlcData: PineBarOverlayOutput['data'] = [];
      for (const pt of (plot.data ?? []) as any[]) {
        if (!Array.isArray(pt?.value) || pt.value.length < 4) continue;
        const [o, h, l, c] = pt.value;
        // Filter out warm-up bars where ATR/indicators haven't converged yet
        if (o == null || h == null || l == null || c == null) continue;
        if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
        ohlcData.push({
          time:      pt.time as number,
          open:      o, high: h, low: l, close: c,
          color:     pt.options?.color ?? plot.options?.color ?? '#888',
          wickColor: isCandle ? (pt.options?.wickcolor ?? plot.options?.wickcolor) : undefined,
        });
      }
      if (ohlcData.length) {
        barOverlays.push({ style: isCandle ? 'candle' : 'bar', data: ohlcData });
      }
      continue;
    }

    // ── line / histogram series ───────────────────────────────────────────────
    if (!plot?.data || !Array.isArray(plot.data)) continue;
    const data = (plot.data as any[])
      .filter(pt => pt?.value != null && !isNaN(Number(pt.value)) && typeof pt.value === 'number')
      .map(pt => ({ time: pt.time as number, value: Number(pt.value) }));
    if (!data.length) continue;

    const color     = plot.data[0]?.options?.color ?? plot.options?.color ?? '#2962ff';
    const lineWidth = plot.options?.lineWidth ?? 1;
    const out: PineSeriesOutput = { name: plot.title ?? key, color, lineWidth, style, data };

    if (HISTO_STYLES.has(style)) {
      histograms.push(out);
    } else {
      // style_line, style_stepline, style_area, style_circles — all → LineSeries
      lineSeries.push(out);
    }
  }

  // ── Drawing object collections ───────────────────────────────────────────
  const lines:     PineLineObject[]     = unwrapDrawingObjects(plots.__lines__);
  const boxes:     PineBoxObject[]      = unwrapDrawingObjects(plots.__boxes__);
  const labels:    PineLabelObject[]    = unwrapDrawingObjects(plots.__labels__);
  const polylines: PinePolylineObject[] = unwrapDrawingObjects(plots.__polylines__);
  const linefills: PineLinefillObject[] = unwrapDrawingObjects(plots.__linefills__);
  const tables:    PineTableObject[]    = unwrapDrawingObjects(plots.__tables__);

  // backward-compat: series = lineSeries + histograms (same as old extractSeries())
  const series = [...lineSeries, ...histograms];

  return {
    series,
    overlay:   !!(ctx?.indicator?.overlay ?? true),
    lineSeries, histograms, markers, barOverlays,
    hlines, fills,
    lines, boxes, labels, polylines, linefills, tables,
  };
}

// ─── syminfo / tickerId / timeframe support ───────────────────────────────────
//
// pinets only populates ctx.pine.syminfo when the `source` passed to `new
// PineTS(source, …)` is a market-data Provider (an object with a
// getSymbolInfo() method) — plain candle arrays (what we've always passed)
// leave it `undefined` forever. Any script that reads `syminfo.*` directly,
// or calls request.security()/request.security_lower_tf() (which read
// syminfo/timeframe internally even for same-symbol requests), then crashes
// with a raw TypeError reading a property off `undefined`.
//
// request.security() is especially easy to hit by accident: even a
// same-timeframe call spins up a *new* secondary PineTS instance internally
// (reusing whatever `source` we originally passed), so patching just the
// primary instance's private field after construction isn't enough — the
// secondary instance would still be missing it.
//
// The fix: wrap our candle array in a tiny Provider so every PineTS instance
// spawned from it (primary or the secondary ones request.security() creates)
// resolves a real (if synthetic) syminfo object via getSymbolInfo(), and gets
// its candles via getMarketData(). We don't have a live multi-symbol/
// multi-timeframe feed, so getMarketData() just returns our one candle
// series regardless of what ticker/timeframe was requested — request.security()
// calls for a *different* symbol or timeframe than the chart's own won't
// return genuinely resampled/foreign data, but the script runs and renders
// instead of throwing. That's a documented limitation, not a crash.

interface PineSymInfo {
  ticker: string; tickerid: string; prefix: string; root: string;
  description: string; type: string; main_tickerid: string;
  current_contract: string; isin: string; basecurrency: string;
  currency: string; timezone: string; country: string; session: string;
  mintick: number; pointvalue: number;
  // Remaining ISymbolInfo fields — not meaningful without a real data
  // provider, filled with neutral defaults so nothing reads `undefined`.
  employees: number; industry: string; sector: string; shareholders: number;
  shares_outstanding_float: number; shares_outstanding_total: number;
  expiration_date: number; volumetype: string; mincontract: number;
  minmove: number; pricescale: number;
  recommendations_buy: number; recommendations_buy_strong: number;
  recommendations_date: number; recommendations_hold: number;
  recommendations_sell: number; recommendations_sell_strong: number;
  recommendations_total: number;
  target_price_average: number; target_price_date: number;
  target_price_estimates: number; target_price_high: number;
  target_price_low: number; target_price_median: number;
}

function buildDefaultSyminfo(symbol: string, prefix = 'BINANCE'): PineSymInfo {
  const clean = symbol || 'UNKNOWN';
  const base  = clean.replace(/(USDT|BUSD|USDC|USD)$/, '') || clean;
  const quote = clean.slice(base.length) || 'USDT';
  return {
    ticker: clean,
    tickerid: `${prefix}:${clean}`,
    prefix,
    root: clean,
    description: clean,
    type: 'crypto',
    main_tickerid: `${prefix}:${clean}`,
    current_contract: '',
    isin: '',
    basecurrency: base,
    currency: quote,
    timezone: 'Etc/UTC',
    country: '',
    session: '24x7',
    mintick: 0.01,
    pointvalue: 1,
    employees: 0, industry: '', sector: '', shareholders: 0,
    shares_outstanding_float: 0, shares_outstanding_total: 0,
    expiration_date: 0, volumetype: 'base', mincontract: 0,
    minmove: 1, pricescale: 100,
    recommendations_buy: 0, recommendations_buy_strong: 0,
    recommendations_date: 0, recommendations_hold: 0,
    recommendations_sell: 0, recommendations_sell_strong: 0,
    recommendations_total: 0,
    target_price_average: 0, target_price_date: 0,
    target_price_estimates: 0, target_price_high: 0,
    target_price_low: 0, target_price_median: 0,
  };
}

function providerConfigure(_config: any): void { /* no-op — no live provider to configure */ }

/** Maps our app's interval strings ("1m","4h","1d",…) to Pine's timeframe format ("1","240","D"). */
function toPineTimeframe(interval?: string): string {
  if (!interval) return '1';
  const trimmed = interval.trim();
  const m = /^(\d+)\s*([smhdwM])$/.exec(trimmed);
  if (!m) return trimmed; // assume it's already Pine-format (e.g. "60", "D")
  const value = parseInt(m[1], 10);
  switch (m[2]) {
    case 's': return `${value}S`;
    case 'm': return `${value}`;
    case 'h': return `${value * 60}`;
    case 'd': return value === 1 ? 'D' : `${value}D`;
    case 'w': return value === 1 ? 'W' : `${value}W`;
    case 'M': return value === 1 ? 'M' : `${value}M`;
    default:  return '1';
  }
}

/** Minimal market-data Provider so pinets resolves a real syminfo instead of leaving it undefined. */
class StaticCandleProvider {
  constructor(private _candles: any[], private _syminfo: PineSymInfo) {}
  async getMarketData(_tickerId?: string, _timeframe?: string, _limit?: number, _sDate?: number, _eDate?: number) {
    return this._candles;
  }
  async getSymbolInfo(_tickerId?: string) {
    return this._syminfo;
  }
  configure(config: any): void {
    providerConfigure(config);
  }
}


export interface PineSymbolInfo {
  symbol?:   string;
  interval?: string;
}

// ─── Runtime class ────────────────────────────────────────────────────────────

type OHLCVCandle = {
  time: number; open: number; high: number; low: number; close: number; volume?: number;
};

export class PineTSRuntime {
  private _pine: any = null;
  private _pineCandles: any[] = [];
  private _symbol: string = '';
  private _timeframe: string = '1';

  constructor(candles: OHLCVCandle[], symbolInfo?: PineSymbolInfo) {
    this._applySymbolInfo(symbolInfo);
    this._update(candles);
  }

  private _applySymbolInfo(symbolInfo?: PineSymbolInfo) {
    if (symbolInfo?.symbol)   this._symbol    = symbolInfo.symbol;
    if (symbolInfo?.interval) this._timeframe = toPineTimeframe(symbolInfo.interval);
  }

  private _toPineCandles(candles: OHLCVCandle[]) {
    return candles.map(c => ({
      openTime:  c.time,
      closeTime: c.time + 59,
      open:   c.open,
      high:   c.high,
      low:    c.low,
      close:  c.close,
      volume: c.volume ?? 0,
    }));
  }

  private _update(candles: OHLCVCandle[]) {
    this._pineCandles = this._toPineCandles(candles);
    const tickerId = `BINANCE:${this._symbol || 'UNKNOWN'}`;
    const syminfo  = buildDefaultSyminfo(this._symbol, 'BINANCE');
    const provider = new StaticCandleProvider(this._pineCandles, syminfo);
    this._pine = new PineTS(provider as any, tickerId, this._timeframe);
  }

  updateCandles(candles: OHLCVCandle[], symbolInfo?: PineSymbolInfo) {
    this._applySymbolInfo(symbolInfo);
    this._update(candles);
  }

  async run(source: string, inputs: Record<string, unknown> = {}): Promise<PineRunResult> {
    const processed = preprocessSource(source);
    try {
      const indicator = new Indicator(processed, inputs);
      const ctx = await this._pine.run(indicator);
      const result  = extractAll(ctx);
      const title   = ctx.indicator?.title ?? parsePineTitle(source);
      return { ...result, title };
    } catch (err: any) {
      console.error('[PineTSRuntime] error:', err);
      return {
        series: [], lineSeries: [], histograms: [], markers: [], barOverlays: [],
        hlines: [], fills: [], lines: [], boxes: [], labels: [], polylines: [],
        linefills: [], tables: [],
        overlay: true,
        error: String(err?.message ?? err),
      };
    }
  }

  parseInputs(source: string): PineInputDef[] {
    return parsePineInputs(source);
  }

  parseTitle(source: string): string {
    return parsePineTitle(source);
  }
}
