/**
 * indicatorStore — persists user-created Pine Script indicators.
 * Each indicator has a unique id, title, source code, and params.
 */
import { create } from 'zustand';
import { parsePineInputs, parsePineTitle } from '../indicators/PineTSRuntime';
import type { PineInputDef } from '../indicators/PineTSRuntime';

export interface UserIndicator {
  id: string;
  title: string;            // extracted from indicator("Title") declaration
  source: string;
  params: Record<string, unknown>;  // keyed by input title name
  parsedInputs: PineInputDef[];     // extracted input declarations
  /**
   * Chart ids (WorkspaceStore chart.id) this indicator is currently applied
   * to. Pine indicators are defined once but rendered per-chart — a script
   * created while chart 2 is active starts out applied only to chart 2, and
   * each chart independently renders whichever indicators list its id here.
   * Empty array = defined but not applied anywhere.
   */
  appliedChartIds: number[];
  color: string;
}

const STORAGE_KEY = 'user_indicators_v1';

function load(): UserIndicator[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}
function save(list: UserIndicator[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

interface IndicatorStoreState {
  indicators: UserIndicator[];
  upsert: (ind: UserIndicator) => void;
  remove: (id: string) => void;
  /** Toggle whether an indicator is applied to a specific chart. */
  toggleForChart: (id: string, chartId: number) => void;
}

export const useIndicatorStore = create<IndicatorStoreState>((set, get) => ({
  indicators: load(),
  upsert: (ind) => {
    const all = get().indicators;
    const idx = all.findIndex(i => i.id === ind.id);
    const next = idx >= 0 ? all.map((i,n) => n===idx ? ind : i) : [...all, ind];
    save(next);
    set({ indicators: next });
  },
  remove: (id) => {
    const next = get().indicators.filter(i => i.id !== id);
    save(next);
    set({ indicators: next });
  },
  toggleForChart: (id, chartId) => {
    const next = get().indicators.map(i => {
      if (i.id !== id) return i;
      const applied = i.appliedChartIds ?? [];
      const isApplied = applied.includes(chartId);
      return {
        ...i,
        appliedChartIds: isApplied
          ? applied.filter(c => c !== chartId)
          : [...applied, chartId],
      };
    });
    save(next);
    set({ indicators: next });
  },
}));

const DEFAULT_TEMPLATE = `//@version=5
indicator("My Indicator", overlay=false)

// Write your Pine Script here
sma20 = ta.sma(close, 20)
plot(sma20, "SMA 20", color.blue)
`;

export function createDefaultIndicator(chartId?: number): UserIndicator {
  const source = DEFAULT_TEMPLATE;
  return {
    id: `ind_${Date.now()}`,
    title: parsePineTitle(source),
    source,
    params: {},
    parsedInputs: parsePineInputs(source),
    // Auto-apply to the chart it was created from, if given, so it's
    // immediately visible somewhere without an extra manual toggle step.
    appliedChartIds: chartId != null ? [chartId] : [],
    color: '#2962ff',
  };
}

/**
 * Re-parse inputs and title from source — call after saving edited source.
 */
export function refreshIndicatorMeta(ind: UserIndicator): UserIndicator {
  return {
    ...ind,
    title: parsePineTitle(ind.source),
    parsedInputs: parsePineInputs(ind.source),
  };
}
