import { create } from 'zustand';

export const useMarketStore = create((set) => ({
  currentPrice: 1.1000, // default
  setCurrentPrice: (price) => set({ currentPrice: price }),
}));