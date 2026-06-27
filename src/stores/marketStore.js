/**
 * marketStore — live market price, updated via EventBus.
 *
 * Components should never update this store directly from chart callbacks.
 * The store subscribes to EventBus CANDLE events and updates automatically.
 */
import { create } from 'zustand';
import { EventBus, Events } from '../core/EventBus';

// Module-level guard: prevents duplicate subscriptions on HMR reloads.
let _busSubscribed = false;

export const useMarketStore = create((set) => {
  if (!_busSubscribed) {
    _busSubscribed = true;
    EventBus.on(Events.CANDLE, ({ candle }) => {
      if (candle?.close != null) {
        set({ currentPrice: candle.close });
      }
    });
  }

  return {
    currentPrice: 1.1000,
    // Keep setter for live feed path (WebSocket updates outside replay)
    setCurrentPrice: (price) => set({ currentPrice: price }),
  };
});
