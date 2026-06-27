// src/indicators/registry.js
/**
 * IndicatorRegistry — manages active indicator plugins per chart instance.
 * Each ChartComponent instance owns one registry.
 */
import { SMAIndicator } from './SMA';
import { EMAIndicator } from './EMA';

export const INDICATOR_CONSTRUCTORS = {
  sma: (params) => new SMAIndicator(params?.period ?? 20),
  ema: (params) => new EMAIndicator(params?.period ?? 20),
};

export class IndicatorRegistry {
  constructor() {
    /** @type {Map<string, import('./IIndicator').IndicatorPlugin>} */
    this._plugins = new Map();
  }

  attach(id, data, chart) {
    const plugin = this._plugins.get(id);
    if (plugin) plugin.attach(data, chart);
  }

  detach(id, chart) {
    const plugin = this._plugins.get(id);
    if (plugin) plugin.detach(chart);
    this._plugins.delete(id);
  }

  add(id, constructorFn, data, chart) {
    if (this._plugins.has(id)) return;
    const plugin = constructorFn();
    plugin.attach(data, chart);
    this._plugins.set(id, plugin);
  }

  remove(id, chart) {
    this.detach(id, chart);
  }

  updateIncremental(candle, chart) {
    for (const plugin of this._plugins.values()) {
      plugin.updateIncremental(candle, chart);
    }
  }

  reattachAll(data, chart) {
    for (const [, plugin] of this._plugins) {
      plugin.attach(data, chart);
    }
  }

  clear(chart) {
    for (const [id] of this._plugins) {
      this.detach(id, chart);
    }
  }
}
