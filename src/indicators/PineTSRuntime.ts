/**
 * PineTSRuntime — wraps pinets to run Pine Script indicators
 * against the chart's candle data and returns plot series values.
 *
 * Usage:
 *   const rt = new PineTSRuntime(candles, symbol, interval);
 *   const plots = await rt.run(source);
 *   // plots: Record<name, number[]>  aligned 1:1 with candles
 */
import { PineTS, Indicator } from 'pinets';
import type { Context } from 'pinets';

export interface PineSeriesOutput {
  name: string;
  color: string;
  data: (number | null)[];  // one value per candle, null = na
}

export interface PineRunResult {
  series: PineSeriesOutput[];
  error?: string;
}

/** Convert our OHLCV candle array to the format pinets accepts as raw data */
function candlesToPineData(candles: {time:number;open:number;high:number;low:number;close:number;volume?:number}[]) {
  return candles.map(c => ({
    openTime:  c.time,
    closeTime: c.time + 59,
    open:  c.open,
    high:  c.high,
    low:   c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
}

/** Extract plot series from a pinets Context result */
function extractPlots(context: Context, candleCount: number): PineSeriesOutput[] {
  const plots = context.plots ?? {};
  return Object.entries(plots).map(([name, series]: [string, any]) => {
    const data = series?.data ?? series ?? [];
    // Pad front with nulls if shorter than candle array
    const padded: (number|null)[] = Array(Math.max(0, candleCount - data.length)).fill(null);
    for (const v of data) {
      padded.push(v == null || isNaN(v) ? null : Number(v));
    }
    return {
      name,
      color: series?.color ?? '#2962ff',
      data: padded.slice(-candleCount),
    };
  });
}

export class PineTSRuntime {
  private _candles: any[];
  private _pineData: any[];

  constructor(candles: {time:number;open:number;high:number;low:number;close:number;volume?:number}[]) {
    this._candles = candles;
    this._pineData = candlesToPineData(candles);
  }

  updateCandles(candles: {time:number;open:number;high:number;low:number;close:number;volume?:number}[]) {
    this._candles = candles;
    this._pineData = candlesToPineData(candles);
  }

  async run(source: string, inputs?: Record<string, unknown>): Promise<PineRunResult> {
    try {
      const pine = new PineTS(this._pineData);
      const indicator = new Indicator(source, inputs ?? {});
      const context: Context = await pine.run(indicator);
      const series = extractPlots(context, this._candles.length);
      return { series };
    } catch (err: any) {
      return { series: [], error: String(err?.message ?? err) };
    }
  }
}
