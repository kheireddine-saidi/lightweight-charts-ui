/**
 * indicatorStore — persists user-created Pine Script indicators.
 * Each indicator has a unique id, title, source code, and params.
 */
import { create } from 'zustand';

export interface UserIndicator {
  id: string;
  title: string;
  source: string;
  params: Record<string, unknown>;
  enabled: boolean;
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
  setEnabled: (id: string, enabled: boolean) => void;
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
  setEnabled: (id, enabled) => {
    const next = get().indicators.map(i => i.id===id ? {...i, enabled} : i);
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

export function createDefaultIndicator(): UserIndicator {
  return {
    id: `ind_${Date.now()}`,
    title: 'My Indicator',
    source: DEFAULT_TEMPLATE,
    params: {},
    enabled: true,
    color: '#2962ff',
  };
}
