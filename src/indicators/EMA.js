/**
 * EMA — Exponential Moving Average (truly incremental).
 *
 * update() applies the standard EMA recurrence in O(1):
 *   EMA_t = close_t * k + EMA_{t-1} * (1 - k)   where k = 2 / (period + 1)
 *
 * The first `period` candles are used to seed the EMA with a simple average.
 * After that, every update is a single multiply-add — no array scan.
 */
import { LineSeries } from 'lightweight-charts';
import { IndicatorPlugin } from './IIndicator';
import { Indicator } from './base/Indicator';

// ─── Pure computation class ────────────────────────────────────────────────

export class EMA extends Indicator {
  /** @param {number} [period=20] */
  constructor(period = 20) {
    super(`ema_${period}`, `EMA ${period}`);
    this.period = period;
    this._multiplier = 2 / (period + 1);
    /** @type {number | null} */
    this._lastEMA = null;
    /** @type {number[]} seed buffer */
    this._seedBuffer = [];
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
   * Incremental EMA update — O(1).
   * @param {import('../feeds/IDataFeed').Candle} candle
   * @returns {{ time: number, value: number } | null}
   */
  update(candle) {
    if (this._lastEMA === null) {
      // Seeding phase: collect `period` closes for the initial SMA
      this._seedBuffer.push(candle.close);

      if (this._seedBuffer.length < this.period) return null;

      // Seed EMA with SMA of first `period` candles
      this._lastEMA =
        this._seedBuffer.reduce((s, v) => s + v, 0) / this.period;
    } else {
      // Standard EMA recurrence
      this._lastEMA =
        candle.close * this._multiplier +
        this._lastEMA * (1 - this._multiplier);
    }

    const point = { time: candle.time, value: this._lastEMA };
    this.series.push(point);
    return point;
  }

  reset() {
    super.reset();
    this._lastEMA = null;
    this._seedBuffer = [];
  }
}

// ─── Chart plugin ──────────────────────────────────────────────────────────

export class EMAIndicator extends IndicatorPlugin {
  constructor(period = 20) {
    super('ema', `EMA ${period}`, { period });
    this._ema = new EMA(period);
    this._indicator = this._ema; // enables updateIncremental()
  }

  compute(data, { period }) {
    const ema = new EMA(period);
    ema.init(data);
    return ema.series;
  }

  createSeries(chart) {
    return chart.addSeries(LineSeries, {
      color: '#FF6D00',
      lineWidth: 2,
      title: this.name,
      priceLineVisible: false,
      lastValueVisible: false,
    });
  }
}
