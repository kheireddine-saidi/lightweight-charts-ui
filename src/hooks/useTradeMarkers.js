// hooks/useTradeMarkers.js
import { useEffect, useRef } from 'react';
import { useTradingStore } from '../stores/tradingStore';

export const useTradeMarkers = (chartRef, activeChartId) => {
  const positions = useTradingStore((state) => state.positions);
  const closedPositions = useTradingStore((state) => state.closedPositions);
  const markersRef = useRef({}); // map position id -> { markerId, lineId }

  useEffect(() => {
    const ref = chartRef.current?.[activeChartId];
    if (!ref) return;

    // Helper to add marker at given time and price
    const addMarker = (time, price, text, color) => {
      if (typeof ref.addMarker === 'function') {
        return ref.addMarker(time, price, text, color);
      }
      // Fallback: use addPriceAlert? Not ideal, but we can log.
      console.warn('addMarker not available on chart ref');
      return null;
    };

    const addHorizontalLine = (price, color, label) => {
      if (typeof ref.addHorizontalLine === 'function') {
        return ref.addHorizontalLine(price, color, label);
      }
      console.warn('addHorizontalLine not available on chart ref');
      return null;
    };

    const removeObject = (id) => {
      if (typeof ref.removeObject === 'function') {
        ref.removeObject(id);
      }
    };

    // Process current open positions: add markers/lines if not already
    positions.forEach((pos) => {
      if (markersRef.current[pos.id]) return; // already drawn

      const side = pos.side === 'long' ? 'B' : 'S';
      const color = pos.side === 'long' ? '#00b894' : '#ff6b6b';

      // Add marker at entry
      const markerId = addMarker(pos.entryTime, pos.entryPrice, side, color);
      // Add horizontal line at entry price
      const lineId = addHorizontalLine(pos.entryPrice, color, `Entry ${pos.side.toUpperCase()}`);

      markersRef.current[pos.id] = { markerId, lineId };
    });

    // Process closed positions: remove their markers/lines and add exit marker
    // We need to know which positions were just closed. We can compare previous and current.
    // Simpler: each time we run, for all closed positions that have no exit marker yet, add it.
    // But we also need to remove lines for positions that were open previously.
    // We'll track which closed positions we've processed.
    // We'll use a separate ref to remember closed positions we've handled.
    if (!window._processedClosed) window._processedClosed = new Set();

    closedPositions.forEach((pos) => {
      if (window._processedClosed.has(pos.id)) return;
      window._processedClosed.add(pos.id);

      // Remove entry marker and line if they still exist (they should have been removed when position closed)
      // But we might have already removed them in the open positions loop (since they are not in positions)
      // So we just add an exit marker.
      const side = pos.side === 'long' ? 'B' : 'S';
      const color = pos.side === 'long' ? '#00b894' : '#ff6b6b';
      const exitText = side + ' (exit)';
      // Add marker at exit time (closeTime)
      if (pos.closeTime) {
        addMarker(pos.closeTime, pos.closePrice, exitText, color);
      }
    });

    // Cleanup: if a position is no longer in open positions but still has markers, remove them
    // We'll do this by checking markersRef against current positions
    const currentIds = new Set(positions.map(p => p.id));
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        // position closed, remove its marker and line
        const { markerId, lineId } = markersRef.current[id];
        if (markerId) removeObject(markerId);
        if (lineId) removeObject(lineId);
        delete markersRef.current[id];
      }
    });

    // Cleanup function: when component unmounts, remove all remaining markers/lines
    return () => {
      Object.values(markersRef.current).forEach(({ markerId, lineId }) => {
        if (markerId) removeObject(markerId);
        if (lineId) removeObject(lineId);
      });
      markersRef.current = {};
      window._processedClosed = new Set();
    };
  }, [positions, closedPositions, chartRef, activeChartId]);
};