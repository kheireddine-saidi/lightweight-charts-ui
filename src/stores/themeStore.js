/**
 * themeStore — global app theme ('dark' | 'light'), readable by any
 * component without prop-drilling. App.jsx remains the source of truth
 * for the toggle action and persistence (localStorage 'tv_theme'); this
 * store mirrors that value so components like PositionsPanel and
 * TradingPanel — which previously had no access to theme at all and were
 * hardcoded to dark colors — can react to theme changes live.
 */
import { create } from 'zustand';

export const useThemeStore = create((set) => ({
  theme: (typeof localStorage !== 'undefined' && localStorage.getItem('tv_theme')) || 'dark',
  setTheme: (theme) => set({ theme }),
}));
