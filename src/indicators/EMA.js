import { LineSeries } from 'lightweight-charts';
import { IndicatorPlugin } from './IIndicator';
export class EMAIndicator extends IndicatorPlugin {
  constructor(period = 20) { super('ema', `EMA ${period}`, { period }); this._lastValue = null; }
  compute(data, { period }) { if (data.length < period) return []; const k = 2 / (period + 1); let ema = data.slice(0, period).reduce((s, d) => s + d.close, 0) / period; const result = [{ time: data[period - 1].time, value: ema }]; for (let i = period; i < data.length; i++) { ema = data[i].close * k + ema * (1 - k); result.push({ time: data[i].time, value: ema }); } this._lastValue = ema; return result; }
  createSeries(chart) { return chart.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 2, title: this.name, priceLineVisible: false, lastValueVisible: false }); }
}
