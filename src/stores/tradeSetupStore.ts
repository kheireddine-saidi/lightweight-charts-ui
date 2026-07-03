// stores/tradeSetupStore.ts
// Shared state between the chart's TradeSetupTool and TradingPanel.
// When the user finishes drawing the trade setup on the chart, prices are
// written here and TradingPanel reads them to pre-fill its inputs.

import { create } from 'zustand';
import { EventBus, Events } from '../core/EventBus';

interface TradeSetup {
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  side: 'long' | 'short' | null;
  isReady: boolean;
  zoneId: string | null;
}

interface TradeSetupState extends TradeSetup {
  setSetup: (setup: Partial<TradeSetup & { requestTradingPanel?: boolean; zoneLink?: { zoneId: string; positionId: string; status: string } | null }>) => void;
  clearSetup: () => void;
}

const EMPTY: TradeSetup = {
  entryPrice: null,
  stopLoss: null,
  takeProfit: null,
  side: null,
  isReady: false,
  zoneId: null,
};

export const useTradeSetupStore = create<TradeSetupState>((set, get) => ({
  ...EMPTY,
  setSetup: (setup) => {
    // Intercept requestTradingPanel → emit EventBus event
    if (setup.requestTradingPanel) {
      EventBus.emit(Events.TRADE_SETUP_DRAWN, { setup: get() });
      // Don't store requestTradingPanel in state
      const { requestTradingPanel: _requestTradingPanel, zoneLink: _zoneLink1, ...rest } = setup as any;
      if (Object.keys(rest).length > 0) set((s) => ({ ...s, ...rest }));
      return;
    }
    // Intercept zoneLink → emit EventBus event
    if (setup.zoneLink != null) {
      const { zoneId, positionId, status } = setup.zoneLink;
      EventBus.emit(Events.TRADE_ZONE_LINKED, { zoneId, positionId, status });
      const { zoneLink: _zoneLink2, ...rest } = setup as any;
      if (Object.keys(rest).length > 0) set((s) => ({ ...s, ...rest }));
      return;
    }
    set((s) => ({ ...s, ...setup }));
  },
  clearSetup: () => set(EMPTY),
}));
