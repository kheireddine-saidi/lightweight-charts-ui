/**
 * chartSettingsStore — persisted chart display settings.
 * Covers: grid lines, background color, bull/bear colors, magnet threshold.
 * Applied live to the chart via ChartComponent's settings-watching effect.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'chart_settings_v1';

const DEFAULTS = {
  showGrid: true,
  backgroundColor: null,   // null = use theme default
  bullColor: '#089981',
  bearColor: '#f23645',
  magnetThresholdPx: 12,   // pixel distance — beyond this, magnet snapping is ignored
  syncDrawingsAcrossSymbol: true,  // mirror drawings to all charts showing the same symbol
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export const useChartSettingsStore = create((set, get) => ({
  ...load(),

  setSetting: (key, value) => {
    const next = { ...get(), [key]: value };
    // Strip zustand action functions before persisting
    const { setSetting: _setSetting, resetSettings: _resetSettings, ...persistable } = next;
    save(persistable);
    set({ [key]: value });
  },

  resetSettings: () => {
    save(DEFAULTS);
    set({ ...DEFAULTS });
  },
}));
