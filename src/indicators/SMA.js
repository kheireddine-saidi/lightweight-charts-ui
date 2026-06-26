import { LineSeries } from 'lightweight-charts';
import { IndicatorPlugin } from './IIndicator';
export class SMAIndicator extends IndicatorPlugin {
  constructor(period = 20) { super('sma', `SMA ${period}`, { period }); }
  compute(data, { period }) { const result = []; for (let i = period - 1; i < data.length; i++) { const sum = data.slice(i - period + 1, i + 1).reduce((a, d) => a + d.close, 0); result.push({ time: data[i].time, value: sum / period }); } return result; }
  createSeries(chart) { return chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 2, title: this.name, priceLineVisible: false, lastValueVisible: false }); }
}
