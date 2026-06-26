/**
 * marketStore — live market price, updated via EventBus.
 *
 * Components should never update this store directly from chart callbacks.
 * The store subscribes to EventBus CANDLE events and updates automatically.
 */
import { create } from 'zustand';
import { EventBus, Events } from '../core/EventBus';

export const useMarketStore = create((set) => {
  // Subscribe to candle events from EventBus
  // This replaces direct store.setCurrentPrice() calls scattered in ChartComponent
  EventBus.on(Events.CANDLE, ({ candle }) => {
    if (candle?.close != null) {
      set({ currentPrice: candle.close });
    }
  });

  return {
    currentPrice: 1.1000,
    // Keep setter for live feed path (WebSocket updates outside replay)
    setCurrentPrice: (price) => set({ currentPrice: price }),
  };
});
