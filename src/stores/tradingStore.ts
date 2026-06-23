// stores/tradingStore.js
import { create } from 'zustand';

export const useTradingStore = create((set, get) => ({
  positions: [],
  closedPositions: [],
  balance: 10000,
  equity: 10000,

  openPosition: (positionData) => {
    const id = crypto.randomUUID();
    const newPosition = {
      ...positionData,
      id,
      pnl: 0,
      pnlPercent: 0,
      status: 'open',
      openedAt: new Date(),
      entryTime: positionData.entryTime || Date.now(), // candle time in ms
      markerId: null,   // will be set by chart
      lineId: null,     // will be set by chart
    };
    set((state) => ({
      positions: [...state.positions, newPosition],
    }));
    return id; // return id for caller to set marker/line
  },

  closePosition: (id, closePrice, closeTime) => {
    set((state) => {
      const position = state.positions.find((p) => p.id === id);
      if (!position) return state;
      const pnl =
        position.side === 'long'
          ? (closePrice - position.entryPrice) * position.positionSize * position.leverage
          : (position.entryPrice - closePrice) * position.positionSize * position.leverage;
      const closedPosition = {
        ...position,
        status: 'closed',
        closePrice,
        closeTime: closeTime || Date.now(),
        pnl,
        pnlPercent: (pnl / (position.entryPrice * position.positionSize)) * 100,
        closedAt: new Date(),
      };
      // Remove marker/line from chart (handled in component)
      return {
        positions: state.positions.filter((p) => p.id !== id),
        closedPositions: [closedPosition, ...state.closedPositions],
        balance: state.balance + pnl,
        equity: state.balance + pnl,
      };
    });
  },

  updatePnLAndCheckSLTP: (currentPrice, currentTime) => {
    const state = get();
    let updatedPositions = state.positions;
    let balance = state.balance;
    const positionsToClose = [];

    updatedPositions = updatedPositions.map((pos) => {
      const pnl =
        pos.side === 'long'
          ? (currentPrice - pos.entryPrice) * pos.positionSize * pos.leverage
          : (pos.entryPrice - currentPrice) * pos.positionSize * pos.leverage;
      const pnlPercent = (pnl / (pos.entryPrice * pos.positionSize)) * 100;
      const updated = { ...pos, pnl, pnlPercent };

      // Check Stop Loss
      if (pos.stopLoss !== undefined) {
        if (pos.side === 'long' && currentPrice <= pos.stopLoss) {
          positionsToClose.push({ id: pos.id, closePrice: pos.stopLoss, closeTime: currentTime });
        } else if (pos.side === 'short' && currentPrice >= pos.stopLoss) {
          positionsToClose.push({ id: pos.id, closePrice: pos.stopLoss, closeTime: currentTime });
        }
      }
      // Check Take Profit
      if (pos.takeProfit !== undefined) {
        if (pos.side === 'long' && currentPrice >= pos.takeProfit) {
          positionsToClose.push({ id: pos.id, closePrice: pos.takeProfit, closeTime: currentTime });
        } else if (pos.side === 'short' && currentPrice <= pos.takeProfit) {
          positionsToClose.push({ id: pos.id, closePrice: pos.takeProfit, closeTime: currentTime });
        }
      }
      return updated;
    });

    if (positionsToClose.length > 0) {
      set((state) => {
        let newPositions = state.positions;
        let newClosed = state.closedPositions;
        let newBalance = state.balance;

        positionsToClose.forEach(({ id, closePrice, closeTime }) => {
          const pos = newPositions.find((p) => p.id === id);
          if (!pos) return;
          const pnl =
            pos.side === 'long'
              ? (closePrice - pos.entryPrice) * pos.positionSize * pos.leverage
              : (pos.entryPrice - closePrice) * pos.positionSize * pos.leverage;
          const closedPos = {
            ...pos,
            status: 'closed',
            closePrice,
            closeTime: closeTime || Date.now(),
            pnl,
            pnlPercent: (pnl / (pos.entryPrice * pos.positionSize)) * 100,
            closedAt: new Date(),
          };
          newClosed = [closedPos, ...newClosed];
          newPositions = newPositions.filter((p) => p.id !== id);
          newBalance += pnl;
        });

        const newEquity = newBalance + newPositions.reduce((sum, p) => sum + p.pnl, 0);
        return {
          positions: newPositions,
          closedPositions: newClosed,
          balance: newBalance,
          equity: newEquity,
        };
      });
    } else {
      set((state) => {
        const totalEquity = state.balance + updatedPositions.reduce((sum, p) => sum + p.pnl, 0);
        return {
          positions: updatedPositions,
          equity: totalEquity,
        };
      });
    }
  },
}));