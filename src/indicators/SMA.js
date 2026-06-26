/**
 * SMA — Simple Moving Average (incremental).
 *
 * update() maintains a sliding window of the last `period` closes and
 * computes the average in O(1) using a running sum.
 * The chart plugin (SMAIndicator in IIndicator.js) handles the series.
 */
import { LineSeries } from 'lightweight-charts';
import { IndicatorPlugin } from './IIndicator';
import { Indicator } from './base/Indicator';

// ─── Pure computation class (no chart dependency) ──────────────────────────

export class SMA extends Indicator {
  /** @param {number} [period=20] */
  constructor(period = 20) {
    super(`sma_${period}`, `SMA ${period}`);
    this.period = period;
    /** @type {number[]} rolling window of closes */
    this._window = [];
    /** @type {number} running sum */
    this._sum = 0;
  }

  /**
   * @param {import('../feeds/IDataFeed').Candle[]} history
   */
  init(history) {
    this.reset();
    for (const candle of history) {
      this.update(candle);
    }
  }

  /**
   * @param {import('../feeds/IDataFeed').Candle} candle
   * @returns {{ time: number, value: number } | null}
   */
  update(candle) {
    this._window.push(candle.close);
    this._sum += candle.close;

    if (this._window.length > this.period) {
      this._sum -= this._window.shift();
    }

    if (this._window.length < this.period) return null;

    const point = { time: candle.time, value: this._sum / this.period };
    this.series.push(point);
    return point;
  }

  reset() {
    super.reset();
    this._window = [];
    this._sum = 0;
  }
}

// ─── Chart plugin (wraps SMA, manages Lightweight Charts series) ────────────

export class SMAIndicator extends IndicatorPlugin {
  constructor(period = 20) {
    super('sma', `SMA ${period}`, { period });
    this._sma = new SMA(period);
    this._indicator = this._sma; // enables updateIncremental()
  }

  compute(data, { period }) {
    const sma = new SMA(period);
    sma.init(data);
    return sma.series;
  }

  createSeries(chart) {
    return chart.addSeries(LineSeries, {
      color: '#2962FF',
      lineWidth: 2,
      title: this.name,
      priceLineVisible: false,
      lastValueVisible: false,
    });
  }
}
