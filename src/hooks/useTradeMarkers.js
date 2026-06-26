// hooks/useTradeMarkers.js
//
// Manages chart markers and entry/SL/TP horizontal lines for all positions.
//
// Data source: useTradingStore (Zustand) — which is itself a mirror of
// ExecutionEngine state kept in sync via EventBus. This hook reads
// positions reactively from the store; no direct EventBus subscription
// is needed here because Zustand already handles the fan-out.
//
// - Markers pinned to exact fill candle timestamp
// - Lines drawn on ALL charts whose symbol matches the trade's symbol
// - When prices change (drag update), existing lines are repositioned via
//   updateHorizontalLine() rather than removed+recreated
// - On close: lines removed, entry marker stays as visual history

import { useEffect, useRef } from 'react';
import { useTradingStore } from '../stores/tradingStore';
import { EventBus, Events } from '../core/EventBus';

export const useTradeMarkers = (chartRefs, activeChartId, charts = []) => {
  const positions       = useTradingStore((s) => s.positions);
  const pendingOrders   = useTradingStore((s) => s.pendingOrders);
  const closedPositions = useTradingStore((s) => s.closedPositions);

  // drawnRef[posId][chartId] = { markerId, lineId, slLineId, tpLineId,
  //                               drawnEntryPrice, drawnSL, drawnTP }
  const drawnRef     = useRef({});
  const drawnExitRef = useRef({}); // Set of chartIds per closedPos id

  // ── Main draw effect — re-runs whenever positions change ───────────────
  useEffect(() => {
    // Build chartId → { ref, symbol } map
    const chartInfoMap = {};
    for (const chart of charts) {
      const ref = chartRefs.current?.[chart.id];
      if (ref) chartInfoMap[chart.id] = { ref, symbol: chart.symbol };
    }
    if (Object.keys(chartInfoMap).length === 0) {
      const ref = chartRefs.current?.[activeChartId];
      if (ref) chartInfoMap[activeChartId] = { ref, symbol: null };
    }

    // ── helpers ──────────────────────────────────────────────────────────
    const addMarker = (ref, time, price, text, color, kind) =>
      typeof ref.addMarker === 'function'
        ? ref.addMarker(time, price, text, color, kind)
        : null;

    const addLine = (ref, price, color, label) =>
      typeof ref.addHorizontalLine === 'function'
        ? ref.addHorizontalLine(price, color, label)
        : null;

    const updateLine = (ref, id, price) => {
      if (id && typeof ref.updateHorizontalLine === 'function') {
        ref.updateHorizontalLine(id, price);
      }
    };

    const removeLine = (ref, id) => {
      if (id && typeof ref.removeObject === 'function')
        ref.removeObject(id, 'line');
    };

    // ── Active ids ────────────────────────────────────────────────────────
    const activeIds = new Set([
      ...positions.map((p) => p.id),
      ...pendingOrders.map((p) => p.id),
    ]);

    // ── Draw or update lines for open/pending positions ───────────────────
    for (const pos of [...positions, ...pendingOrders]) {
      if (!drawnRef.current[pos.id]) drawnRef.current[pos.id] = {};

      const isPending    = pos.status === 'pending';
      const entryColor   = pos.side === 'long' ? '#00b894' : '#ff6b6b';
      const pendingColor = '#f0a500';
      const lineColor    = isPending ? pendingColor : entryColor;
      const markerColor  = lineColor;
      const markerLabel  = isPending
        ? (pos.side === 'long' ? '⏳B' : '⏳S')
        : (pos.side === 'long' ? 'B' : 'S');
      const markerTime   = pos.filledTime ?? pos.entryTime;

      for (const [chartId, { ref, symbol }] of Object.entries(chartInfoMap)) {
        if (symbol !== null && symbol !== pos.symbol) continue;

        const existing = drawnRef.current[pos.id][chartId];

        if (!existing) {
          // ── First draw ────────────────────────────────────────────────
          const markerId = addMarker(
            ref, markerTime, pos.entryPrice, markerLabel, markerColor,
            pos.side === 'long' ? 'buy' : 'sell'
          );
          const lineId  = addLine(ref, pos.entryPrice, lineColor,
            isPending ? `Limit ${pos.side.toUpperCase()}` : `Entry ${pos.side.toUpperCase()}`);
          const slLineId = (!isPending && pos.stopLoss)
            ? addLine(ref, pos.stopLoss, '#ff4444', 'SL') : null;
          const tpLineId = (!isPending && pos.takeProfit)
            ? addLine(ref, pos.takeProfit, '#00cc88', 'TP') : null;

          drawnRef.current[pos.id][chartId] = {
            markerId, lineId, slLineId, tpLineId,
            drawnEntryPrice: pos.entryPrice,
            drawnSL: pos.stopLoss,
            drawnTP: pos.takeProfit,
          };

        } else {
          // ── Already drawn — update lines if prices changed ────────────
          if (existing.drawnEntryPrice !== pos.entryPrice) {
            updateLine(ref, existing.lineId, pos.entryPrice);
            existing.drawnEntryPrice = pos.entryPrice;
          }

          // SL line
          if (pos.stopLoss && !isPending) {
            if (!existing.slLineId) {
              existing.slLineId = addLine(ref, pos.stopLoss, '#ff4444', 'SL');
              existing.drawnSL = pos.stopLoss;
            } else if (existing.drawnSL !== pos.stopLoss) {
              updateLine(ref, existing.slLineId, pos.stopLoss);
              existing.drawnSL = pos.stopLoss;
            }
          }

          // TP line
          if (pos.takeProfit && !isPending) {
            if (!existing.tpLineId) {
              existing.tpLineId = addLine(ref, pos.takeProfit, '#00cc88', 'TP');
              existing.drawnTP = pos.takeProfit;
            } else if (existing.drawnTP !== pos.takeProfit) {
              updateLine(ref, existing.tpLineId, pos.takeProfit);
              existing.drawnTP = pos.takeProfit;
            }
          }
        }
      }
    }

    // ── Remove lines when positions close (keep entry markers) ────────────
    for (const [posId, chartMap] of Object.entries(drawnRef.current)) {
      if (activeIds.has(posId)) continue;
      for (const [chartId, drawn] of Object.entries(chartMap)) {
        const ref = chartInfoMap[chartId]?.ref;
        if (!ref) continue;
        removeLine(ref, drawn.lineId);
        if (drawn.slLineId) removeLine(ref, drawn.slLineId);
        if (drawn.tpLineId) removeLine(ref, drawn.tpLineId);
        // entry marker intentionally kept as visual trade history
      }
      delete drawnRef.current[posId];
    }

    // ── Draw exit markers for closed positions ────────────────────────────
    for (const pos of closedPositions) {
      if (!drawnExitRef.current[pos.id]) drawnExitRef.current[pos.id] = new Set();
      for (const [chartId, { ref, symbol }] of Object.entries(chartInfoMap)) {
        if (symbol !== null && symbol !== pos.symbol) continue;
        if (drawnExitRef.current[pos.id].has(chartId)) continue;
        drawnExitRef.current[pos.id].add(chartId);
        if (pos.closeTime && pos.closePrice) {
          const sign  = pos.pnl >= 0 ? '+' : '';
          const color = pos.pnl >= 0 ? '#00b894' : '#ff4444';
          addMarker(ref, pos.closeTime, pos.closePrice,
            `✕ ${sign}${pos.pnl.toFixed(2)}`, color, 'close');
        }
      }
    }
  }, [positions, pendingOrders, closedPositions, chartRefs, activeChartId, charts]);

  // ── Also subscribe to POSITION_CLOSED via EventBus for immediate
  //    visual response (before Zustand batches a re-render) ────────────────
  useEffect(() => {
    // EventBus fires synchronously; the Zustand update above fires on next
    // render. This is kept as a safety net so exit markers appear instantly.
    const unsub = EventBus.on(Events.POSITION_CLOSED, ({ position }) => {
      if (!position?.id) return;
      if (!drawnExitRef.current[position.id]) {
        drawnExitRef.current[position.id] = new Set();
      }
    });
    return unsub;
  }, []);

  useEffect(() => () => {
    drawnRef.current     = {};
    drawnExitRef.current = {};
  }, []);
};
