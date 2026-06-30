// stores/tradingStore.ts
//
// TradingStore is now a READ-ONLY mirror of ExecutionEngine state.
// It subscribes to EventBus events and syncs the Zustand store so
// React components can reactively read positions/balance.
//
// Write path:  UI → ExecutionEngine methods (openPosition, closePosition…)
// Read path:   Components → useTradingStore (Zustand selectors)
// Sync path:   ExecutionEngine → EventBus → tradingStore subscriber
//
// The store no longer duplicates trading logic (PnL, SL/TP fill, etc.)
// All mutation helpers (openPosition, cancelPendingOrder, etc.) now
// delegate to ExecutionEngine and return its result.

import { create } from 'zustand';
import { EventBus, Events } from '../core/EventBus';
import { executionEngine } from '../engine/trading/ExecutionEngine';

// Module-level guard: prevents duplicate EventBus subscriptions on HMR reloads.
let _busSubscribed = false;

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  type: 'market' | 'limit' | 'stop';
  entryPrice: number;
  limitPrice?: number;
  positionSize: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  status: 'pending' | 'open' | 'closed';
  entryTime: number;
  filledTime?: number;
  pnl: number;
  pnlPercent: number;
  openedAt: Date;
  markerId?: string | null;
  lineId?: string | null;
  slLineId?: string | null;
  tpLineId?: string | null;
}

export interface ClosedPosition extends Position {
  closePrice: number;
  closeTime: number;
  closedAt: Date;
}

interface TradingState {
  positions: Position[];
  pendingOrders: Position[];
  closedPositions: ClosedPosition[];
  balance: number;
  equity: number;
  reservedMargin: number;

  // Write methods — delegate to ExecutionEngine
  openPosition: (data: Partial<Position>) => string;
  cancelPendingOrder: (id: string) => void;
  closePosition: (id: string, closePrice: number, closeTime?: number) => void;
  updatePendingOrder: (id: string, fields: Partial<Position>) => void;
  updatePosition: (id: string, fields: Partial<Position>) => void;

  // Legacy compat — kept for components not yet migrated to EventBus
  // Delegates to ExecutionEngine's FillModel so logic is not duplicated.
  updatePnLAndCheckSLTP: (
    currentPrice: number,
    currentTime: number,
    candleHigh?: number,
    candleLow?: number
  ) => { filled: Position[]; closed: { pos: Position; price: number }[] };

  // Internal sync — called by EventBus subscriptions only
  _syncFromEngine: () => void;
}

export const useTradingStore = create<TradingState>((set, get) => {
  // ── EventBus subscriptions — keep Zustand in sync with ExecutionEngine ──
  // Guard against duplicate listeners created by HMR reloads.
  if (!_busSubscribed) {
    _busSubscribed = true;
    EventBus.on(Events.POSITION_OPENED, () => get()._syncFromEngine());
    EventBus.on(Events.POSITION_CLOSED, () => get()._syncFromEngine());
    EventBus.on(Events.ORDER_CREATED,   () => get()._syncFromEngine());
    EventBus.on(Events.ORDER_FILLED,    () => get()._syncFromEngine());
    EventBus.on(Events.ORDER_CANCELLED, () => get()._syncFromEngine());
    EventBus.on(Events.BALANCE_CHANGED, ({ balance, equity, reservedMargin }: { balance: number; equity: number; reservedMargin?: number }) => {
      set({ balance, equity, ...(reservedMargin != null ? { reservedMargin } : {}) });
    });
    // Lightweight per-tick equity update (live unrealised PnL) — avoids a full
    // _syncFromEngine() call on every price tick.
    EventBus.on(Events.EQUITY_TICK, ({ equity }: { equity: number }) => {
      set({ equity });
    });
  }

  return {
    positions:        [],
    pendingOrders:    [],
    closedPositions:  [],
    balance:          executionEngine.balance,
    equity:           executionEngine.equity,
    reservedMargin:   executionEngine.reservedMargin,

    // ── Write methods ───────────────────────────────────────────────────

    openPosition: (positionData) => {
      return executionEngine.openPosition(positionData as any);
    },

    cancelPendingOrder: (id) => {
      executionEngine.cancelOrder(id);
      get()._syncFromEngine();
    },

    updatePendingOrder: (id, fields) => {
      executionEngine.updatePosition(id, fields as any);
      get()._syncFromEngine();
    },

    updatePosition: (id, fields) => {
      executionEngine.updatePosition(id, fields as any);
      get()._syncFromEngine();
    },

    closePosition: (id, closePrice, closeTime) => {
      executionEngine.closePosition(id, closePrice, closeTime);
      // _syncFromEngine triggered by POSITION_CLOSED event above
    },

    // ── Legacy compat — used by ChartComponent until fully migrated ─────
    //
    // Previously this method ran the entire fill & SL/TP check inline.
    // Now we forward the candle to ExecutionEngine via _onCandle and read
    // back the results from its internal state after processing.
    updatePnLAndCheckSLTP: (currentPrice, currentTime, candleHigh?, candleLow?) => {
      const syntheticCandle = {
        time: currentTime,
        open: currentPrice,
        high: candleHigh ?? currentPrice,
        low:  candleLow  ?? currentPrice,
        close: currentPrice,
      };

      // Capture state before
      const beforeFilled  = new Set(executionEngine.positions.map((p: any) => p.id));
      const beforeClosed  = new Set(executionEngine.closedTrades.map((p: any) => p.id));

      // Run through engine (emits events → _syncFromEngine auto-called)
      executionEngine._onCandle(syntheticCandle);

      // Derive what was filled/closed in this tick
      const filled = executionEngine.positions.filter((p: any) => !beforeFilled.has(p.id));
      const closed = executionEngine.closedTrades
        .filter((p: any) => !beforeClosed.has(p.id))
        .map((p: any) => ({ pos: p, price: p.closePrice }));

      return { filled: filled as any, closed: closed as any };
    },

    // ── Internal sync ───────────────────────────────────────────────────
    _syncFromEngine: () => {
      const snap = executionEngine.getSnapshot();
      set({
        positions:       snap.positions as Position[],
        pendingOrders:   snap.pendingOrders as Position[],
        closedPositions: snap.closedTrades as ClosedPosition[],
        balance:         snap.balance,
        equity:          snap.equity,
      });
    },
  };
});
