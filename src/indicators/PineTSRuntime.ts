/**
 * PineTSRuntime — executes Pine Script indicators using the pinets library.
 *
 * pinets plot output format (per series):
 *   ctx.plots['SeriesName'] = {
 *     data: [{title, time, value, options:{color}}, ...],  // one per candle
 *     options: {...},
 *     title: 'SeriesName'
 *   }
 *
 * We convert this to LightweightCharts-compatible LineSeries data:
 *   [{time, value}]  with nulls for na values.
 */
import { PineTS, Indicator } from 'pinets';

export interface PineSeriesOutput {
  name: string;
  color: string;
  lineWidth: number;
  data: { time: number; value: number }[];   // sparse — only non-null points
}

export interface PineRunResult {
  series: PineSeriesOutput[];
  error?: string;
}

/** Candle shape accepted by pinets */
interface PineCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function toPineCandles(
  candles: { time: number; open: number; high: number; low: number; close: number; volume?: number }[]
): PineCandle[] {
  return candles.map(c => ({
    openTime:  c.time,
    closeTime: c.time + 59,   // assume 1m bars; pinets uses closeTime for alignment
    open:   c.open,
    high:   c.high,
    low:    c.low,
    close:  c.close,
    volume: c.volume ?? 0,
  }));
}

/** Internal plot key names that aren't user series */
const SKIP_KEYS = new Set(['__labels__','__lines__','__boxes__','__linefills__','__polylines__','__tables__']);

function extractSeries(ctx: any): PineSeriesOutput[] {
  const plots = ctx.plots ?? {};
  const out: PineSeriesOutput[] = [];

  for (const [key, plot] of Object.entries(plots) as [string, any][]) {
    if (SKIP_KEYS.has(key)) continue;
    if (!plot?.data || !Array.isArray(plot.data)) continue;

    // Collect non-null data points
    const data: { time: number; value: number }[] = [];
    for (const pt of plot.data) {
      if (pt?.value != null && !isNaN(pt.value)) {
        data.push({ time: pt.time, value: Number(pt.value) });
      }
    }

    // Color: from first point's options, fallback to plot-level options
    const color =
      plot.data[0]?.options?.color ??
      plot.options?.color ??
      '#2962ff';

    out.push({
      name:      plot.title ?? key,
      color,
      lineWidth: plot.options?.lineWidth ?? 1,
      data,
    });
  }

  return out;
}

export class PineTSRuntime {
  private _pineCandles: PineCandle[] = [];

  constructor(
    candles: { time: number; open: number; high: number; low: number; close: number; volume?: number }[]
  ) {
    this._pineCandles = toPineCandles(candles);
  }

  updateCandles(
    candles: { time: number; open: number; high: number; low: number; close: number; volume?: number }[]
  ) {
    this._pineCandles = toPineCandles(candles);
  }

  async run(source: string, inputs: Record<string, unknown> = {}): Promise<PineRunResult> {
    try {
      const pine = new PineTS(this._pineCandles);
      const indicator = new Indicator(source, inputs);
      const ctx = await pine.run(indicator);
      const series = extractSeries(ctx);
      return { series };
    } catch (err: any) {
      console.error('[PineTSRuntime] error:', err);
      return { series: [], error: String(err?.message ?? err) };
    }
  }
}
