// stores/tradingStore.ts
import { create } from 'zustand';

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  type: 'market' | 'limit';
  entryPrice: number;
  limitPrice?: number;       // for limit orders, the price to fill at
  positionSize: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  status: 'pending' | 'open' | 'closed';
  entryTime: number;         // candle timestamp (seconds) when order was placed
  filledTime?: number;       // candle timestamp when limit order was actually filled
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
  openPosition: (data: Partial<Position>) => string;
  cancelPendingOrder: (id: string) => void;
  closePosition: (id: string, closePrice: number, closeTime?: number) => void;
  updatePendingOrder: (id: string, fields: Partial<Position>) => void;
  updatePosition: (id: string, fields: Partial<Position>) => void;
  updatePnLAndCheckSLTP: (
    currentPrice: number,
    currentTime: number,
    candleHigh?: number,
    candleLow?: number
  ) => { filled: Position[]; closed: { pos: Position; price: number }[] };
}

export const useTradingStore = create<TradingState>((set, get) => ({
  positions: [],
  pendingOrders: [],
  closedPositions: [],
  balance: 10000,
  equity: 10000,

  openPosition: (positionData) => {
    const id = crypto.randomUUID();
    const isLimit = positionData.type === 'limit';
    const newPosition: Position = {
      symbol: 'BTCUSDT',
      side: 'long',
      type: 'market',
      positionSize: 0.01,
      leverage: 1,
      pnl: 0,
      pnlPercent: 0,
      openedAt: new Date(),
      markerId: null,
      lineId: null,
      slLineId: null,
      tpLineId: null,
      ...positionData,
      id,
      entryPrice: isLimit && positionData.limitPrice
        ? positionData.limitPrice
        : (positionData.entryPrice ?? 0),
      status: isLimit ? 'pending' : 'open',
      entryTime: positionData.entryTime ?? Math.floor(Date.now() / 1000),
      // For market orders, filledTime equals entryTime (fill is immediate at current candle)
      filledTime: isLimit ? undefined : (positionData.entryTime ?? Math.floor(Date.now() / 1000)),
    };

    if (isLimit) {
      set((state) => ({ pendingOrders: [...state.pendingOrders, newPosition] }));
    } else {
      set((state) => ({ positions: [...state.positions, newPosition] }));
    }
    return id;
  },

  cancelPendingOrder: (id) => {
    set((state) => ({
      pendingOrders: state.pendingOrders.filter((o) => o.id !== id),
    }));
  },

  updatePendingOrder: (id, fields) => {
    set((state) => ({
      pendingOrders: state.pendingOrders.map((o) =>
        o.id === id ? { ...o, ...fields, entryPrice: fields.limitPrice ?? fields.entryPrice ?? o.entryPrice } : o
      ),
    }));
  },

  updatePosition: (id, fields) => {
    set((state) => ({
      positions: state.positions.map((p) =>
        p.id === id ? { ...p, ...fields } : p
      ),
    }));
  },

  closePosition: (id, closePrice, closeTime) => {
    set((state) => {
      const position = state.positions.find((p) => p.id === id);
      if (!position) return state;
      const pnl =
        position.side === 'long'
          ? (closePrice - position.entryPrice) * position.positionSize * position.leverage
          : (position.entryPrice - closePrice) * position.positionSize * position.leverage;
      const closedPosition: ClosedPosition = {
        ...position,
        status: 'closed',
        closePrice,
        closeTime: closeTime ?? Math.floor(Date.now() / 1000),
        pnl,
        pnlPercent: (pnl / (position.entryPrice * position.positionSize)) * 100,
        closedAt: new Date(),
      };
      const newBalance = state.balance + pnl;
      return {
        positions: state.positions.filter((p) => p.id !== id),
        closedPositions: [closedPosition, ...state.closedPositions],
        balance: newBalance,
        equity: newBalance,
      };
    });
  },

  updatePnLAndCheckSLTP: (currentPrice, currentTime, candleHigh?, candleLow?) => {
    const state = get();
    const filledOrders: Position[] = [];
    const closedPositions: { pos: Position; price: number }[] = [];

    // --- Check pending limit orders for fill ---
    // Only fill if currentTime >= entryTime (don't fill on candles before the order)
    const newlyFilled: Position[] = [];
    const remainingPending: Position[] = [];

    for (const order of state.pendingOrders) {
      // Only process candles that come after the order was placed
      if (currentTime < order.entryTime) {
        remainingPending.push(order);
        continue;
      }

      const fillPrice = order.entryPrice; // limit price
      let filled = false;

      if (order.side === 'long') {
        // Long limit: fill when price drops to or below limit price
        const low = candleLow ?? currentPrice;
        if (low <= fillPrice) filled = true;
      } else {
        // Short limit: fill when price rises to or above limit price
        const high = candleHigh ?? currentPrice;
        if (high >= fillPrice) filled = true;
      }

      if (filled) {
        const openPos: Position = {
          ...order,
          status: 'open',
          filledTime: currentTime,
        };
        newlyFilled.push(openPos);
        filledOrders.push(openPos);
      } else {
        remainingPending.push(order);
      }
    }

    // --- Update open positions PnL and check SL/TP ---
    const toClose: { id: string; closePrice: number; closeTime: number }[] = [];
    const allOpenPositions = [...state.positions, ...newlyFilled];

    const updatedPositions = allOpenPositions.map((pos) => {
      // Only process candles that come AFTER the position's entry time
      if (currentTime < (pos.filledTime ?? pos.entryTime)) {
        return pos;
      }

      const pnl =
        pos.side === 'long'
          ? (currentPrice - pos.entryPrice) * pos.positionSize * pos.leverage
          : (pos.entryPrice - currentPrice) * pos.positionSize * pos.leverage;
      const pnlPercent = (pnl / (pos.entryPrice * pos.positionSize)) * 100;
      const updated = { ...pos, pnl, pnlPercent };

      // Use candle high/low for more accurate SL/TP detection
      const low = candleLow ?? currentPrice;
      const high = candleHigh ?? currentPrice;

      // Check Stop Loss
      if (pos.stopLoss !== undefined) {
        if (pos.side === 'long' && low <= pos.stopLoss) {
          toClose.push({ id: pos.id, closePrice: pos.stopLoss, closeTime: currentTime });
        } else if (pos.side === 'short' && high >= pos.stopLoss) {
          toClose.push({ id: pos.id, closePrice: pos.stopLoss, closeTime: currentTime });
        }
      }

      // Check Take Profit
      if (pos.takeProfit !== undefined) {
        if (pos.side === 'long' && high >= pos.takeProfit) {
          toClose.push({ id: pos.id, closePrice: pos.takeProfit, closeTime: currentTime });
        } else if (pos.side === 'short' && low <= pos.takeProfit) {
          toClose.push({ id: pos.id, closePrice: pos.takeProfit, closeTime: currentTime });
        }
      }

      return updated;
    });

    // Apply state update
    set((state) => {
      let newPositions = updatedPositions;
      let newClosed = state.closedPositions;
      let newBalance = state.balance;

      for (const { id, closePrice, closeTime } of toClose) {
        const pos = newPositions.find((p) => p.id === id);
        if (!pos) continue;
        const pnl =
          pos.side === 'long'
            ? (closePrice - pos.entryPrice) * pos.positionSize * pos.leverage
            : (pos.entryPrice - closePrice) * pos.positionSize * pos.leverage;
        const closedPos: ClosedPosition = {
          ...pos,
          status: 'closed',
          closePrice,
          closeTime,
          pnl,
          pnlPercent: (pnl / (pos.entryPrice * pos.positionSize)) * 100,
          closedAt: new Date(),
        };
        closedPositions.push({ pos, price: closePrice });
        newClosed = [closedPos, ...newClosed];
        newPositions = newPositions.filter((p) => p.id !== id);
        newBalance += pnl;
      }

      const totalEquity = newBalance + newPositions.reduce((s, p) => s + p.pnl, 0);
      return {
        positions: newPositions,
        pendingOrders: remainingPending,
        closedPositions: newClosed,
        balance: newBalance,
        equity: totalEquity,
      };
    });

    return { filled: filledOrders, closed: closedPositions };
  },
}));
