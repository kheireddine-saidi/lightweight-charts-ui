/**
 * SeriesManager — owns the main chart series lifecycle for one chart instance.
 *
 * Extracted from ChartComponent in Phase 5.
 *
 * Responsibilities:
 *  - createSeries(chart, type, title)  — returns a new LWC series of the right type
 *  - transformData(data, type)         — converts raw OHLC to the format each series expects
 *  - reattachPrimitives(series, ...)   — re-attaches LineToolManager, trade markers, timer
 *    after the series is replaced (chart-type switch)
 *
 * Does NOT own React state, EventBus subscriptions, or chart creation.
 * Call sites in ChartComponent remain unchanged except they delegate here.
 */

import {
  CandlestickSeries,
  BarSeries,
  LineSeries,
  AreaSeries,
  BaselineSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import { calculateHeikinAshi } from '../../utils/chartUtils';

// ─── Series colours ────────────────────────────────────────────────────────
const UP   = '#089981';
const DOWN = '#F23645';
const BLUE = '#2962FF';

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Transform raw OHLC candle data into the format required by the given series type.
 *
 * @param {object[]} data  raw candles [{time,open,high,low,close}]
 * @param {string}   type  chart type key (e.g. 'candlestick', 'line', 'heikin-ashi')
 * @returns {object[]}
 */
export function transformData(data, type) {
  if (!data || data.length === 0) return [];
  switch (type) {
    case 'line':
    case 'area':
    case 'baseline':
      return data.map(d => ({ time: d.time, value: d.close }));
    case 'heikin-ashi':
      return calculateHeikinAshi(data);
    default:
      return data;
  }
}

/**
 * Create a new LWC series of the given type on the supplied chart instance.
 *
 * @param {object} chart  LWC chart API
 * @param {string} type   chart type key
 * @param {string} [title='']
 * @param {{ bullColor?: string, bearColor?: string }} [colors]  optional color overrides
 * @returns {object}  LWC series API
 */
export function createSeries(chart, type, title = '', colors = {}) {
  const up   = colors.bullColor ?? UP;
  const down = colors.bearColor ?? DOWN;
  const common = { lastValueVisible: true, priceScaleId: 'right', title };

  switch (type) {
    case 'bar':
      return chart.addSeries(BarSeries, { ...common, upColor: up, downColor: down, thinBars: false });

    case 'hollow-candlestick':
      return chart.addSeries(CandlestickSeries, {
        ...common,
        upColor: 'transparent', downColor: down,
        borderUpColor: up, borderDownColor: down,
        wickUpColor: up, wickDownColor: down,
      });

    case 'line':
      return chart.addSeries(LineSeries, { ...common, color: BLUE, lineWidth: 2 });

    case 'area':
      return chart.addSeries(AreaSeries, {
        ...common,
        topColor: 'rgba(41,98,255,0.4)', bottomColor: 'rgba(41,98,255,0)',
        lineColor: BLUE, lineWidth: 2,
      });

    case 'baseline':
      return chart.addSeries(BaselineSeries, {
        ...common,
        topLineColor: up,
        topFillColor1: hexToRgba(up, 0.28), topFillColor2: hexToRgba(up, 0.05),
        bottomLineColor: down,
        bottomFillColor1: hexToRgba(down, 0.05), bottomFillColor2: hexToRgba(down, 0.28),
      });

    case 'candlestick':
    case 'heikin-ashi':
    default:
      return chart.addSeries(CandlestickSeries, {
        ...common,
        upColor: up, downColor: down,
        borderVisible: false,
        wickUpColor: up, wickDownColor: down,
      });
  }
}

/**
 * Helper: convert a CSS hex color string to rgba(r,g,b,alpha).
 * Falls back to the original string if parsing fails.
 * @param {string} hex  e.g. '#089981'
 * @param {number} alpha  0–1
 */
function hexToRgba(hex, alpha) {
  try {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  } catch {
    return hex;
  }
}

/**
 * Re-attach a trade marker primitive to a replacement series after a chart-type
 * switch, preserving the existing marker list.
 *
 * Returns the new primitive (or null if the list is empty).
 *
 * @param {object}   series          new LWC series API
 * @param {object[]} markerList      array of {id,time,price,text,color,shape,position}
 * @returns {object|null}  new SeriesMarkers primitive
 */
export function reattachTradeMarkers(series, markerList) {
  if (!markerList || markerList.length === 0) return null;
  try {
    const sorted = [...markerList].sort((a, b) => a.time - b.time);
    return createSeriesMarkers(
      series,
      sorted.map(m => ({
        time: m.time, position: m.position, shape: m.shape,
        color: m.color, text: m.text, size: 1,
      })),
    );
  } catch (e) {
    console.warn('[SeriesManager] Failed to re-attach trade markers:', e);
    return null;
  }
}

/**
 * Re-attach the PriceScaleTimer primitive to a replacement series.
 * Safe to call even if no timer exists.
 *
 * @param {object}      series   new LWC series API
 * @param {object|null} timer    PriceScaleTimer instance (or null)
 */
export function reattachTimer(series, timer) {
  if (!timer) return;
  try {
    series.attachPrimitive(timer);
  } catch (e) {
    console.warn('[SeriesManager] Failed to re-attach timer:', e);
  }
}

/**
 * Apply bull/bear color settings to an existing series without recreating it.
 * Handles candlestick, bar, hollow-candlestick, and baseline types.
 *
 * @param {object} series    LWC series API
 * @param {string} type      chart type key
 * @param {{ bullColor: string, bearColor: string }} colors
 */
export function applySeriesColors(series, type, colors) {
  if (!series) return;
  const up   = colors.bullColor ?? UP;
  const down = colors.bearColor ?? DOWN;

  try {
    switch (type) {
      case 'bar':
        series.applyOptions({ upColor: up, downColor: down });
        break;
      case 'hollow-candlestick':
        series.applyOptions({
          upColor: 'transparent', downColor: down,
          borderUpColor: up, borderDownColor: down,
          wickUpColor: up, wickDownColor: down,
        });
        break;
      case 'baseline':
        series.applyOptions({
          topLineColor: up,
          topFillColor1: hexToRgba(up, 0.28), topFillColor2: hexToRgba(up, 0.05),
          bottomLineColor: down,
          bottomFillColor1: hexToRgba(down, 0.05), bottomFillColor2: hexToRgba(down, 0.28),
        });
        break;
      case 'candlestick':
      case 'heikin-ashi':
      default:
        series.applyOptions({
          upColor: up, downColor: down,
          wickUpColor: up, wickDownColor: down,
        });
        break;
    }
  } catch (e) {
    console.warn('[SeriesManager] applySeriesColors failed:', e);
  }
}
