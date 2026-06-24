// hooks/useTradeMarkers.js
// Manages chart markers and entry lines for open/closed trade positions.
// Uses createSeriesMarkers (v5) via ChartComponent.addMarker so markers are
// pinned to the exact fill candle with proper arrow shapes (B/S labels).

import { useEffect, useRef } from 'react';
import { useTradingStore } from '../stores/tradingStore';

export const useTradeMarkers = (chartRefs, activeChartId) => {
  const positions = useTradingStore((state) => state.positions);
  const pendingOrders = useTradingStore((state) => state.pendingOrders);
  const closedPositions = useTradingStore((state) => state.closedPositions);

  // Track drawn objects per position: posId -> { markerId, lineId, slLineId, tpLineId }
  const drawnRef = useRef({});
  // Track which closed positions we've drawn exit markers for
  const drawnExitRef = useRef(new Set());

  useEffect(() => {
    const ref = chartRefs.current?.[activeChartId];
    if (!ref) return;

    /**
     * @param {number} time   – Unix timestamp of the fill candle (seconds)
     * @param {number} price  – fill / entry price
     * @param {string} text   – short label shown on the marker
     * @param {string} color  – hex colour
     * @param {'buy'|'sell'|'close'} kind – controls arrow shape & position
     */
    const addMarker = (time, price, text, color, kind) => {
      if (typeof ref.addMarker === 'function') {
        return ref.addMarker(time, price, text, color, kind);
      }
      return null;
    };

    const addHorizontalLine = (price, color, label) => {
      if (typeof ref.addHorizontalLine === 'function') {
        return ref.addHorizontalLine(price, color, label);
      }
      return null;
    };

    const removeLine = (id) => {
      if (id !== null && id !== undefined && typeof ref.removeObject === 'function') {
        ref.removeObject(id, 'line');
      }
    };

    const removeMarker = (id) => {
      if (id !== null && id !== undefined && typeof ref.removeObject === 'function') {
        ref.removeObject(id, 'marker');
      }
    };

    // --- Draw entry markers/lines for open positions ---
    const activeIds = new Set([
      ...positions.map((p) => p.id),
      ...pendingOrders.map((p) => p.id),
    ]);

    for (const pos of [...positions, ...pendingOrders]) {
      if (drawnRef.current[pos.id]) continue; // already drawn

      const isPending = pos.status === 'pending';
      const color = pos.side === 'long' ? '#00b894' : '#ff6b6b';
      const pendingColor = '#f0a500';
      const markerColor = isPending ? pendingColor : color;

      // Use filledTime for limit orders that have been filled, entryTime otherwise
      const markerTime = pos.filledTime ?? pos.entryTime;

      // Label: "B" for buy/long, "S" for sell/short; pending prefix with ⏳
      const label = isPending
        ? (pos.side === 'long' ? '⏳B' : '⏳S')
        : (pos.side === 'long' ? 'B' : 'S');

      // kind drives the arrow direction in ChartComponent.addMarker
      const kind = pos.side === 'long' ? 'buy' : 'sell';

      const markerId = addMarker(markerTime, pos.entryPrice, label, markerColor, kind);
      const lineId = addHorizontalLine(
        pos.entryPrice,
        isPending ? pendingColor : color,
        isPending ? `Limit ${pos.side.toUpperCase()}` : `Entry ${pos.side.toUpperCase()}`
      );

      let slLineId = null;
      let tpLineId = null;

      if (!isPending && pos.stopLoss) {
        slLineId = addHorizontalLine(pos.stopLoss, '#ff4444', 'SL');
      }
      if (!isPending && pos.takeProfit) {
        tpLineId = addHorizontalLine(pos.takeProfit, '#00cc88', 'TP');
      }

      drawnRef.current[pos.id] = { markerId, lineId, slLineId, tpLineId };
    }

    // --- Remove lines/markers for positions that are no longer open/pending ---
    for (const [id, drawn] of Object.entries(drawnRef.current)) {
      if (!activeIds.has(id)) {
        removeLine(drawn.lineId);
        removeMarker(drawn.markerId);
        if (drawn.slLineId) removeLine(drawn.slLineId);
        if (drawn.tpLineId) removeLine(drawn.tpLineId);
        delete drawnRef.current[id];
      }
    }

    // --- Draw exit markers for newly closed positions ---
    for (const pos of closedPositions) {
      if (drawnExitRef.current.has(pos.id)) continue;
      drawnExitRef.current.add(pos.id);

      if (pos.closeTime && pos.closePrice) {
        const pnlSign = pos.pnl >= 0 ? '+' : '';
        const exitKind = 'close';
        const exitColor = pos.pnl >= 0 ? '#00b894' : '#ff4444';
        const exitLabel = `✕ ${pnlSign}${pos.pnl.toFixed(2)}`;
        addMarker(pos.closeTime, pos.closePrice, exitLabel, exitColor, exitKind);
      }
    }
  }, [positions, pendingOrders, closedPositions, chartRefs, activeChartId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      drawnRef.current = {};
      drawnExitRef.current = new Set();
    };
  }, []);
};
