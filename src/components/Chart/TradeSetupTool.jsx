// components/Chart/TradeSetupTool.jsx
//
// SVG overlay for the Trade Setup drawing tool.
//
// KEY DESIGN: pointer-event isolation
//   The outer SVG is always pointer-events:none so the chart gets all normal
//   events (pan, zoom, crosshair).  Only the interactive handle elements inside
//   the SVG have pointer-events:all.  We capture mousedown on those elements
//   directly (React synthetic events), then attach a temporary window-level
//   mousemove/mouseup pair for the drag, ensuring the chart never sees the drag.
//
// SELECTION: click a zone to select it; click empty space or Escape to deselect.
//   While selected a Delete button appears.  Delete cancels pending orders or
//   closes open positions at market price.

import React, {
  useEffect, useRef, useState, useCallback, useMemo,
} from 'react';
import { useTradeSetupStore } from '../../stores/tradeSetupStore';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore } from '../../stores/marketStore';
import { getMagnetPoint } from '../../utils/magnetSnap';
import { useChartSettingsStore } from '../../stores/chartSettingsStore';

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
const yToPrice  = (y, s)       => { try { return s?.coordinateToPrice(y) ?? null; } catch { return null; } };
const priceToY  = (p, s)       => { try { return s?.priceToCoordinate(p) ?? null; } catch { return null; } };
const xToLogical = (x, c)      => { try { return c?.timeScale().coordinateToLogical(x) ?? null; } catch { return null; } };
const logicalToX = (l, c)      => { try { return c?.timeScale().logicalToCoordinate(l) ?? null; } catch { return null; } };

// ─── zone ID counter ──────────────────────────────────────────────────────────
let _zid = 0;
const newZoneId = () => `tsz_${++_zid}`;

// ─── hit tolerances ──────────────────────────────────────────────────────────
const LINE_HIT = 8;   // px to detect a line drag
const EDGE_HIT = 8;   // px to detect left/right edge drag

// ─── component ────────────────────────────────────────────────────────────────
const TradeSetupTool = ({
  containerRef,
  chartApi,
  seriesApi,
  active,
  zones,
  onZonesChange,
  onDone,
  onCancel,
  dataRef,
  magnetMode,
}) => {
  // ── magnet threshold (configurable in Chart Settings) ─────────────────────
  const magnetThresholdPx = useChartSettingsStore((s) => s.magnetThresholdPx);

  // ── Live engine-state derivation ──────────────────────────────────────────
  // ARCHITECTURE: zones in `zones` (passed down from ChartComponent's
  // committedTradeZones state) store only DRAWING GEOMETRY as their source of
  // truth (entryLogicalX, slLogicalX, positionId). Once a zone is linked to a
  // real order/position (positionId set), its TRADING fields — entryPrice,
  // stopLoss, takeProfit, status, side, fillTime — are no longer authored by
  // the zone object itself. Instead they are derived live, on every render,
  // by looking up positionId in tradingStore's positions/pendingOrders/
  // closedPositions arrays (which are themselves kept in sync with
  // ExecutionEngine by tradingStore's EventBus subscriptions).
  //
  // This replaces the previous approach of manually pushing field updates
  // into zones from scattered EventBus handlers in App.jsx (ORDER_FILLED →
  // updateTradeZone, POSITION_CLOSED → updateTradeZone, etc.) — that pattern
  // required hardcoding a bespoke update path for every single event type,
  // and was exactly the kind of fragile per-feature wiring that caused zones
  // to silently fall out of sync (issue: pending zone never flipping to
  // "open" after an immediate-fill order, TP/SL edits in PositionsPanel never
  // appearing on the chart, etc).
  //
  // Now there is exactly ONE place a zone's trading data comes from once
  // it's linked to a position: the engine, via tradingStore. App.jsx no
  // longer needs ANY of that event wiring for trading-data sync — it still
  // listens for ORDER_CANCELLED to remove an abandoned zone's drawing, and
  // POSITION_CLOSED isn't needed for trading-data sync anymore (status comes
  // from looking the id up across all three lists) but zones do need to be
  // told to stop tracking after a position is fully closed if the user wants
  // them removed — that remains a deliberate, explicit user action (the
  // "✕ Close"/"✕ Cancel" button), not implicit on every engine event.
  const livePositions     = useTradingStore((s) => s.positions);
  const livePendingOrders = useTradingStore((s) => s.pendingOrders);
  const liveClosed        = useTradingStore((s) => s.closedPositions);

  const resolvedZones = useMemo(() => {
    if (!zones?.length) return zones;
    return zones.map((z) => {
      if (!z.positionId) return z; // not yet linked to an order — geometry-only zone

      // Look up the live engine record by id, across all three lists.
      const openPos = livePositions.find((p) => p.id === z.positionId);
      if (openPos) {
        return {
          ...z,
          status: 'open',
          side: openPos.side,
          entryPrice: openPos.entryPrice,
          stopLoss: openPos.stopLoss ?? null,
          takeProfit: openPos.takeProfit ?? null,
          fillTime: openPos.filledTime ?? z.fillTime ?? null,
        };
      }
      const pendingOrd = livePendingOrders.find((p) => p.id === z.positionId);
      if (pendingOrd) {
        return {
          ...z,
          status: 'pending',
          side: pendingOrd.side,
          entryPrice: pendingOrd.entryPrice,
          stopLoss: pendingOrd.stopLoss ?? null,
          takeProfit: pendingOrd.takeProfit ?? null,
        };
      }
      const closedPos = liveClosed.find((p) => p.id === z.positionId);
      if (closedPos) {
        return {
          ...z,
          status: 'closed',
          side: closedPos.side,
          entryPrice: closedPos.entryPrice,
          stopLoss: closedPos.stopLoss ?? null,
          takeProfit: closedPos.takeProfit ?? null,
          fillTime: closedPos.filledTime ?? z.fillTime ?? null,
        };
      }
      // positionId set but not found in any list — order was cancelled
      // before ever filling. Leave the zone's last-known fields as-is;
      // App.jsx's ORDER_CANCELLED handler is responsible for removing
      // the zone's drawing entirely in this case.
      return z;
    });
  }, [zones, livePositions, livePendingOrders, liveClosed]);

  // ── drawing ───────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('idle');
  const phaseRef = useRef('idle');
  const entrySnapRef = useRef(null); // { logicalX, price } of first click

  // live cursor position during drawing
  const [liveCursor, setLiveCursor] = useState(null);

  // ── selection ─────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState(null);

  // ── hover ─────────────────────────────────────────────────────────────────
  // which handle element is hovered (set by onMouseEnter on SVG elements)
  const [_hoverInfo, _setHoverInfo] = useState(null); // { zoneId, handle }

  // ── container dims ────────────────────────────────────────────────────────
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

  // ── force re-render on zoom/pan (for reprojection) ───────────────────────
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!chartApi) return;
    const ts = chartApi.timeScale();
    const bump = () => setTick(n => n + 1);
    ts.subscribeVisibleLogicalRangeChange(bump);
    return () => ts.unsubscribeVisibleLogicalRangeChange(bump);
  }, [chartApi]);

  // ── project zone → pixel geometry ────────────────────────────────────────
  const projectZone = useCallback((z) => {
    if (!chartApi || !seriesApi) return null;

    // Left edge: when order is filled, snap to the fill candle's time position.
    const originalX1 = logicalToX(z.entryLogicalX, chartApi);
    let x1 = originalX1;
    if ((z.status === 'open' || z.status === 'closed') && z.fillTime != null) {
      try {
        const ts    = chartApi.timeScale();
        const fillX = ts.timeToCoordinate(z.fillTime);
        if (fillX != null) x1 = fillX;
      } catch { /* fallback to originalX1 already set */ }
    }

    // Preserve the original drawn width: shift x2 by the same pixel delta as x1.
    // Without this, snapping x1 left to the fill candle would widen the box.
    const x1Delta = originalX1 != null ? x1 - originalX1 : 0;
    const x2      = (logicalToX(z.slLogicalX, chartApi) ?? 0) + x1Delta;
    const entryY = priceToY(z.entryPrice, seriesApi);
    const slY    = priceToY(z.slPrice,    seriesApi);
    const tpY    = priceToY(z.tpPrice,    seriesApi);
    if ([x1,x2,entryY,slY,tpY].some(v => v == null)) return null;
    return { x1, x2, entryY, slY, tpY };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, seriesApi, tick]);

  // ── apply drag delta to a zone clone ────────────────────────────────────
  // Magnet-aware Y→price helper for drag operations: snaps to the nearest
  // OHLC value of the candle under the given X pixel, same algorithm as the
  // live cursor (see utils/magnetSnap.js — LWC doesn't expose this snapping
  // through any public drag/coordinate API, so we replicate it ourselves).
  const magnetYToPrice = useCallback((x, y) => {
    const rawPrice = yToPrice(y, seriesApi);
    if (rawPrice == null) return null;
    const data = dataRef?.current;
    if (!data?.length || !magnetMode) return rawPrice;
    const logical = xToLogical(x, chartApi);
    if (logical == null) return rawPrice;
    return getMagnetPoint(x, y, chartApi, seriesApi, data, magnetMode, magnetThresholdPx).price ?? rawPrice;
  }, [seriesApi, chartApi, dataRef, magnetMode, magnetThresholdPx]);

  const applyDrag = useCallback((zone, handle, dx, dy, g) => {
    // Closed positions: nothing can be adjusted
    if (zone.status === 'closed') return zone;

    let { entryPrice, slPrice, tpPrice, entryLogicalX, slLogicalX } = zone;
    const isFilled = zone.status === 'open';

    if (handle === 'entry_line' && !isFilled) {
      const newY = g.entryY + dy;
      entryPrice = roundPrice(magnetYToPrice(g.x1, newY)) ?? entryPrice;
      // Do NOT recompute tpPrice — user has placed it explicitly; just show new R
    } else if (handle === 'sl_line') {
      const newY = g.slY + dy;
      slPrice = roundPrice(magnetYToPrice(g.x2, newY)) ?? slPrice;
      // Do NOT recompute tpPrice — ratio is displayed dynamically, not enforced
    } else if (handle === 'tp_line') {
      tpPrice = roundPrice(magnetYToPrice(g.x1, g.tpY + dy)) ?? tpPrice;
    } else if (handle === 'body') {
      if (isFilled) {
        // Entry is locked after fill — only shift SL and TP vertically.
        // This keeps the entry price fixed while allowing risk adjustment.
        slPrice = roundPrice(magnetYToPrice(g.x2, g.slY + dy)) ?? slPrice;
        tpPrice = roundPrice(magnetYToPrice(g.x1, g.tpY + dy)) ?? tpPrice;
      } else {
        // Pre-order: shift all three prices together (same delta)
        entryPrice = roundPrice(magnetYToPrice(g.x1, g.entryY + dy)) ?? entryPrice;
        slPrice    = roundPrice(magnetYToPrice(g.x2, g.slY    + dy)) ?? slPrice;
        tpPrice    = roundPrice(magnetYToPrice(g.x1, g.tpY    + dy)) ?? tpPrice;
        // Also shift the horizontal position of the box (item 7: preserve width)
        entryLogicalX = xToLogical(g.x1 + dx, chartApi) ?? entryLogicalX;
        slLogicalX    = xToLogical(g.x2 + dx, chartApi) ?? slLogicalX;
      }
    } else if (handle === 'left_edge' && !isFilled) {
      entryLogicalX = xToLogical(g.x1 + dx, chartApi) ?? entryLogicalX;
    } else if (handle === 'right_edge') {
      slLogicalX = xToLogical(g.x2 + dx, chartApi) ?? slLogicalX;
    }

    const side = entryPrice > slPrice ? 'long' : 'short';
    return { ...zone, entryPrice, slPrice, tpPrice, entryLogicalX, slLogicalX, side };
  }, [chartApi, magnetYToPrice]);

  // ── sync drag result to trading store + trading panel ───────────────────
  const syncZoneToOrder = useCallback((zone) => {
    // Case 1: zone not yet linked to an order (still being drawn / pre-submit)
    // Push live prices back to TradingPanel via TradeSetupStore so the user
    // sees current entry/SL/TP reflected in the form while they fine-tune.
    if (!zone.positionId || zone.status === 'pending_draw') {
      useTradeSetupStore.getState().setSetup({
        entryPrice: zone.entryPrice,
        stopLoss:   zone.slPrice,
        takeProfit: zone.tpPrice,
        side:       zone.side,
        // isReady: false — do NOT retrigger the full setup flow, just update values
      });
      return;
    }

    const store = useTradingStore.getState();

    if (zone.status === 'pending') {
      // Order is waiting to fill — update its limit/SL/TP in the engine
      if (typeof store.updatePendingOrder === 'function') {
        store.updatePendingOrder(zone.positionId, {
          limitPrice: zone.entryPrice,
          entryPrice: zone.entryPrice,
          stopLoss:   zone.slPrice,
          takeProfit: zone.tpPrice,
        });
      }
    } else if (zone.status === 'open') {
      // Order is filled — only SL/TP can be changed, entry is locked
      if (typeof store.updatePosition === 'function') {
        store.updatePosition(zone.positionId, {
          stopLoss:   zone.slPrice,
          takeProfit: zone.tpPrice,
        });
      }
    }
    // status === 'closed' → nothing to sync
  }, []);

  // ── delete / close selected zone ──────────────────────────────────────────
  const deleteZone = useCallback((zoneId) => {
    const zone = resolvedZones.find(z => z.id === zoneId);
    if (!zone) return;

    const store = useTradingStore.getState();
    if (zone.positionId) {
      if (zone.status === 'pending') {
        // Cancel the pending order — ExecutionEngine will emit ORDER_CANCELLED
        // which triggers App.jsx to call removeZoneByPositionId
        store.cancelPendingOrder(zone.positionId);
        // Don't remove zone here — ORDER_CANCELLED event will remove it
        setSelectedId(null);
        return;
      }
      // For open/closed zones, clicking "Delete" is invalid — use Close instead
    }
    onZonesChange(prev => prev.filter(z => z.id !== zoneId));
    setSelectedId(null);
  }, [resolvedZones, onZonesChange]);

  // ── close position linked to zone ──────────────────────────────────────────
  const closeZonePosition = useCallback((zoneId) => {
    const zone = resolvedZones.find(z => z.id === zoneId);
    if (!zone?.positionId) return;
    // getPriceForSymbol uses zone.symbol if present; falls back to most-recently-updated price
    const marketState = useMarketStore.getState();
    const mktPrice = (zone.symbol ? marketState.getPriceForSymbol(zone.symbol) : null)
      ?? marketState.currentPrice
      ?? zone.entryPrice;
    useTradingStore.getState().closePosition(zone.positionId, mktPrice, Math.floor(Date.now() / 1000));
    // Zone status updates to 'closed' automatically — derived live from
    // tradingStore.closedPositions on the next render (see resolvedZones above).
    setSelectedId(null);
  }, [resolvedZones]);

  // ── reset on tool deactivate ──────────────────────────────────────────────
  useEffect(() => {
    if (!active) {
      phaseRef.current = 'idle';
      setPhase('idle');
      entrySnapRef.current = null;
      setLiveCursor(null);
    }
  }, [active]);

  // ── drawing: track cursor position with magnet-aware price snapping ──────
  // IMPORTANT: chart.subscribeCrosshairMove()'s param.point is the RAW mouse
  // pixel position — LWC does NOT expose the magnet-snapped price/coordinate
  // through any public API. The snapping only happens internally for drawing
  // the crosshair line itself. So we must replicate the MagnetOHLC algorithm
  // ourselves (see utils/magnetSnap.js) using the same candle data the chart
  // is displaying, and apply it to the y-derived price before using it.
  useEffect(() => {
    if (!active || !chartApi || !seriesApi || !containerRef?.current) return;

    const onCrosshairMove = (param) => {
      if (!param?.point || param.point.x == null || param.point.y == null) {
        setLiveCursor(null);
        return;
      }
      const { x, y } = param.point;
      const rawPrice = seriesApi.coordinateToPrice(y);
      const logical = xToLogical(x, chartApi);
      if (rawPrice == null) return;

      const data = dataRef?.current;
      const snappedPrice = data?.length
        ? getMagnetPoint(x, y, chartApi, seriesApi, data, magnetMode, magnetThresholdPx).price
        : rawPrice;

      setLiveCursor({
        x, y,
        logicalX: logical ?? (x / dims.w) * 1000,
        price: snappedPrice ?? rawPrice,
      });
    };

    chartApi.subscribeCrosshairMove(onCrosshairMove);
    return () => {
      try { chartApi.unsubscribeCrosshairMove(onCrosshairMove); } catch { /* ignore */ }
    };
  }, [active, chartApi, seriesApi, containerRef, dims.w, dataRef, magnetMode, magnetThresholdPx]);

  // ── drawing: mousedown on container (capture, only in active mode) ────────
  // Click 1: set entry; Click 2: set SL and commit zone.
  useEffect(() => {
    if (!active || !containerRef?.current) return;
    const el = containerRef.current;

    const onDown = (e) => {
      if (e.button !== 0) return;
      // Use the magnet-aware snapped cursor (from the chart's own crosshair),
      // not a raw recomputation from mouse pixel position. liveCursor is kept
      // in sync by the subscribeCrosshairMove effect above and already
      // reflects OHLC snapping when magnet mode is active.
      if (!liveCursor || liveCursor.price == null) return;
      const price = liveCursor.price;
      const logX  = liveCursor.logicalX;

      if (phaseRef.current === 'idle') {
        entrySnapRef.current = { logicalX: logX, price };
        phaseRef.current = 'entry_set';
        setPhase('entry_set');
        // Clear any selection while drawing — we are in tool mode, not selection mode
        setSelectedId(null);
        // Don't stop propagation — chart still gets click 1 (e.g. to position crosshair)

      } else if (phaseRef.current === 'entry_set') {
        e.stopPropagation(); // prevent chart from handling second click
        const entryPrice = roundPrice(entrySnapRef.current.price);
        const slPrice    = roundPrice(price);
        const risk       = entryPrice - slPrice;
        const side       = risk > 0 ? 'long' : 'short';
        const tpPrice    = roundPrice(entryPrice + risk * RR_RATIO);

        const newZone = {
          id: newZoneId(),
          entryLogicalX: entrySnapRef.current.logicalX,
          slLogicalX:    logX,
          entryPrice, slPrice, tpPrice, side,
          status: 'pending_draw',
          positionId: null,
        };

        // Keep all committed (positionId != null) zones; also keep pending_draw
        // zones that belong to submitted orders. Only remove unvalidated drawings.
        onZonesChange(prev => [...prev.filter(z => z.positionId != null || z.status !== 'pending_draw'), newZone]);
        setSelectedId(newZone.id);

        useTradeSetupStore.getState().setSetup({
          entryPrice, stopLoss: slPrice, takeProfit: tpPrice, side,
          isReady: true, requestTradingPanel: true, zoneId: newZone.id,
        });

        if (onDone) onDone(newZone);

        phaseRef.current = 'idle';
        setPhase('idle');
        entrySnapRef.current = null;
        setLiveCursor(null);
        if (onCancel) onCancel(); // return tool to cursor
      }
    };

    el.addEventListener('mousedown', onDown, { capture: true });
    return () => el.removeEventListener('mousedown', onDown, { capture: true });
  }, [active, containerRef, chartApi, seriesApi, dims.w, onZonesChange, onDone, onCancel, liveCursor]);

  // ── Escape ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (phaseRef.current !== 'idle') {
          phaseRef.current = 'idle';
          setPhase('idle');
          entrySnapRef.current = null;
          setLiveCursor(null);
          useTradeSetupStore.getState().clearSetup();
          if (onCancel) onCancel();
        } else {
          // Deselect
          setSelectedId(null);
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't hijack Delete/Backspace while the user is typing in a form
        // field anywhere in the app (e.g. editing TP/SL/entry in
        // PositionsPanel's EditablePrice, or any other input/textarea).
        // Without this guard, pressing Backspace while correcting a typed
        // number would delete the currently-selected chart trade box.
        const target = e.target;
        const isEditableField =
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.isContentEditable;
        if (isEditableField) return;

        if (selectedId) deleteZone(selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, selectedId, deleteZone]);

  // ── drag: started from SVG handle elements via onPointerDown ─────────────
  // We use a ref-based pattern with window listeners so the SVG element's
  // pointerdown initiates, but all subsequent move/up events are tracked at
  // window level.  This means the chart never sees pointermove/up during drag.
  const dragRef = useRef(null);
  // dragRef: { zoneId, handle, startClientX, startClientY, startGeom, startZone, hasMoved }

  // Tracks the live in-flight drag zone so the SVG can render it immediately
  // without waiting for resolvedZones (which is gated on the trading store update).
  // Set on every mousemove during drag; cleared on mouseup.
  const [liveDragZone, setLiveDragZone] = useState(null);

  // Minimum pixel movement before a mousedown→mouseup is treated as an
  // actual drag. Below this threshold it's a plain click (select only) —
  // this prevents applyDrag's price round-trip (pixel→price→pixel, plus
  // magnet snapping) from nudging entry/SL/TP on a simple click-to-select,
  // which previously caused the TP line to visibly jump/shrink the box
  // every time a zone was merely clicked.
  const DRAG_THRESHOLD_PX = 3;

  const startDrag = useCallback((e, zoneId, handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const zone = resolvedZones.find(z => z.id === zoneId);
    if (!zone) return;
    const g = projectZone(zone);
    if (!g) return;

    dragRef.current = {
      zoneId, handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startGeom: { ...g },
      startZone: { ...zone },
      hasMoved: false,
    };
    setSelectedId(zoneId);
  }, [resolvedZones, projectZone]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const ds = dragRef.current;
      const dx = e.clientX - ds.startClientX;
      const dy = e.clientY - ds.startClientY;

      // Only start actually applying drag deltas once the cursor has moved
      // past the threshold. Before that, do nothing — this keeps a simple
      // click-then-release from mutating any price.
      if (!ds.hasMoved) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        ds.hasMoved = true;
      }

      const updated = applyDrag(ds.startZone, ds.handle, dx, dy, ds.startGeom);
      // Update both the zone list (for non-resolved zones) and the live drag
      // override (so resolvedZones' store-pinned prices don't freeze the visual).
      onZonesChange(prev => prev.map(z => z.id === updated.id ? updated : z));
      setLiveDragZone(updated);
    };

    const onUp = (e) => {
      if (!dragRef.current) return;
      const ds = dragRef.current;

      // No movement beyond the threshold → this was a click, not a drag.
      // Don't touch the zone's prices at all; it's already selected via
      // startDrag's setSelectedId call.
      if (!ds.hasMoved) {
        dragRef.current = null;
        setLiveDragZone(null);
        return;
      }

      const dx = e.clientX - ds.startClientX;
      const dy = e.clientY - ds.startClientY;
      const updated = applyDrag(ds.startZone, ds.handle, dx, dy, ds.startGeom);
      onZonesChange(prev => prev.map(z => z.id === updated.id ? updated : z));
      syncZoneToOrder(updated);
      dragRef.current = null;
      setLiveDragZone(null);
    };

    window.addEventListener('mousemove', onMove, { passive: false });
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [applyDrag, onZonesChange, syncZoneToOrder]);

  // ── click on chart background to deselect ────────────────────────────────
  // We listen on the container (not the SVG, which has pointerEvents:none) for
  // clicks that aren't stopped by zone interactive elements.
  useEffect(() => {
    if (!containerRef?.current) return;
    const el = containerRef.current;
    const onDown = (_e) => {
      // If a zone element stopped propagation, this won't fire
      // Only fires when clicking empty chart space
      if (!active && selectedId && !dragRef.current) {
        setSelectedId(null);
      }
    };
    el.addEventListener('mousedown', onDown, { passive: true });
    return () => el.removeEventListener('mousedown', onDown);
  }, [active, selectedId, containerRef]);

  // ── click a zone to select / deselect it ─────────────────────────────────
  // Selection only works when we are in cursor mode (active=false, phase=idle).
  // When a drawing tool is active, clicks must fall through to the canvas for drawing.
  const handleZoneClick = useCallback((e, zoneId) => {
    if (active || phaseRef.current !== 'idle') {
      // We're in drawing mode — do NOT select the zone; let the draw handler fire
      return;
    }
    e.stopPropagation();
    setSelectedId(prev => prev === zoneId ? null : zoneId);
  }, [active]);

  // ─── Zone SVG rendering ───────────────────────────────────────────────────
  const SL_COLOR    = '#f23645';
  const TP_COLOR    = '#089981';
  const ENTRY_COLOR = '#c4c9d4';
  const PENDING_FILL = '#f0a500';
  const OPEN_FILL    = '#2962ff';

  const ZoneGraphic = ({ zone, geom, isSelected, isLive, active: isActiveTool }) => {
    if (!geom) return null;
    const { x1, x2, entryY, slY, tpY } = geom;
    const left   = Math.min(x1, x2);
    const right  = Math.max(x1, x2);
    const width  = right - left;
    if (width < 1) return null;

    const isClosed  = zone?.status === 'closed';
    const isFilled  = zone?.status === 'open';
    const _isPending = zone?.status === 'pending';
    // Entry line is locked once order is filled or closed — no drag allowed
    const entryLocked = isFilled || isClosed;
    // All handles are locked when closed — zone is a permanent historical annotation
    const allLocked = isClosed || isLive || isActiveTool;
    const labelX = right + 6;
    const zoneId = zone?.id;

    const isDragging = dragRef.current?.zoneId === zoneId;
    const isActive = isSelected || isDragging;
    const _bodyCursor = isLive ? 'crosshair' : isClosed ? 'default' : (isSelected ? 'default' : 'pointer');

    // Make handle areas bigger so they're easier to grab
    const HANDLE_AREA = 12; // half-height of invisible hit rect on each line

    return (
      <g>
        {/* ── Invisible wide body click area ─────── */}
        {/* Filled zones: click-to-select only (no drag). Pre-order zones: full drag. Closed: click only. */}
        {/* CRITICAL: gated on !isActiveTool — when any drawing tool is active (including
            this same trade_setup tool while drawing a NEW box), this rect must not exist
            at all, otherwise its onMouseDown swallows the click before the container's
            own draw-mode mousedown handler (registered with capture:true) can act on it,
            and the zone gets selected/dragged instead of a new box being started. */}
        {!isLive && !isFilled && !isClosed && !isActiveTool && (
          <rect
            x={left} y={Math.min(tpY, slY)}
            width={width} height={Math.abs(slY - tpY)}
            fill="transparent"
            style={{ cursor: 'pointer', pointerEvents: 'all' }}
            onClick={(e) => handleZoneClick(e, zoneId)}
            onMouseDown={(e) => {
              const ly = e.clientY - containerRef.current.getBoundingClientRect().top;
              const nearEntry = Math.abs(ly - entryY) <= LINE_HIT;
              const nearSL    = Math.abs(ly - slY)    <= LINE_HIT;
              const nearTP    = Math.abs(ly - tpY)    <= LINE_HIT;
              if (!nearEntry && !nearSL && !nearTP) startDrag(e, zoneId, 'body');
            }}
          />
        )}
        {!isLive && (isFilled || isClosed) && !isActiveTool && (
          <rect
            x={left} y={Math.min(tpY, slY)}
            width={width} height={Math.abs(slY - tpY)}
            fill="transparent"
            style={{ cursor: 'default', pointerEvents: 'all' }}
            onClick={(e) => handleZoneClick(e, zoneId)}
          />
        )}

        {/* ── TP fill ─── */}
        <rect x={left} y={Math.min(entryY, tpY)} width={width}
          height={Math.abs(tpY - entryY)}
          fill={TP_COLOR} fillOpacity={isActive ? 0.20 : 0.12} stroke="none"
          style={{ pointerEvents: 'none' }} />

        {/* ── SL fill ─── */}
        <rect x={left} y={Math.min(entryY, slY)} width={width}
          height={Math.abs(slY - entryY)}
          fill={SL_COLOR} fillOpacity={isActive ? 0.20 : 0.12} stroke="none"
          style={{ pointerEvents: 'none' }} />

        {/* ── Outer border ─── */}
        <rect x={left} y={Math.min(tpY, slY)} width={width} height={Math.abs(slY - tpY)}
          fill="none"
          stroke={isActive ? '#4a90d9' : isSelected ? '#4a90d9' : '#3a3e4a'}
          strokeWidth={isActive ? 1.5 : 1} strokeOpacity={0.7}
          style={{ pointerEvents: 'none' }} />

        {/* ── TP line + drag area ─── */}
        <line x1={left} y1={tpY} x2={right} y2={tpY}
          stroke={TP_COLOR} strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
        {!allLocked && !isActiveTool && (
          <rect x={left} y={tpY - HANDLE_AREA} width={width} height={HANDLE_AREA * 2}
            fill="transparent"
            style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
            onMouseDown={(e) => startDrag(e, zoneId, 'tp_line')} />
        )}

        {/* ── Entry line + drag area ─── */}
        <line x1={left} y1={entryY} x2={right} y2={entryY}
          stroke={ENTRY_COLOR} strokeWidth={1.5}
          strokeDasharray={entryLocked ? '4 3' : undefined}
          style={{ pointerEvents: 'none' }} />
        {!allLocked && !entryLocked && !isActiveTool && (
          <rect x={left} y={entryY - HANDLE_AREA} width={width} height={HANDLE_AREA * 2}
            fill="transparent"
            style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
            onMouseDown={(e) => startDrag(e, zoneId, 'entry_line')} />
        )}

        {/* ── SL line + drag area ─── */}
        <line x1={left} y1={slY} x2={right} y2={slY}
          stroke={SL_COLOR} strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
        {!allLocked && !isActiveTool && (
          <rect x={left} y={slY - HANDLE_AREA} width={width} height={HANDLE_AREA * 2}
            fill="transparent"
            style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
            onMouseDown={(e) => startDrag(e, zoneId, 'sl_line')} />
        )}

        {/* ── Left edge drag (move entry time) ─── */}
        {!allLocked && !entryLocked && !isActiveTool && (
          <rect x={left - 6} y={Math.min(tpY, slY)} width={12} height={Math.abs(slY - tpY)}
            fill="transparent"
            style={{ cursor: 'ew-resize', pointerEvents: 'all' }}
            onMouseDown={(e) => startDrag(e, zoneId, 'left_edge')} />
        )}
        {/* ── Right edge drag (move SL time) ─── */}
        {!allLocked && !isActiveTool && (
          <rect x={right - 6} y={Math.min(tpY, slY)} width={12} height={Math.abs(slY - tpY)}
            fill="transparent"
            style={{ cursor: 'ew-resize', pointerEvents: 'all' }}
            onMouseDown={(e) => startDrag(e, zoneId, 'right_edge')} />
        )}

        {/* ── Handle dots on lines (visual only) ─── */}
        {isSelected && !allLocked && !isActiveTool && [
          { y: tpY,    col: TP_COLOR,    locked: false },
          { y: entryY, col: ENTRY_COLOR, locked: entryLocked },
          { y: slY,    col: SL_COLOR,    locked: false },
        ].map(({ y, col, locked: _locked }, i) => (
          <circle key={i} cx={left + width / 2} cy={y} r={5}
            fill={col} fillOpacity={0.8} stroke="#fff" strokeWidth={1}
            style={{ pointerEvents: 'none' }} />
        ))}

        {/* ── Price labels ─── */}
        {zone?.tpPrice != null && (
          <text x={labelX} y={tpY + 4} fill={TP_COLOR} fontSize={10} fontWeight="600"
            fontFamily="'Inter',sans-serif" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {fmtPrice(zone.tpPrice)}
          </text>
        )}
        {zone?.entryPrice != null && (
          <text x={labelX} y={entryY + 4} fill={ENTRY_COLOR} fontSize={10} fontWeight="600"
            fontFamily="'Inter',sans-serif" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {fmtPrice(zone.entryPrice)}{entryLocked ? ' 🔒' : ''}
          </text>
        )}
        {zone?.slPrice != null && (
          <text x={labelX} y={slY + 4} fill={SL_COLOR} fontSize={10} fontWeight="600"
            fontFamily="'Inter',sans-serif" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {fmtPrice(zone.slPrice)}
          </text>
        )}

        {/* ── R:R labels inside boxes ─── */}
        {width > 40 && Math.abs(tpY - entryY) > 18 && (() => {
          // Compute actual R:R from current prices (not hardcoded 2R)
          const risk   = Math.abs(zone?.entryPrice - zone?.slPrice) || 1;
          const reward = Math.abs(zone?.tpPrice   - zone?.entryPrice) || 0;
          const rr     = (reward / risk).toFixed(1);
          return (
            <text x={left + width / 2} y={(entryY + tpY) / 2 + 4}
              fill={TP_COLOR} fontSize={10} fontWeight="700" fontFamily="'Inter',sans-serif"
              textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {rr}R
            </text>
          );
        })()}
        {width > 40 && Math.abs(slY - entryY) > 18 && (
          <text x={left + width / 2} y={(entryY + slY) / 2 + 4}
            fill={SL_COLOR} fontSize={10} fontWeight="700" fontFamily="'Inter',sans-serif"
            textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            1R
          </text>
        )}

        {/* ── Status badge ─── */}
        {!isLive && zone?.status && zone.status !== 'pending_draw' && (() => {
          const statusColor =
            zone.status === 'pending' ? PENDING_FILL :
            zone.status === 'open'    ? OPEN_FILL    :
            zone.status === 'closed'  ? '#787b86'    : '#aaa';
          const statusLabel =
            zone.status === 'pending' ? '⏳ PENDING' :
            zone.status === 'open'    ? '● OPEN'     :
            zone.status === 'closed'  ? '✓ CLOSED'   : zone.status.toUpperCase();
          return (
            <text x={left + 4} y={Math.min(tpY, slY) + 12}
              fill={statusColor}
              fontSize={9} fontWeight="700" fontFamily="'Inter',sans-serif"
              style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {statusLabel}
            </text>
          );
        })()}

        {/* ── Action button: Delete (pending_draw/pending) | Close (open) | nothing (closed) ─── */}
        {isSelected && !isLive && zone?.status !== 'closed' && (() => {
          const isOpen    = zone?.status === 'open';
          const _isPending = zone?.status === 'pending';
          const isDraw    = zone?.status === 'pending_draw';
          const btnColor  = isOpen ? '#f0a500' : '#f23645';
          const btnLabel  = isOpen ? '✕ Close' : isDraw ? '✕ Cancel' : '✕ Cancel Order';
          const btnAction = isOpen
            ? (e) => { e.stopPropagation(); closeZonePosition(zoneId); }
            : (e) => { e.stopPropagation(); deleteZone(zoneId); };

          return (
            <g style={{ cursor: 'pointer', pointerEvents: 'all' }} onClick={btnAction}>
              <rect x={left + width / 2 - 36} y={Math.min(tpY, slY) - 22}
                width={72} height={18} rx={4}
                fill={btnColor} fillOpacity={0.9} />
              <text x={left + width / 2} y={Math.min(tpY, slY) - 9}
                fill="#fff" fontSize={10} fontWeight="700" fontFamily="'Inter',sans-serif"
                textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {btnLabel}
              </text>
            </g>
          );
        })()}
      </g>
    );
  };

  // ── live preview ──────────────────────────────────────────────────────────
  const liveGeom = useMemo(() => {
    if (!active || phase !== 'entry_set' || !entrySnapRef.current || !liveCursor) return null;
    const x1     = logicalToX(entrySnapRef.current.logicalX, chartApi) ?? liveCursor.x;
    const x2     = liveCursor.x;
    const entryY = priceToY(entrySnapRef.current.price, seriesApi);
    const slY    = liveCursor.y;
    if (entryY == null) return null;
    const risk   = entrySnapRef.current.price - liveCursor.price;
    const tpPrice = entrySnapRef.current.price + risk * RR_RATIO;
    const tpY    = priceToY(tpPrice, seriesApi) ?? (entryY - (slY - entryY) * RR_RATIO);
    return { x1, x2, entryY, slY, tpY };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, phase, liveCursor, chartApi, seriesApi, tick]);

  const liveZone = useMemo(() => {
    if (!entrySnapRef.current || !liveCursor) return null;
    const risk = entrySnapRef.current.price - liveCursor.price;
    return {
      entryPrice: roundPrice(entrySnapRef.current.price),
      slPrice:    roundPrice(liveCursor.price),
      tpPrice:    roundPrice(entrySnapRef.current.price + risk * RR_RATIO),
      status: 'pending_draw',
    };
  }, [liveCursor]);

  if (!active && resolvedZones.length === 0) return null;

  return (
    <svg
      style={{
        position: 'absolute', inset: 0,
        width: dims.w, height: dims.h,
        // outer SVG is pointer-events:none; only child elements with explicit
        // pointerEvents:'all' capture events
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
    >
      {/* Committed zones — rendered from resolvedZones so entry/SL/TP/status
          always reflect the engine's live truth for linked positions/orders.
          During an active drag we substitute the live drag zone so the entry
          line moves immediately without waiting for the trading store to sync. */}
      {resolvedZones.map(z => {
        const renderZone = (liveDragZone && liveDragZone.id === z.id) ? liveDragZone : z;
        return (
          <ZoneGraphic
            key={z.id}
            zone={renderZone}
            geom={projectZone(renderZone)}
            isSelected={selectedId === z.id}
            active={active}
          />
        );
      })}

      {/* Live preview during drawing */}
      {active && phase === 'entry_set' && liveGeom && (
        <ZoneGraphic zone={liveZone} geom={liveGeom} isLive />
      )}

      {/* Cursor dot during drawing */}
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
