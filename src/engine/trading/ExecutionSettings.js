/**
 * ExecutionSettings — simulation parameters for order execution.
 *
 * riskPerTradePercent is ACTIVE — used today by position-sizing logic.
 * slippage/fees/funding are PLACEHOLDERS — persisted and editable, but not
 * yet applied anywhere in FillModel/ExecutionEngine. Wire them in when the
 * actual simulation logic is implemented; until then they must have zero
 * effect on fills, PnL, or equity.
 *
 * No React imports. No chart imports.
 */
import { localStorageSettingsStorage } from '../../storage/LocalStorageSettingsStorage';
import { EventBus, Events } from '../../core/EventBus';

const DEFAULTS = {
  riskPerTradePercent: 1,
  slippage: { model: 'percentage', value: 0 },      // placeholder — not applied to fills yet
  fees:     { makerPercent: 0, takerPercent: 0 },   // placeholder — not applied to fills yet
  funding:  { ratePercent: 0, intervalHours: 8 },   // placeholder — not applied to fills yet
};

class ExecutionSettingsClass {
  constructor() {
    this._values = { ...DEFAULTS };
    this._loaded = false;
    this._load();
  }

  async _load() {
    try {
      const saved = await localStorageSettingsStorage.loadSettings();
      if (saved) this._values = { ...DEFAULTS, ...saved };
    } catch {
      // Fall back to defaults silently
    }
    this._loaded = true;
    EventBus.emit(Events.SETTINGS_CHANGED, { settings: this.getAll() });
  }

  /** Return a shallow copy of all settings. */
  getAll() { return { ...this._values }; }

  /** The active risk-per-trade setting (a percentage, e.g. 1 means 1%). */
  get riskPerTradePercent() { return this._values.riskPerTradePercent; }

  /**
   * Merge partial settings update, persist, and broadcast.
   * @param {Partial<typeof DEFAULTS>} partial
   */
  update(partial) {
    this._values = { ...this._values, ...partial };
    localStorageSettingsStorage.saveSettings(this._values);
    EventBus.emit(Events.SETTINGS_CHANGED, { settings: this.getAll() });
  }
}

export const executionSettings = new ExecutionSettingsClass();
