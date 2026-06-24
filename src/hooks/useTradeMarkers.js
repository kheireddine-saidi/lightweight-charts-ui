// hooks/useTradeMarkers.js
// Manages chart markers and entry lines for open/closed trade positions.
// Markers are pinned to the exact fill candle. Drawings appear on ALL charts
// whose symbol matches the trade's symbol (regardless of timeframe).
// On close: the horizontal entry line is removed, but the entry marker stays.

import { useEffect, useRef } from 'react';
import { useTradingStore } from '../stores/tradingStore';

export const useTradeMarkers = (chartRefs, activeChartId, charts = []) => {
  const positions = useTradingStore((state) => state.positions);
  const pendingOrders = useTradingStore((state) => state.pendingOrders);
  const closedPositions = useTradingStore((state) => state.closedPositions);

  // Track drawn objects per position per chartId:
  // { [posId]: { [chartId]: { markerId, lineId, slLineId, tpLineId } } }
  const drawnRef = useRef({});
  // Track which closed positions we've drawn exit markers for, per chartId
  // { [posId]: Set<chartId> }
  const drawnExitRef = useRef({});

  useEffect(() => {
    // Build a map of chartId -> { ref, symbol }
    const chartInfoMap = {};
    for (const chart of charts) {
      const ref = chartRefs.current?.[chart.id];
      if (ref) {
        chartInfoMap[chart.id] = { ref, symbol: chart.symbol };
      }
    }
    // Fallback: if no charts provided, just use activeChartId
    if (Object.keys(chartInfoMap).length === 0) {
      const ref = chartRefs.current?.[activeChartId];
      if (ref) chartInfoMap[activeChartId] = { ref, symbol: null };
    }

    const addMarkerToRef = (ref, time, price, text, color, kind) => {
      if (typeof ref.addMarker === 'function') {
        return ref.addMarker(time, price, text, color, kind);
      }
      return null;
    };

    const addHorizontalLineToRef = (ref, price, color, label) => {
      if (typeof ref.addHorizontalLine === 'function') {
        return ref.addHorizontalLine(price, color, label);
      }
      return null;
    };

    const removeLineFromRef = (ref, id) => {
      if (id != null && typeof ref.removeObject === 'function') {
        ref.removeObject(id, 'line');
      }
    };

    const removeMarkerFromRef = (ref, id) => {
      if (id != null && typeof ref.removeObject === 'function') {
        ref.removeObject(id, 'marker');
      }
    };

    // Active position/order ids
    const activeIds = new Set([
      ...positions.map((p) => p.id),
      ...pendingOrders.map((p) => p.id),
    ]);

    // --- Draw entry markers/lines for open/pending positions ---
    for (const pos of [...positions, ...pendingOrders]) {
      if (!drawnRef.current[pos.id]) drawnRef.current[pos.id] = {};

      for (const [chartId, { ref, symbol }] of Object.entries(chartInfoMap)) {
        // Only draw on charts with matching symbol (or if symbol is unknown)
        if (symbol !== null && symbol !== pos.symbol) continue;
        if (drawnRef.current[pos.id][chartId]) continue; // already drawn on this chart

        const isPending = pos.status === 'pending';
        const color = pos.side === 'long' ? '#00b894' : '#ff6b6b';
        const pendingColor = '#f0a500';
        const markerColor = isPending ? pendingColor : color;

        // For market orders: filledTime is set by updatePnLAndCheckSLTP at fill
        // For limit orders: filledTime is set when limit fills
        // entryTime is the candle time when order was placed (from currentTime prop)
        // Use filledTime if available (the actual fill candle), otherwise entryTime
        const markerTime = pos.filledTime ?? pos.entryTime;

        const label = isPending
          ? (pos.side === 'long' ? '⏳B' : '⏳S')
          : (pos.side === 'long' ? 'B' : 'S');

        const kind = pos.side === 'long' ? 'buy' : 'sell';

        const markerId = addMarkerToRef(ref, markerTime, pos.entryPrice, label, markerColor, kind);
        const lineId = addHorizontalLineToRef(
          ref,
          pos.entryPrice,
          isPending ? pendingColor : color,
          isPending ? `Limit ${pos.side.toUpperCase()}` : `Entry ${pos.side.toUpperCase()}`
        );

        let slLineId = null;
        let tpLineId = null;
        if (!isPending && pos.stopLoss) {
          slLineId = addHorizontalLineToRef(ref, pos.stopLoss, '#ff4444', 'SL');
        }
        if (!isPending && pos.takeProfit) {
          tpLineId = addHorizontalLineToRef(ref, pos.takeProfit, '#00cc88', 'TP');
        }

        drawnRef.current[pos.id][chartId] = { markerId, lineId, slLineId, tpLineId };
      }
    }

    // --- When positions close: remove only the lines, keep the entry marker ---
    for (const [posId, chartMap] of Object.entries(drawnRef.current)) {
      if (!activeIds.has(posId)) {
        for (const [chartId, drawn] of Object.entries(chartMap)) {
          const ref = chartInfoMap[chartId]?.ref;
          if (!ref) continue;
          // Remove entry line, SL line, TP line — but NOT the entry marker
          removeLineFromRef(ref, drawn.lineId);
          if (drawn.slLineId) removeLineFromRef(ref, drawn.slLineId);
          if (drawn.tpLineId) removeLineFromRef(ref, drawn.tpLineId);
          // Keep markerId alive (visual history)
        }
        delete drawnRef.current[posId];
      }
    }

    // --- Draw exit markers for newly closed positions ---
    for (const pos of closedPositions) {
      if (!drawnExitRef.current[pos.id]) drawnExitRef.current[pos.id] = new Set();

      for (const [chartId, { ref, symbol }] of Object.entries(chartInfoMap)) {
        if (symbol !== null && symbol !== pos.symbol) continue;
        if (drawnExitRef.current[pos.id].has(chartId)) continue;
        drawnExitRef.current[pos.id].add(chartId);

        if (pos.closeTime && pos.closePrice) {
          const pnlSign = pos.pnl >= 0 ? '+' : '';
          const exitKind = pos.side === 'long' ? 'sell' : 'buy'; // exit marker: opposite direction arrow
          const exitColor = pos.pnl >= 0 ? '#00b894' : '#ff4444';
          const exitLabel = `✕ ${pnlSign}${pos.pnl.toFixed(2)}`;
          addMarkerToRef(ref, pos.closeTime, pos.closePrice, exitLabel, exitColor, 'close');
        }
      }
    }
  }, [positions, pendingOrders, closedPositions, chartRefs, activeChartId, charts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      drawnRef.current = {};
      drawnExitRef.current = {};
    };
  }, []);
};
