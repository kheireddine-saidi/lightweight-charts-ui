/**
 * marketStore — live market price.
 * Updated on every WebSocket tick (PRICE_TICK) for real-time PnL display.
 * CANDLE events (closed bars) are kept for replay/indicator logic.
 */
import { create } from 'zustand';
import { EventBus, Events } from '../core/EventBus';

let _busSubscribed = false;

export const useMarketStore = create((set) => {
  if (!_busSubscribed) {
    _busSubscribed = true;
    // PRICE_TICK fires on every WS message (including in-progress candles)
    EventBus.on(Events.PRICE_TICK, ({ price }) => {
      if (price != null && Number.isFinite(price)) {
        set({ currentPrice: price });
      }
    });
    // Fallback for replay mode (which only emits CANDLE events)
    EventBus.on(Events.CANDLE, ({ candle }) => {
      if (candle?.close != null) {
        set({ currentPrice: candle.close });
      }
    });
  }
  return {
    currentPrice: 1.1000,
    setCurrentPrice: (price) => set({ currentPrice: price }),
  };
});
