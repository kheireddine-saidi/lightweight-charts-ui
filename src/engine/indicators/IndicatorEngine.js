/**
 * IndicatorEngine — unified facade over native built-in indicators and
 * PineTS user-authored indicators.
 *
 * Design goals (audit §A.3):
 *   - Built-ins (SMA, EMA …) keep their O(1) incremental path via
 *     IndicatorPlugin.updateIncremental().
 *   - Pine scripts run PineTSRuntime.run() over the full candle array but
 *     are debounced so multiple ticks in a burst trigger only one re-run.
 *   - The call site (ChartComponent) sees the same API for both kinds.
 *
 * Lifecycle:
 *   const engine = new IndicatorEngine(registry, pineRuntime, chart);
 *   engine.init(data, indicatorsConfig);   // called once after history loads
 *   engine.updateIncremental(candle);      // called on every live / replay tick
 *   engine.reattach(data);                 // called when chart type changes
 *   engine.destroy();                      // cleanup on unmount
 *
 * No React imports. No chart imports beyond what is passed in.
 */

/**
 * Inner wrapper for a single Pine-script indicator.
 * Maintains its own candle cache and debounces full re-runs.
 */
class PineIndicatorWrapper {
  /**
   * @param {object} indicatorDef   - { id, source, params, title, enabled }
   * @param {object} pineRuntime    - PineTSRuntime instance
   * @param {object} chart          - Lightweight Charts IChartApi instance
   * @param {Function} onResult     - callback(id, result) after each run
   * @param {number}  [debounceMs=100]
   */
  constructor(indicatorDef, pineRuntime, chart, onResult, debounceMs = 100) {
    this._def          = indicatorDef;
    this._runtime      = pineRuntime;
    this._chart        = chart;
    this._onResult     = onResult;
    this._data         = [];
    this._debounceMs   = debounceMs;
    this._timer        = null;
    this._lastResult   = null;
  }

  /** Replace the full candle array (used on history load). */
  setData(data) {
    this._data = Array.isArray(data) ? [...data] : [];
  }

  /** Called on each tick. Appends (or updates) the candle, then schedules a re-run. */
  updateIncremental(candle) {
    const last = this._data[this._data.length - 1];
    if (last && last.time === candle.time) {
      // Update the forming candle in-place
      this._data[this._data.length - 1] = { ...candle };
    } else {
      this._data.push({ ...candle });
    }
    this._scheduledRun();
  }

  /** Trigger a full re-run immediately (e.g., when source/params change). */
  async runNow() {
    clearTimeout(this._timer);
    this._timer = null;
    await this._execute();
  }

  _scheduledRun() {
    if (this._timer !== null) return; // already scheduled
    this._timer = setTimeout(async () => {
      this._timer = null;
      await this._execute();
    }, this._debounceMs);
  }

  async _execute() {
    if (!this._data.length) return;
    try {
      // Update runtime with current data before running
      this._runtime.updateCandles(this._data);
      const result = await this._runtime.run(this._def.source, this._def.params);
      this._lastResult = result;
      this._onResult(this._def.id, result);
    } catch (err) {
      console.warn(`[IndicatorEngine] PineTS run failed for "${this._def.id}":`, err);
    }
  }

  getResult() {
    return this._lastResult;
  }

  destroy() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

// ─── IndicatorEngine ─────────────────────────────────────────────────────────

export class IndicatorEngine {
  /**
   * @param {import('../../indicators/registry').IndicatorRegistry} registry
   * @param {object} pineRuntime  - PineTSRuntime instance (may be null until first Pine indicator)
   * @param {object} chart        - Lightweight Charts IChartApi instance
   * @param {object} [options]
   * @param {number} [options.pineDebounceMs=100]  debounce delay for Pine re-runs
   * @param {Function} [options.onPineResult]      callback(id, result, chart) after each Pine run
   */
  constructor(registry, pineRuntime, chart, options = {}) {
    this._registry      = registry;
    this._pineRuntime   = pineRuntime;
    this._chart         = chart;
    this._debounceMs    = options.pineDebounceMs ?? 100;
    this._onPineResult  = options.onPineResult ?? null;

    /** @type {Map<string, PineIndicatorWrapper>} */
    this._pineWrappers  = new Map();

    /** @type {object[]} current candle array */
    this._data          = [];
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Initialise built-in indicators from the config map and run any Pine
   * indicators with the current history.
   *
   * @param {object[]} data             - full candle array
   * @param {Record<string,boolean>} builtinConfig  - { sma: true, ema: false, … }
   * @param {object[]} [pineIndicators] - array of { id, source, params, title, enabled }
   */
  init(data, builtinConfig = {}, pineIndicators = []) {
    this._data = Array.isArray(data) ? data : [];

    // ── 1. Built-in indicators ──────────────────────────────────────────────
    this._syncBuiltins(builtinConfig);

    // ── 2. Pine indicators ──────────────────────────────────────────────────
    this._syncPine(pineIndicators);
  }

  /**
   * Incremental update on a single new candle.
   * Built-ins: O(1) via IndicatorRegistry.updateIncremental.
   * Pine: debounced full re-run via PineIndicatorWrapper.
   *
   * @param {object} candle
   */
  updateIncremental(candle) {
    if (!candle) return;

    // Update our cached data
    const last = this._data[this._data.length - 1];
    if (last && last.time === candle.time) {
      this._data[this._data.length - 1] = { ...candle };
    } else {
      this._data.push({ ...candle });
    }

    // Built-ins — O(1)
    if (this._registry && this._chart) {
      try {
        this._registry.updateIncremental(candle, this._chart);
      } catch (err) {
        console.warn('[IndicatorEngine] built-in updateIncremental error:', err);
      }
    }

    // Pine — debounced
    for (const wrapper of this._pineWrappers.values()) {
      wrapper.updateIncremental(candle);
    }
  }

  /**
   * Re-run all indicators from scratch with new data
   * (called after symbol/interval change or chart type change).
   *
   * @param {object[]} data
   * @param {Record<string,boolean>} builtinConfig
   * @param {object[]} [pineIndicators]
   */
  reattach(data, builtinConfig = {}, pineIndicators = []) {
    this._data = Array.isArray(data) ? data : [];

    if (this._registry && this._chart) {
      this._registry.reattachAll(this._data, this._chart);
    }

    for (const wrapper of this._pineWrappers.values()) {
      wrapper.setData(this._data);
      wrapper.runNow().catch(() => {});
    }

    this._syncBuiltins(builtinConfig);
  }

  /**
   * Sync built-in indicators to a new config (add/remove as needed).
   * Mirrored from the inline logic in ChartComponent.updateIndicators.
   *
   * @param {Record<string,boolean>} config
   * @param {import('../../indicators/registry').INDICATOR_CONSTRUCTORS} [constructors]
   */
  updateBuiltins(config, constructors) {
    if (!this._registry || !this._chart) return;
    const registry = this._registry;
    const chart    = this._chart;

    for (const [key, enabled] of Object.entries(config)) {
      if (enabled) {
        if (!registry._plugins.has(key)) {
          const ctor = constructors
            ? (constructors.get ? constructors.get(key) : constructors[key])
            : null;
          if (ctor) registry.add(key, ctor, this._data, chart);
        }
      } else {
        registry.remove(key, chart);
      }
    }
  }

  /**
   * Sync Pine indicators. Removes wrappers for disabled/removed indicators
   * and creates new ones for new entries.
   *
   * @param {object[]} indicators  - array of { id, source, params, title, enabled }
   */
  updatePine(indicators) {
    this._syncPine(indicators);
  }

  /**
   * Force an immediate re-run of all Pine indicators.
   * Useful after history extends (pagination).
   *
   * @param {object[]} data
   */
  runPineWithData(data) {
    this._data = Array.isArray(data) ? data : this._data;
    for (const wrapper of this._pineWrappers.values()) {
      wrapper.setData(this._data);
      wrapper.runNow().catch(() => {});
    }
  }

  /** Update the chart reference (e.g., after chart type change creates new chart). */
  setChart(chart) {
    this._chart = chart;
  }

  /** Clean up all Pine wrappers and clear registry. */
  destroy() {
    for (const wrapper of this._pineWrappers.values()) {
      wrapper.destroy();
    }
    this._pineWrappers.clear();

    if (this._registry && this._chart) {
      try {
        this._registry.clear(this._chart);
      } catch {}
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _syncBuiltins(config) {
    if (!this._registry || !this._chart) return;
    // We delegate actual add/remove to the caller's INDICATOR_CONSTRUCTORS
    // via updateBuiltins() since the constructors map lives in ChartComponent.
    // This method is a no-op placeholder for cases where caller uses init().
  }

  _syncPine(indicators) {
    if (!Array.isArray(indicators)) return;

    const enabledIds = new Set(indicators.filter(i => i.enabled).map(i => i.id));

    // Remove wrappers for indicators no longer present or disabled
    for (const [id, wrapper] of this._pineWrappers) {
      if (!enabledIds.has(id)) {
        wrapper.destroy();
        this._pineWrappers.delete(id);
      }
    }

    // Create/update wrappers for enabled indicators
    for (const ind of indicators) {
      if (!ind.enabled) continue;
      if (this._pineWrappers.has(ind.id)) {
        // Already exists — update data and re-run if source/params changed
        const wrapper = this._pineWrappers.get(ind.id);
        wrapper.setData(this._data);
        wrapper.runNow().catch(() => {});
      } else {
        // New indicator — skip (but continue the loop) if runtime is not yet available
        if (!this._pineRuntime) continue;
        const wrapper = new PineIndicatorWrapper(
          ind,
          this._pineRuntime,
          this._chart,
          (id, result) => {
            if (this._onPineResult) {
              this._onPineResult(id, result, this._chart);
            }
          },
          this._debounceMs,
        );
        wrapper.setData(this._data);
        this._pineWrappers.set(ind.id, wrapper);
        wrapper.runNow().catch(() => {});
      }
    }
  }
}
