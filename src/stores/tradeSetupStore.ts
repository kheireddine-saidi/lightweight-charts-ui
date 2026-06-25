// stores/tradeSetupStore.ts
// Shared state between the chart's TradeSetupTool and TradingPanel.
// When the user finishes drawing the trade setup on the chart, prices are
// written here and TradingPanel reads them to pre-fill its inputs.

import { create } from 'zustand';

interface TradeSetup {
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  side: 'long' | 'short' | null;
  isReady: boolean;
  requestTradingPanel: boolean;
  zoneId: string | null;
  zoneLink: { zoneId: string; positionId: string; status: string } | null;
}

interface TradeSetupState extends TradeSetup {
  setSetup: (setup: Partial<TradeSetup>) => void;
  clearSetup: () => void;
}

const EMPTY: TradeSetup = {
  entryPrice: null,
  stopLoss: null,
  takeProfit: null,
  side: null,
  isReady: false,
  requestTradingPanel: false,
  zoneId: null,
  zoneLink: null,
};

export const useTradeSetupStore = create<TradeSetupState>((set) => ({
  ...EMPTY,
  setSetup: (setup) => set((s) => ({ ...s, ...setup })),
  clearSetup: () => set(EMPTY),
}));
