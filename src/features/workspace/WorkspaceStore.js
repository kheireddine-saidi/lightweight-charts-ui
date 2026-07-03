/**
 * WorkspaceStore — owns all multi-chart workspace state.
 *
 * Extracted from App.jsx to make App a pure composition root.
 *
 * Owns:
 *  - chart list (symbol, interval, indicators, comparisonSymbols)
 *  - active chart id
 *  - layout
 *  - persistence (localStorage)
 *  - chart manipulation helpers (add, remove, update)
 *
 * Does NOT own:
 *  - trading state (tradingStore)
 *  - alerts (useAlerts)
 *  - watchlist (useWatchlist)
 *  - theme (own simple hook)
 *  - drawing tool state (App toolbar state, stays in App for now)
 */

import { create } from 'zustand';
import { WorkspaceRepository } from './WorkspaceRepository';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_INTERVAL_UNITS = new Set(['s', 'm', 'h', 'd', 'w', 'M']);

const isValidIntervalValue = (value) => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10) > 0;
  const match = /^([1-9]\d*)([smhdwM])$/.exec(trimmed);
  if (!match) return false;
  return VALID_INTERVAL_UNITS.has(match[2]);
};

const sanitizeFavoriteIntervals = (raw) => {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter(isValidIntervalValue)));
};

const sanitizeCustomIntervals = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object' && isValidIntervalValue(item.value))
    .map((item) => ({ value: item.value, label: item.label || item.value, isCustom: true }));
};

// ─── Initial State Loaders ────────────────────────────────────────────────────

const loadSavedLayout = () => {
  return WorkspaceRepository.loadSavedLayout() ?? null;
};

const makeDefaultChart = (id = 1) => ({
  id,
  symbol: 'BTCUSDT',
  interval: WorkspaceRepository.loadInterval('1d'),
  indicators: { sma: false, ema: false },
  comparisonSymbols: [],
});

// ─── Store ────────────────────────────────────────────────────────────────────

export const useWorkspaceStore = create((set, get) => {
  const savedLayout = loadSavedLayout();

  return {
    // ── State ───────────────────────────────────────────────────────────────

    layout: savedLayout?.layout ?? '1',
    activeChartId: 1,
    charts: savedLayout?.charts ?? [makeDefaultChart(1)],

    favoriteIntervals: sanitizeFavoriteIntervals(
      WorkspaceRepository.loadFavouriteIntervals(null)
    ),
    customIntervals: sanitizeCustomIntervals(
      WorkspaceRepository.loadCustomIntervals([])
    ),
    lastNonFavoriteInterval: (() => {
      const saved = WorkspaceRepository.loadLastNonFavInterval();
      return isValidIntervalValue(saved) ? saved : null;
    })(),

    // ── Selectors (derived, not stored) ─────────────────────────────────────

    getActiveChart: () => {
      const { charts, activeChartId } = get();
      return charts.find((c) => c.id === activeChartId) || charts[0];
    },

    // ── Chart list actions ───────────────────────────────────────────────────

    setActiveChartId: (id) => set({ activeChartId: id }),

    updateChart: (id, fields) =>
      set((s) => ({
        charts: s.charts.map((c) => (c.id === id ? { ...c, ...fields } : c)),
      })),

    setActiveChartSymbol: (symbol) => {
      const { activeChartId } = get();
      get().updateChart(activeChartId, { symbol });
    },

    setActiveChartInterval: (interval) => {
      const { activeChartId, favoriteIntervals } = get();
      get().updateChart(activeChartId, { interval });
      if (!favoriteIntervals.includes(interval)) {
        set({ lastNonFavoriteInterval: interval });
        try { WorkspaceRepository.saveLastNonFavInterval(interval); } catch { /* ignore */ }
      }
      try { WorkspaceRepository.saveInterval(interval); } catch { /* ignore */ }
    },

    toggleActiveChartIndicator: (name) => {
      const { activeChartId } = get();
      set((s) => ({
        charts: s.charts.map((c) =>
          c.id === activeChartId
            ? { ...c, indicators: { ...c.indicators, [name]: !c.indicators[name] } }
            : c
        ),
      }));
    },

    addComparisonSymbol: (symbol) => {
      const { activeChartId } = get();
      const colors = ['#f57f17', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5'];
      set((s) => ({
        charts: s.charts.map((c) => {
          if (c.id !== activeChartId) return c;
          const current = c.comparisonSymbols || [];
          if (current.find((cs) => cs.symbol === symbol)) {
            return { ...c, comparisonSymbols: current.filter((cs) => cs.symbol !== symbol) };
          }
          return {
            ...c,
            comparisonSymbols: [
              ...current,
              { symbol, color: colors[current.length % colors.length] },
            ],
          };
        }),
      }));
    },

    // ── Layout actions ───────────────────────────────────────────────────────

    setLayout: (newLayout) => {
      const count = parseInt(newLayout, 10);
      const { charts, activeChartId } = get();
      const activeChart = charts.find((c) => c.id === activeChartId) || charts[0];

      let newCharts = [...charts];
      if (newCharts.length < count) {
        for (let i = newCharts.length; i < count; i++) {
          newCharts.push(makeDefaultChart(i + 1));
          newCharts[newCharts.length - 1].symbol = activeChart.symbol;
          newCharts[newCharts.length - 1].interval = activeChart.interval;
        }
      } else if (newCharts.length > count) {
        newCharts = newCharts.slice(0, count);
      }

      set({
        layout: newLayout,
        charts: newCharts,
        activeChartId: activeChartId > count ? 1 : activeChartId,
      });
    },

    saveLayout: () => {
      const { layout, charts } = get();
      try {
        WorkspaceRepository.saveLayout(layout, charts);
        return true;
      } catch (err) {
        console.error('[WorkspaceStore] Failed to save layout:', err);
        return false;
      }
    },

    // ── Interval / favorites ─────────────────────────────────────────────────

    toggleFavoriteInterval: (interval) => {
      if (!isValidIntervalValue(interval)) return;
      set((s) => ({
        favoriteIntervals: s.favoriteIntervals.includes(interval)
          ? s.favoriteIntervals.filter((i) => i !== interval)
          : [...s.favoriteIntervals, interval],
      }));
      try {
        const next = get().favoriteIntervals;
        WorkspaceRepository.saveFavouriteIntervals(next);
      } catch { /* ignore */ }
    },

    addCustomInterval: (value, unit) => {
      const numericValue = parseInt(value, 10);
      if (!Number.isFinite(numericValue) || numericValue <= 0) return { error: 'Enter a valid number greater than 0' };
      const unitNorm = VALID_INTERVAL_UNITS.has(unit) ? unit : null;
      if (!unitNorm) return { error: 'Invalid interval unit' };
      const newValue = `${numericValue}${unitNorm}`;
      if (!isValidIntervalValue(newValue)) return { error: 'Invalid interval format' };
      const { customIntervals } = get();
      if (customIntervals.some((i) => i.value === newValue)) return { error: 'Interval already available!' };
      const next = [...customIntervals, { value: newValue, label: newValue, isCustom: true }];
      set({ customIntervals: next });
      try { WorkspaceRepository.saveCustomIntervals(next); } catch { /* ignore */ }
      return { ok: true };
    },

    removeCustomInterval: (intervalValue) => {
      set((s) => ({
        customIntervals: s.customIntervals.filter((i) => i.value !== intervalValue),
        favoriteIntervals: s.favoriteIntervals.filter((i) => i !== intervalValue),
      }));
      try {
        const { customIntervals } = get();
        WorkspaceRepository.saveCustomIntervals(customIntervals);
      } catch { /* ignore */ }
      // If the current interval was removed, fall back to 1d
      const { getActiveChart, setActiveChartInterval } = get();
      if (getActiveChart()?.interval === intervalValue) {
        setActiveChartInterval('1d');
      }
    },
  };
});
