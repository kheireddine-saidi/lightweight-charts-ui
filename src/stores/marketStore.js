/**
 * marketStore — live market prices, keyed per symbol.
 * Updated on every WebSocket tick (PRICE_TICK) for real-time PnL display.
 * CANDLE events (closed bars) are kept for replay/indicator logic.
 *
 * pricesBySymbol: Record<string, number>  — the canonical per-symbol map.
 * currentPrice (getter)                   — backward-compat: returns the price for
 *   the most-recently-updated symbol, so existing single-chart call sites keep working
 *   without changes. New call sites should use pricesBySymbol[symbol] directly.
 */
import { create } from 'zustand';
import { EventBus, Events } from '../core/EventBus';

let _busSubscribed = false;

export const useMarketStore = create((set, get) => {
  if (!_busSubscribed) {
    _busSubscribed = true;

    // PRICE_TICK fires on every WS message (including in-progress candles).
    // Payload: { price, time, symbol }
    EventBus.on(Events.PRICE_TICK, ({ price, symbol }) => {
      if (price != null && Number.isFinite(price)) {
        setTimeout(() => {
          const sym = symbol ?? '_default';
          set((state) => ({
            pricesBySymbol: { ...state.pricesBySymbol, [sym]: price },
            _lastSymbol: sym,
          }));
        }, 0);
      }
    });

    // Fallback for replay mode (which only emits CANDLE events).
    // Payload: { candle, index, symbol }
    EventBus.on(Events.CANDLE, ({ candle, symbol }) => {
      if (candle?.close != null) {
        setTimeout(() => {
          const sym = symbol ?? '_default';
          set((state) => ({
            pricesBySymbol: { ...state.pricesBySymbol, [sym]: candle.close },
            _lastSymbol: sym,
          }));
        }, 0);
      }
    });
  }

  return {
    /** Per-symbol price map. Read as: pricesBySymbol[symbol] ?? fallback */
    pricesBySymbol: { _default: 1.1000 },

    /** Internal: tracks the symbol most recently updated (for backward-compat getter) */
    _lastSymbol: '_default',

    /**
     * Backward-compatible getter: returns the price for a given symbol.
     * If no symbol is provided, returns the price for the most-recently-updated symbol.
     * Existing call sites that don't pass a symbol continue to work correctly for
     * single-chart setups; multi-chart call sites should pass the active chart's symbol.
     */
    get currentPrice() {
      const state = get();
      const sym = state._lastSymbol ?? '_default';
      return state.pricesBySymbol[sym] ?? 1.1000;
    },

    /** Convenience: get price for a specific symbol (returns fallback if not yet seen) */
    getPriceForSymbol: (symbol, fallback = 0) => {
      const state = get();
      return state.pricesBySymbol[symbol ?? '_default'] ?? fallback;
    },

    /** Manual setter — kept for backward compat (TradeSetupTool etc.) */
    setCurrentPrice: (price, symbol) => {
      set((state) => {
        const sym = symbol ?? state._lastSymbol ?? '_default';
        return {
          pricesBySymbol: { ...state.pricesBySymbol, [sym]: price },
          _lastSymbol: sym,
        };
      });
    },
  };
});
