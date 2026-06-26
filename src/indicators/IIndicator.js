export class IndicatorPlugin {
  constructor(id, name, defaultParams = {}) { this.id = id; this.name = name; this.params = { ...defaultParams }; this._series = null; }
  attach(data, chart) { if (!this._series) { this._series = this.createSeries(chart); } const points = this.compute(data, this.params); this._series.setData(points); }
  update(data, chart) { if (!this._series) { this.attach(data, chart); return; } const points = this.compute(data, this.params); if (points.length > 0) { this._series.update(points[points.length - 1]); } }
  detach(chart) { if (this._series) { try { chart.removeSeries(this._series); } catch {} this._series = null; } }
  compute(_data, _params) { return []; }
  createSeries(_chart) { throw new Error('Not implemented'); }
}
