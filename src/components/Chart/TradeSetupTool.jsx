// components/Chart/TradeSetupTool.jsx
//
// SVG overlay for the Trade Setup drawing tool.
//
// FEATURES
//  • Two-click draw: click 1 = entry price, click 2 = SL price
//    TP is auto-placed at 2:1 R:R.  Long/short auto-detected from SL direction.
//  • All geometry stored as { price, logicalX } so it survives zoom/pan,
//    including draws in FUTURE (empty) space where coordinateToTime returns null.
//  • Each committed zone is a draggable object:
//      – drag entry line  → moves entry price (and limit price if order unfilled)
//      – drag SL line     → moves SL (and updates pending/open order SL)
//      – drag TP line     → moves TP (and updates pending/open order TP)
//      – drag left edge   → moves entry time column
//      – drag right edge  → moves SL/TP time column (box width)
//  • Drawing a new zone removes any zones not yet validated (no positionId).
//  • After order placement the zone is linked to a positionId and status tracks
//    'pending' → 'open' → 'closed'; entry drag is locked once filled.

import React, {
  useEffect, useRef, useState, useCallback, useMemo,
} from 'react';
import { useTradeSetupStore } from '../../stores/tradeSetupStore';
import { useTradingStore } from '../../stores/tradingStore';

const RR_RATIO = 2;

// ─── price helpers ────────────────────────────────────────────────────────────
const roundPrice = (p) => {
  if (p == null || !isFinite(p)) return p;
  if (p >= 1000) return Math.round(p * 10) / 10;
  if (p >= 1)    return Math.round(p * 100) / 100;
  return Math.round(p * 10000) / 10000;
};

const fmtPrice = (p) => {
  if (p == null) return '';
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1)    return p.toFixed(4);
  return p.toFixed(6);
};

// ─── coordinate helpers ───────────────────────────────────────────────────────

/** pixel-Y → price */
const yToPrice = (y, seriesApi) => {
  try { return seriesApi?.coordinateToPrice(y) ?? null; } catch { return null; }
};

/** price → pixel-Y */
const priceToY = (price, seriesApi) => {
  try { return seriesApi?.priceToCoordinate(price) ?? null; } catch { return null; }
};

/**
 * pixel-X → logical index (float).
 * Logical indices work for both past AND future candle positions.
 */
const xToLogical = (x, chartApi) => {
  try { return chartApi?.timeScale().coordinateToLogical(x) ?? null; } catch { return null; }
};

/**
 * logical index → pixel-X.
 * Works for future logical positions too.
 */
const logicalToX = (logical, chartApi) => {
  try { return chartApi?.timeScale().logicalToCoordinate(logical) ?? null; } catch { return null; }
};

/**
 * logical index → UTC timestamp (seconds).
 * For indices within the data range use the series data; for future indices
 * extrapolate based on the last bar's interval.
 */
const logicalToTime = (logical, chartApi, dataRef) => {
  if (logical == null) return null;
  const data = dataRef?.current;
  if (!data || data.length === 0) return logical; // no data, store logical as-is

  const idx = Math.floor(logical);
  if (idx >= 0 && idx < data.length) return data[idx].time;

  // Extrapolate
  if (data.length >= 2) {
    const interval = data[data.length - 1].time - data[data.length - 2].time;
    const overshoot = idx - (data.length - 1);
    return data[data.length - 1].time + overshoot * interval;
  }
  return data[data.length - 1].time;
};

// ─── zone ID counter ──────────────────────────────────────────────────────────
let _zoneIdCounter = 0;
const newZoneId = () => `tsz_${++_zoneIdCounter}`;

// ─── drag hit-test constants ──────────────────────────────────────────────────
const HIT_PX = 8;  // pixels tolerance for line hit-test

// ─── component ────────────────────────────────────────────────────────────────
const TradeSetupTool = ({
  containerRef,
  chartApi,
  seriesApi,
  active,
  dataRef,           // ref to fullDataRef from ChartComponent
  onDone,
  onCancel,
  zones,             // controlled: array of zone objects
  onZonesChange,     // callback to update zones in parent
}) => {
  // ── drawing phase ────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('idle'); // 'idle' | 'entry_set'
  const phaseRef = useRef('idle');
  const entryRef = useRef(null); // { logicalX, price }
  const [entryCursor, setEntryCursor] = useState(null); // live entry point while in 'idle' preview
  const [liveCursor, setLiveCursor] = useState(null);   // live cursor during 'entry_set'

  // ── drag state ───────────────────────────────────────────────────────────
  // dragState: null | { zoneId, handle, startX, startY, startZone }
  const dragStateRef = useRef(null);
  const [, forceRender] = useState(0); // trigger re-render during drag

  // ── hover ────────────────────────────────────────────────────────────────
  const [hoverInfo, setHoverInfo] = useState(null); // { zoneId, handle }

  // ── container size ───────────────────────────────────────────────────────
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!containerRef?.current) return;
    const ro = new ResizeObserver(([e]) =>
      setDims({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(containerRef.current);
    setDims({ w: containerRef.current.clientWidth, h: containerRef.current.clientHeight });
    return () => ro.disconnect();
  }, [containerRef]);

  // ── trading store (for updating orders after drag) ───────────────────────
  const updatePendingOrder = useTradingStore((s) => s.updatePendingOrder);
  const updatePosition     = useTradingStore((s) => s.updatePosition);

  // ── project zone to pixel geometry ───────────────────────────────────────
  const projectZone = useCallback((z) => {
    if (!chartApi || !seriesApi) return null;
    const x1 = logicalToX(z.entryLogicalX, chartApi);
    const x2 = logicalToX(z.slLogicalX, chartApi);
    const entryY = priceToY(z.entryPrice, seriesApi);
    const slY    = priceToY(z.slPrice, seriesApi);
    const tpY    = priceToY(z.tpPrice, seriesApi);
    if (x1 == null || x2 == null || entryY == null || slY == null || tpY == null) return null;
    return { x1, x2, entryY, slY, tpY };
  }, [chartApi, seriesApi]);

  // ── reproject on zoom/pan ────────────────────────────────────────────────
  useEffect(() => {
    if (!chartApi) return;
    const ts = chartApi.timeScale();
    const handle = () => forceRender(n => n + 1);
    ts.subscribeVisibleLogicalRangeChange(handle);
    return () => ts.unsubscribeVisibleLogicalRangeChange(handle);
  }, [chartApi]);

  // Also reproject when price scale changes (vertical zoom/scroll)
  useEffect(() => {
    if (!chartApi) return;
    // lightweight-charts v5: subscribe via chart crosshairMove which fires on all changes
    const handle = () => forceRender(n => n + 1);
    chartApi.subscribeCrosshairMove(handle);
    return () => chartApi.unsubscribeCrosshairMove(handle);
  }, [chartApi]);

  // ── cursor pixel coords from client coords ───────────────────────────────
  const clientToLocal = useCallback((clientX, clientY) => {
    if (!containerRef?.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, [containerRef]);

  // ── hit-test: returns { zoneId, handle } or null ─────────────────────────
  // handles: 'entry_line' | 'sl_line' | 'tp_line' | 'left_edge' | 'right_edge' | 'body'
  const hitTest = useCallback((px, py, zonesArr) => {
    for (const z of zonesArr) {
      const g = projectZone(z);
      if (!g) continue;
      const { x1, x2, entryY, slY, tpY } = g;
      const left  = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const top   = Math.min(entryY, tpY);
      const bot   = Math.max(entryY, slY);

      // Must be horizontally within the zone (with tolerance)
      if (px < left - HIT_PX || px > right + HIT_PX) continue;

      // Horizontal edge drags (left/right edges of the whole box)
      if (Math.abs(px - left) <= HIT_PX && py >= top - HIT_PX && py <= bot + HIT_PX)
        return { zoneId: z.id, handle: 'left_edge' };
      if (Math.abs(px - right) <= HIT_PX && py >= top - HIT_PX && py <= bot + HIT_PX)
        return { zoneId: z.id, handle: 'right_edge' };

      // Must be within y range of full zone
      if (py < top - HIT_PX || py > bot + HIT_PX) continue;

      // Price line drags (check most specific first)
      if (Math.abs(py - tpY)    <= HIT_PX) return { zoneId: z.id, handle: 'tp_line' };
      if (Math.abs(py - slY)    <= HIT_PX) return { zoneId: z.id, handle: 'sl_line' };
      if (Math.abs(py - entryY) <= HIT_PX) return { zoneId: z.id, handle: 'entry_line' };

      // Body drag (move whole zone vertically)
      return { zoneId: z.id, handle: 'body' };
    }
    return null;
  }, [projectZone]);

  // ── apply drag delta to a zone, return updated zone ─────────────────────
  const applyDrag = useCallback((zone, handle, dx, dy) => {
    if (!chartApi || !seriesApi) return zone;
    const g = projectZone(zone);
    if (!g) return zone;

    const clampPrice = (y) => yToPrice(y, seriesApi);
    const clampLogical = (x) => xToLogical(x, chartApi);

    let { entryPrice, slPrice, tpPrice, entryLogicalX, slLogicalX } = zone;

    const isFilled = zone.status === 'open' || zone.status === 'closed';

    if (handle === 'entry_line') {
      if (!isFilled) {
        entryPrice = roundPrice(clampPrice(g.entryY + dy)) ?? entryPrice;
        // Recalculate TP maintaining R:R
        const risk = entryPrice - slPrice;
        tpPrice = roundPrice(entryPrice + risk * RR_RATIO);
      }
    } else if (handle === 'sl_line') {
      slPrice = roundPrice(clampPrice(g.slY + dy)) ?? slPrice;
      const risk = entryPrice - slPrice;
      tpPrice = roundPrice(entryPrice + risk * RR_RATIO);
    } else if (handle === 'tp_line') {
      tpPrice = roundPrice(clampPrice(g.tpY + dy)) ?? tpPrice;
    } else if (handle === 'body') {
      // Move all prices together
      const newEntryY = g.entryY + dy;
      const newSlY    = g.slY + dy;
      const newTpY    = g.tpY + dy;
      entryPrice = roundPrice(clampPrice(newEntryY)) ?? entryPrice;
      slPrice    = roundPrice(clampPrice(newSlY)) ?? slPrice;
      tpPrice    = roundPrice(clampPrice(newTpY)) ?? tpPrice;
    } else if (handle === 'left_edge') {
      if (!isFilled) {
        entryLogicalX = clampLogical(g.x1 + dx) ?? entryLogicalX;
      }
    } else if (handle === 'right_edge') {
      slLogicalX = clampLogical(g.x2 + dx) ?? slLogicalX;
    }

    // Derive side from current prices
    const side = entryPrice > slPrice ? 'long' : 'short';

    return { ...zone, entryPrice, slPrice, tpPrice, entryLogicalX, slLogicalX, side };
  }, [chartApi, seriesApi, projectZone]);

  // ── notify store after drag ends ─────────────────────────────────────────
  const syncZoneToOrder = useCallback((zone) => {
    if (!zone.positionId) return;
    const store = useTradingStore.getState();

    const isFilled = zone.status === 'open';
    const isPending = zone.status === 'pending';

    if (isPending) {
      // Update pending order: entry, SL, TP all adjustable
      const pending = store.pendingOrders.find(o => o.id === zone.positionId);
      if (pending && typeof store.updatePendingOrder === 'function') {
        store.updatePendingOrder(zone.positionId, {
          entryPrice:  zone.entryPrice,
          limitPrice:  zone.entryPrice,
          stopLoss:    zone.slPrice,
          takeProfit:  zone.tpPrice,
        });
      }
    } else if (isFilled) {
      // Entry locked, only SL/TP adjustable
      const pos = store.positions.find(p => p.id === zone.positionId);
      if (pos && typeof store.updatePosition === 'function') {
        store.updatePosition(zone.positionId, {
          stopLoss:   zone.slPrice,
          takeProfit: zone.tpPrice,
        });
      }
    }
  }, []);

  // ── reset drawing when tool deactivated ──────────────────────────────────
  useEffect(() => {
    if (!active) {
      setPhase('idle'); phaseRef.current = 'idle';
      entryRef.current = null;
      setEntryCursor(null);
      setLiveCursor(null);
    }
  }, [active]);

  // ── cursor style ─────────────────────────────────────────────────────────
  // Changes based on active drawing mode or hover handle
  const getCursorStyle = () => {
    if (active) return 'crosshair';
    if (dragStateRef.current) {
      const h = dragStateRef.current.handle;
      if (h === 'left_edge' || h === 'right_edge') return 'ew-resize';
      if (h === 'entry_line' || h === 'sl_line' || h === 'tp_line') return 'ns-resize';
      return 'grabbing';
    }
    if (hoverInfo) {
      const h = hoverInfo.handle;
      if (h === 'left_edge' || h === 'right_edge') return 'ew-resize';
      if (h === 'entry_line' || h === 'sl_line' || h === 'tp_line') return 'ns-resize';
      return 'grab';
    }
    return '';
  };

  useEffect(() => {
    if (!containerRef?.current) return;
    containerRef.current.style.cursor = getCursorStyle();
  });

  // ── pointer events ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef?.current) return;
    const el = containerRef.current;

    const onMouseMove = (e) => {
      const local = clientToLocal(e.clientX, e.clientY);
      if (!local) return;

      // ── if dragging ──
      if (dragStateRef.current) {
        e.stopPropagation();
        e.preventDefault();
        const ds = dragStateRef.current;
        const dx = local.x - ds.startX;
        const dy = local.y - ds.startY;
        const updatedZone = applyDrag(ds.startZone, ds.handle, dx, dy);
        onZonesChange(prev =>
          prev.map(z => z.id === updatedZone.id ? updatedZone : z)
        );
        forceRender(n => n + 1);
        return;
      }

      // ── drawing mode: live preview ──
      if (active) {
        const logical = xToLogical(local.x, chartApi);
        const price   = yToPrice(local.y, seriesApi);
        if (price != null) {
          setLiveCursor({ x: local.x, y: local.y, logicalX: logical, price });
        }
        return;
      }

      // ── hover over committed zones ──
      const hit = hitTest(local.x, local.y, zones);
      setHoverInfo(hit);
    };

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      const local = clientToLocal(e.clientX, e.clientY);
      if (!local) return;

      // ── committed zone drag ──
      if (!active && zones.length > 0) {
        const hit = hitTest(local.x, local.y, zones);
        if (hit) {
          e.stopPropagation();
          e.preventDefault();
          const zone = zones.find(z => z.id === hit.zoneId);
          dragStateRef.current = {
            zoneId: hit.zoneId,
            handle: hit.handle,
            startX: local.x,
            startY: local.y,
            startZone: { ...zone },
          };
          forceRender(n => n + 1);
          return;
        }
      }

      // ── drawing clicks ──
      if (!active) return;

      const logical = xToLogical(local.x, chartApi);
      const price   = yToPrice(local.y, seriesApi);
      if (price == null) return;
      // logical can be null for future space in some versions — use raw pixel offset as fallback
      const logX = logical ?? (local.x / dims.w) * 1000; // arbitrary large logical fallback

      if (phaseRef.current === 'idle') {
        entryRef.current = { logicalX: logX, price };
        phaseRef.current = 'entry_set';
        setPhase('entry_set');

      } else if (phaseRef.current === 'entry_set') {
        e.stopPropagation();
        const entryPrice = roundPrice(entryRef.current.price);
        const slPrice    = roundPrice(price);
        const risk       = entryPrice - slPrice;
        const side       = risk > 0 ? 'long' : 'short';
        const tpPrice    = roundPrice(entryPrice + risk * RR_RATIO);

        const newZone = {
          id: newZoneId(),
          entryLogicalX: entryRef.current.logicalX,
          slLogicalX:    logX,
          entryPrice,
          slPrice,
          tpPrice,
          side,
          status: 'pending_draw',  // not yet linked to an order
          positionId: null,
        };

        // Remove any unvalidated zones before adding new one
        onZonesChange(prev => {
          const validated = prev.filter(z => z.positionId != null);
          return [...validated, newZone];
        });

        // Push to store → TradingPanel pre-fills
        useTradeSetupStore.getState().setSetup({
          entryPrice,
          stopLoss:   slPrice,
          takeProfit: tpPrice,
          side,
          isReady: true,
          requestTradingPanel: true,
          zoneId: newZone.id,
        });

        if (onDone) onDone(newZone);

        // Reset drawing state
        phaseRef.current = 'idle';
        setPhase('idle');
        entryRef.current = null;
        setLiveCursor(null);
        if (onCancel) onCancel(); // resets tool to cursor
      }
    };

    const onMouseUp = (e) => {
      if (!dragStateRef.current) return;
      e.stopPropagation();
      // Sync final drag position to the linked order/position
      const ds = dragStateRef.current;
      const finalZone = zones.find(z => z.id === ds.zoneId);
      if (finalZone) syncZoneToOrder(finalZone);
      dragStateRef.current = null;
      forceRender(n => n + 1);
    };

    const onMouseLeave = () => {
      setLiveCursor(null);
      if (!dragStateRef.current) setHoverInfo(null);
    };

    el.addEventListener('mousemove',  onMouseMove, { passive: false });
    el.addEventListener('mousedown',  onMouseDown, { capture: true });
    el.addEventListener('mouseup',    onMouseUp);
    el.addEventListener('mouseleave', onMouseLeave);
    return () => {
      el.removeEventListener('mousemove',  onMouseMove);
      el.removeEventListener('mousedown',  onMouseDown, { capture: true });
      el.removeEventListener('mouseup',    onMouseUp);
      el.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [active, zones, chartApi, seriesApi, containerRef, clientToLocal,
      hitTest, applyDrag, onZonesChange, syncZoneToOrder, onDone, onCancel, dims.w]);

  // Global mouseup in case cursor leaves container during drag
  useEffect(() => {
    const onUp = (e) => {
      if (!dragStateRef.current) return;
      const ds = dragStateRef.current;
      const finalZone = zones.find(z => z.id === ds.zoneId);
      if (finalZone) syncZoneToOrder(finalZone);
      dragStateRef.current = null;
      forceRender(n => n + 1);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [zones, syncZoneToOrder]);

  // ── Escape ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (phaseRef.current !== 'idle') {
        phaseRef.current = 'idle';
        setPhase('idle');
        entryRef.current = null;
        setLiveCursor(null);
        useTradeSetupStore.getState().clearSetup();
        if (onCancel) onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // ─── render ────────────────────────────────────────────────────────────────

  const SL_COLOR    = '#f23645';
  const TP_COLOR    = '#089981';
  const ENTRY_COLOR = '#c4c9d4';
  const FILL_COLOR  = '#2962ff';
  const PENDING_FILL = '#f0a500';

  // ── ZoneGraphic ──────────────────────────────────────────────────────────
  const ZoneGraphic = ({ zone, geom, isHovered, isDragging, isLive = false }) => {
    if (!geom) return null;
    const { x1, x2, entryY, slY, tpY } = geom;
    const left  = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const width = right - left;
    if (width < 1) return null;

    const isFilled  = zone?.status === 'open';
    const isPending = zone?.status === 'pending';
    const entryLocked = isFilled;
    const alpha = isLive ? 1 : (isDragging ? 1 : 0.88);

    // Entry line color: blue if linked+pending, white if open/locked, grey otherwise
    const entryLineColor = isPending ? PENDING_FILL : (isFilled ? ENTRY_COLOR : ENTRY_COLOR);

    const entryPrice = zone?.entryPrice ?? null;
    const slPrice    = zone?.slPrice ?? null;
    const tpPrice    = zone?.tpPrice ?? null;

    const labelX = right + 6;

    // Handle highlight styles
    const hHand = isHovered?.handle;
    const dHand = isDragging?.handle;
    const activeHandle = dHand ?? hHand;

    const lineW = (handle) => activeHandle === handle ? 2.5 : 1.5;
    const lineOpacity = (handle) => activeHandle === handle ? 1 : 0.85;

    return (
      <g opacity={alpha}>
        {/* SL fill box */}
        <rect
          x={left} y={Math.min(entryY, slY)}
          width={width} height={Math.abs(slY - entryY)}
          fill={SL_COLOR} fillOpacity={activeHandle === 'sl_line' ? 0.22 : 0.13}
          stroke="none"
        />
        {/* TP fill box */}
        <rect
          x={left} y={Math.min(entryY, tpY)}
          width={width} height={Math.abs(tpY - entryY)}
          fill={TP_COLOR} fillOpacity={activeHandle === 'tp_line' ? 0.22 : 0.13}
          stroke="none"
        />

        {/* Outer border of whole zone */}
        <rect
          x={left} y={Math.min(tpY, slY)}
          width={width} height={Math.abs(slY - tpY)}
          fill="none"
          stroke={isHovered || isDragging ? '#4a90d9' : '#3a3e4a'}
          strokeWidth={isHovered || isDragging ? 1.5 : 1}
          strokeOpacity={0.6}
        />

        {/* TP line */}
        <line x1={left} y1={tpY} x2={right} y2={tpY}
          stroke={TP_COLOR} strokeWidth={lineW('tp_line')}
          strokeOpacity={lineOpacity('tp_line')} />
        {/* Entry line */}
        <line x1={left} y1={entryY} x2={right} y2={entryY}
          stroke={entryLineColor} strokeWidth={lineW('entry_line')}
          strokeDasharray={entryLocked ? '3 2' : undefined}
          strokeOpacity={lineOpacity('entry_line')} />
        {/* SL line */}
        <line x1={left} y1={slY} x2={right} y2={slY}
          stroke={SL_COLOR} strokeWidth={lineW('sl_line')}
          strokeOpacity={lineOpacity('sl_line')} />

        {/* Left edge drag handle */}
        {!isLive && (
          <rect x={left - 2} y={Math.min(tpY, slY)}
            width={4} height={Math.abs(slY - tpY)}
            fill={activeHandle === 'left_edge' ? '#4a90d9' : 'transparent'}
            stroke={activeHandle === 'left_edge' ? '#4a90d9' : '#555'}
            strokeWidth={1} style={{ cursor: 'ew-resize' }} />
        )}
        {/* Right edge drag handle */}
        {!isLive && (
          <rect x={right - 2} y={Math.min(tpY, slY)}
            width={4} height={Math.abs(slY - tpY)}
            fill={activeHandle === 'right_edge' ? '#4a90d9' : 'transparent'}
            stroke={activeHandle === 'right_edge' ? '#4a90d9' : '#555'}
            strokeWidth={1} style={{ cursor: 'ew-resize' }} />
        )}

        {/* Drag handle dots on each line */}
        {!isLive && [
          { y: tpY,    handle: 'tp_line',    col: TP_COLOR },
          { y: entryY, handle: 'entry_line', col: entryLineColor, locked: entryLocked },
          { y: slY,    handle: 'sl_line',    col: SL_COLOR },
        ].map(({ y, handle, col, locked }) => (
          <g key={handle}>
            <circle cx={(left + right) / 2} cy={y} r={4}
              fill={col} fillOpacity={activeHandle === handle ? 0.9 : 0.5}
              stroke={col} strokeWidth={1}
              style={{ cursor: locked ? 'not-allowed' : 'ns-resize' }}
            />
            {locked && (
              // Lock icon hint
              <text x={(left + right) / 2 + 7} y={y + 4}
                fill={col} fontSize={9} opacity={0.7}
                fontFamily="sans-serif" style={{ pointerEvents: 'none' }}>🔒</text>
            )}
          </g>
        ))}

        {/* Price labels */}
        {tpPrice != null && (
          <text x={labelX} y={tpY + 4} fill={TP_COLOR}
            fontSize={10} fontWeight="600" fontFamily="'Inter',sans-serif"
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {fmtPrice(tpPrice)}
          </text>
        )}
        {entryPrice != null && (
          <text x={labelX} y={entryY + 4} fill={entryLineColor}
            fontSize={10} fontWeight="600" fontFamily="'Inter',sans-serif"
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {fmtPrice(entryPrice)}
            {entryLocked ? ' 🔒' : ''}
          </text>
        )}
        {slPrice != null && (
          <text x={labelX} y={slY + 4} fill={SL_COLOR}
            fontSize={10} fontWeight="600" fontFamily="'Inter',sans-serif"
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {fmtPrice(slPrice)}
          </text>
        )}

        {/* R:R labels inside boxes */}
        {width > 40 && Math.abs(tpY - entryY) > 16 && (
          <text x={left + width / 2} y={(entryY + tpY) / 2 + 4}
            fill={TP_COLOR} fontSize={10} fontWeight="700"
            fontFamily="'Inter',sans-serif" textAnchor="middle"
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {RR_RATIO}R
          </text>
        )}
        {width > 40 && Math.abs(slY - entryY) > 16 && (
          <text x={left + width / 2} y={(entryY + slY) / 2 + 4}
            fill={SL_COLOR} fontSize={10} fontWeight="700"
            fontFamily="'Inter',sans-serif" textAnchor="middle"
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
            1R
          </text>
        )}

        {/* Status badge */}
        {!isLive && zone?.status && zone.status !== 'pending_draw' && (
          <text x={left + 4} y={Math.min(tpY, slY) + 12}
            fill={isPending ? PENDING_FILL : isFilled ? FILL_COLOR : '#aaa'}
            fontSize={9} fontWeight="700" fontFamily="'Inter',sans-serif"
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {isPending ? '⏳ PENDING' : isFilled ? '● OPEN' : zone.status.toUpperCase()}
          </text>
        )}
      </g>
    );
  };

  // ── live preview geometry ────────────────────────────────────────────────
  const liveGeom = useMemo(() => {
    if (!active || phase !== 'entry_set' || !entryRef.current || !liveCursor) return null;
    const x1 = logicalToX(entryRef.current.logicalX, chartApi) ?? liveCursor.x;
    const x2 = liveCursor.x;
    const entryY = priceToY(entryRef.current.price, seriesApi);
    const slY    = liveCursor.y;
    if (entryY == null) return null;
    const risk = entryRef.current.price - liveCursor.price;
    const tpPrice = entryRef.current.price + risk * RR_RATIO;
    const tpY = priceToY(tpPrice, seriesApi) ?? (entryY - (slY - entryY) * RR_RATIO);
    return { x1, x2, entryY, slY, tpY };
  }, [active, phase, liveCursor, chartApi, seriesApi]);

  const liveZone = useMemo(() => {
    if (!entryRef.current || !liveCursor) return null;
    const risk = entryRef.current.price - liveCursor.price;
    return {
      entryPrice: roundPrice(entryRef.current.price),
      slPrice:    roundPrice(liveCursor.price),
      tpPrice:    roundPrice(entryRef.current.price + risk * RR_RATIO),
      status: 'pending_draw',
    };
  }, [liveCursor]);

  if (!active && zones.length === 0) return null;

  return (
    <svg
      style={{
        position: 'absolute', inset: 0,
        width: dims.w, height: dims.h,
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
    >
      {/* Committed zones */}
      {zones.map((z) => {
        const g = projectZone(z);
        return (
          <ZoneGraphic
            key={z.id}
            zone={z}
            geom={g}
            isHovered={hoverInfo?.zoneId === z.id ? hoverInfo : null}
            isDragging={dragStateRef.current?.zoneId === z.id ? dragStateRef.current : null}
          />
        );
      })}

      {/* Live in-progress drawing */}
      {active && phase === 'entry_set' && liveGeom && (
        <ZoneGraphic zone={liveZone} geom={liveGeom} isLive />
      )}

      {/* Cursor dot */}
      {active && liveCursor && phase === 'idle' && (
        <circle cx={liveCursor.x} cy={liveCursor.y} r={4}
          fill="#2962ff" fillOpacity={0.8} style={{ pointerEvents: 'none' }} />
      )}
      {active && liveCursor && phase === 'entry_set' && (
        <circle cx={liveCursor.x} cy={liveCursor.y} r={4}
          fill="none" stroke="#d1d4dc" strokeWidth={1.5}
          style={{ pointerEvents: 'none' }} />
      )}
    </svg>
  );
};

export default TradeSetupTool;
