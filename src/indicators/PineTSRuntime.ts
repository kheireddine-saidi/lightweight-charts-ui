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
  data:      { time: number; value: number }[];
}

export interface PineRunResult {
  series:   PineSeriesOutput[];
  title?:   string;
  error?:   string;
}

// ─── Source pre-processing ────────────────────────────────────────────────────

/**
 * Strip parameters that pinets doesn't support from indicator() calls.
 * Currently: scale=scale.*, timeframe_gaps, calc_bars_count, dynamic_requests
 */
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
  return m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
}

function parseDefaultValue(def: string, type: PineInputType): unknown {
  if (!def) return null;
  def = def.trim();
  if (type === 'bool')  return def === 'true';
  if (type === 'int')   return parseInt(def);
  if (type === 'float') return parseFloat(def);
  // color: strip color.* prefix for display
  if (type === 'color') return def.replace(/^color\./, '#').toLowerCase();
  return def.replace(/^["']|["']$/g, '');
}

/**
 * Parse input declarations from Pine Script source code.
 * Returns inputs in declaration order with full metadata.
 */
export function parsePineInputs(source: string): PineInputDef[] {
  const inputs: PineInputDef[] = [];
  const re = /(\w+)\s*=\s*input\.(int|float|bool|string|color|source|timeframe)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const [, varName, type, argsRaw] = m;
    const args = splitArgs(argsRaw);
    const def = args[0]?.trim() || '';

    // Title: second positional string arg, or title= named
    const titleNamed = findNamed(args, 'title');
    const titlePos = args[1]?.trim().match(/^["'](.+)["']$/)?.[1];
    const title = titleNamed?.replace(/^["']|["']$/g, '') ?? titlePos ?? varName;

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

/**
 * Extract indicator title from source code.
 * Reads indicator("Title", ...) declaration.
 */
export function parsePineTitle(source: string): string {
  const m = source.match(/indicator\s*\(\s*["']([^"']+)["']/);
  return m?.[1] ?? 'Untitled Indicator';
}

// ─── Plot extraction ──────────────────────────────────────────────────────────

const SKIP_KEYS = new Set([
  '__labels__', '__lines__', '__boxes__', '__linefills__', '__polylines__', '__tables__'
]);

function extractSeries(ctx: any): PineSeriesOutput[] {
  const plots = ctx.plots ?? {};
  const out: PineSeriesOutput[] = [];
  for (const [key, plot] of Object.entries(plots) as [string, any][]) {
    if (SKIP_KEYS.has(key)) continue;
    if (!plot?.data || !Array.isArray(plot.data)) continue;
    const data = plot.data
      .filter((pt: any) => pt?.value != null && !isNaN(pt.value))
      .map((pt: any) => ({ time: pt.time as number, value: Number(pt.value) }));
    const color = plot.data[0]?.options?.color ?? plot.options?.color ?? '#2962ff';
    out.push({ name: plot.title ?? key, color, lineWidth: plot.options?.lineWidth ?? 1, data });
  }
  return out;
}

// ─── Runtime class ────────────────────────────────────────────────────────────

type OHLCVCandle = {
  time: number; open: number; high: number; low: number; close: number; volume?: number;
};

export class PineTSRuntime {
  private _pine: any = null;
  private _pineCandles: any[] = [];

  constructor(candles: OHLCVCandle[]) {
    this._update(candles);
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
    // Reuse PineTS instance — creating one per run causes MaxListeners leak
    this._pine = new PineTS(this._pineCandles);
  }

  updateCandles(candles: OHLCVCandle[]) {
    this._update(candles);
  }

  /**
   * Run the indicator source against current candles.
   * @param source   Pine Script source code
   * @param inputs   Record of { "Input Title": value } — matched by title name
   */
  async run(source: string, inputs: Record<string, unknown> = {}): Promise<PineRunResult> {
    const processed = preprocessSource(source);
    try {
      const indicator = new Indicator(processed, inputs);
      const ctx = await this._pine.run(indicator);
      const series = extractSeries(ctx);
      const title  = ctx.indicator?.title ?? parsePineTitle(source);
      return { series, title };
    } catch (err: any) {
      console.error('[PineTSRuntime] error:', err);
      return { series: [], error: String(err?.message ?? err) };
    }
  }

  /** Parse inputs from source without running — for the params editor UI */
  parseInputs(source: string): PineInputDef[] {
    return parsePineInputs(source);
  }

  /** Extract title from source without running */
  parseTitle(source: string): string {
    return parsePineTitle(source);
  }
}
