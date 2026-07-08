/**
 * TradePriceLines — TradingView-style horizontal trade line overlay.
 *
 * Fixes in this version:
 *  - SVG clipPath prevents lines overflowing left toolbar + right price scale
 *  - Pending orders use yellow/orange theme (#f0a500)
 *  - SL PnL during drag uses positionSize captured at drag-start (not auto-resized)
 *  - Zone SL/TP auto-updates because resolvedZones derives from store (already linked)
 *  - updateHorizontalLine now exists in useChartImperativeHandle (fixes duplicate entry lines)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore  } from '../../stores/marketStore';
import { EventBus, Events } from '../../core/EventBus';

// ─── colours ─────────────────────────────────────────────────────────────────
const C = {
  long:       '#26a69a',
  short:      '#ef5350',
  pending:    '#f0a500',
  sl:         '#ef5350',
  tp:         '#26a69a',
  pnlPos:     '#26a69a',
  pnlNeg:     '#ef5350',
  text:       '#d1d4dc',
  textDim:    '#787b86',
  bg:         '#1e222d',
  badgeBg:    '#2a2e39',
};

// ─── layout ──────────────────────────────────────────────────────────────────
// Left offset clears the drawing toolbar (~44px).
// Right margin for the price scale — measured at render from DOM if possible,
// otherwise use a safe constant.
const LEFT_OFFSET   = 52;    // px — left of badge group
const RIGHT_MARGIN  = 65;    // px — reserved for right price-scale axis
const BADGE_W       = 130;
const BADGE_H       = 22;
const BTN_W         = 28;
const BTN_H         = 18;
const BTN_GAP       = 3;
const HIT           = 9;     // vertical grab zone in px

// Derived
const SL_BTN_OFFSET = BADGE_W + BTN_GAP;
const TP_BTN_OFFSET = SL_BTN_OFFSET + BTN_W + BTN_GAP;
const CL_BTN_OFFSET = TP_BTN_OFFSET + BTN_W + BTN_GAP;
const BUTTONS_END   = LEFT_OFFSET + CL_BTN_OFFSET + BTN_W; // right edge of button group

// ─── coordinate helpers ───────────────────────────────────────────────────────
const priceToY = (p, s) => { try { return s?.priceToCoordinate(p) ?? null; } catch { return null; } };
const yToPrice = (y, s) => { try { return s?.coordinateToPrice(y) ?? null; } catch { return null; } };

// ─── PnL ──────────────────────────────────────────────────────────────────────
// positionSize is passed explicitly so drag ghost can use pre-resize size
const calcPnL = (pos, exitPrice, overrideSize, basePrice) => {
  if (!pos || exitPrice == null) return null;
  const size = overrideSize ?? pos.positionSize ?? 0.01;
  const dir  = pos.side === 'long' ? 1 : -1;
  const from = basePrice ?? pos.entryPrice;
  return dir * (exitPrice - from) * size * (pos.leverage ?? 1);
};
const fmt  = (v) => v == null || !Number.isFinite(v) ? '' : (v >= 0 ? '+' : '') + v.toFixed(2);
const fmtP = (v) => v == null ? '' : Number(v).toFixed(5);

// ─── Component ────────────────────────────────────────────────────────────────
export default function TradePriceLines({ containerRef, chartApi, seriesApi, symbol }) {
  const { positions, pendingOrders, closePosition, cancelPendingOrder, updatePosition } =
    useTradingStore();
  const livePrice = useMarketStore((s) => s.getPriceForSymbol(symbol) || s.currentPrice);

  const [dims,      setDims]      = useState({ w: 0, h: 0 });
  const [_tick,     setTick]      = useState(0);
  // dragGhost: { id, handle, price, positionSize } — positionSize frozen at drag-start
  const [dragGhost, setDragGhost] = useState(null);
  const dragRef = useRef(null);

  // ── container size ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setDims({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(el);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [containerRef]);

  // ── scroll / zoom repaint ─────────────────────────────────────────────────
  useEffect(() => {
    if (!chartApi) return;
    const bump = () => setTick(n => n + 1);
    const ts = chartApi.timeScale();
    ts.subscribeVisibleLogicalRangeChange(bump);
    return () => ts.unsubscribeVisibleLogicalRangeChange(bump);
  }, [chartApi]);

  // ── price tick repaint ────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTick(n => n + 1); }, [livePrice]);

  // ── drag ──────────────────────────────────────────────────────────────────
  const startDrag = useCallback((e, id, handle) => {
    e.preventDefault();
    e.stopPropagation();
    const el = containerRef?.current;
    if (!el || !seriesApi) return;

    // Capture positionSize at drag-start so PnL shows pre-resize value during ghost
    const { positions: ps, pendingOrders: po } = useTradingStore.getState();
    const snapPos = [...ps, ...po].find(p => p.id === id);
    const snapSize = snapPos?.positionSize;

    dragRef.current = { id, handle, price: null, positionSize: snapSize };

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const rect  = el.getBoundingClientRect();
      const p     = yToPrice(ev.clientY - rect.top, seriesApi);
      if (p == null) return;
      dragRef.current.price = p;
      setDragGhost({ id, handle, price: p, positionSize: snapSize });
    };

    const onUp = () => {
      if (!dragRef.current) { cleanup(); return; }
      const { id: dId, handle: dHandle, price: dp } = dragRef.current;
      dragRef.current = null;
      setDragGhost(null);

      if (dp != null) {
        // Always read fresh state to avoid stale-closure bug
        const { positions: ps2, pendingOrders: po2 } = useTradingStore.getState();
        const pos = [...ps2, ...po2].find(p => p.id === dId);
        if (pos) {
          if      (dHandle === 'sl')    updatePosition(dId, { stopLoss:   dp });
          else if (dHandle === 'tp')    updatePosition(dId, { takeProfit: dp });
          else if (dHandle === 'entry') updatePosition(dId, { entryPrice: dp, limitPrice: dp });
          // Emit POSITION_UPDATED so TradingPanel / tradeSetupStore re-syncs
          const updatedFields =
            dHandle === 'sl'    ? { stopLoss:   dp } :
            dHandle === 'tp'    ? { takeProfit: dp } :
            /* entry */           { entryPrice: dp, limitPrice: dp };
          EventBus.emit(Events.POSITION_UPDATED, {
            positionId: dId,
            ...updatedFields,
            position: { ...pos, ...updatedFields },
          });
        }
      }
      cleanup();
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseup',   onUp);
  }, [containerRef, seriesApi, updatePosition]);

  // ── remove SL/TP ─────────────────────────────────────────────────────────
  const removeSL = useCallback((e, id) => {
    e.preventDefault(); e.stopPropagation();
    updatePosition(id, { stopLoss: undefined });
  }, [updatePosition]);

  const removeTP = useCallback((e, id) => {
    e.preventDefault(); e.stopPropagation();
    updatePosition(id, { takeProfit: undefined });
  }, [updatePosition]);

  const handleClose = useCallback((e, pos) => {
    e.preventDefault(); e.stopPropagation();
    if (pos._kind === 'position') closePosition(pos.id, livePrice);
    else cancelPendingOrder(pos.id);
  }, [closePosition, cancelPendingOrder, livePrice]);

  // ── render ────────────────────────────────────────────────────────────────
  const { w, h } = dims;
  if (!seriesApi || !chartApi || w === 0) return null;

  // Plot area: exclude left toolbar and right price-scale
  const clipX1 = LEFT_OFFSET - 4;   // slight bleed into toolbar for lines
  const clipX2 = w - RIGHT_MARGIN;

  // Fix 1: Only show trades whose symbol matches this chart's symbol
  const allItems = [
    ...positions.filter(p => p.symbol === symbol).map(p    => ({ ...p, _kind: 'position' })),
    ...pendingOrders.filter(p => p.symbol === symbol).map(p => ({ ...p, _kind: 'pending'  })),
  ];

  const CLIP_ID = 'tpl-clip';

  return (
    <svg style={{
      position: 'absolute', top: 0, left: 0,
      width: '100%', height: '100%',
      overflow: 'hidden',       // ← clips to container, stops overflowing toolbar/scale
      pointerEvents: 'none',
      zIndex: 15,
    }}>
      {/* Clip path: lines only draw inside the chart plot area */}
      <defs>
        <clipPath id={CLIP_ID}>
          <rect x={clipX1} y={0} width={clipX2 - clipX1} height={h} />
        </clipPath>
      </defs>

      {allItems.map(pos => {
        const isOpen    = pos._kind === 'position';
        const isPending = pos._kind === 'pending';

        // Drag ghost overrides
        const ghost      = dragGhost?.id === pos.id ? dragGhost : null;
        const entryPrice = (ghost?.handle === 'entry' ? ghost.price : null) ?? pos.entryPrice;
        const slPrice    = (ghost?.handle === 'sl'    ? ghost.price : null) ?? pos.stopLoss   ?? null;
        const tpPrice    = (ghost?.handle === 'tp'    ? ghost.price : null) ?? pos.takeProfit ?? null;
        // positionSize for PnL: use ghost's frozen size during drag, live size otherwise
        const pnlSize    = ghost ? (ghost.positionSize ?? pos.positionSize) : pos.positionSize;

        const entryY = priceToY(entryPrice, seriesApi);
        if (entryY == null) return null;
        const slY = slPrice != null ? priceToY(slPrice, seriesApi) : null;
        const tpY = tpPrice != null ? priceToY(tpPrice, seriesApi) : null;

        // For open positions PnL is vs live price; for pending orders PnL is projected from entry
        const livePnL = isOpen ? calcPnL(pos, livePrice, pnlSize) : null;
        // Fix 3: pending order SL/TP PnL must be relative to entryPrice (limit), not livePrice
        const pnlBase = isPending ? entryPrice : pos.entryPrice;
        const slPnL   = slPrice != null ? calcPnL(pos, slPrice, pnlSize, pnlBase) : null;
        const tpPnL   = tpPrice != null ? calcPnL(pos, tpPrice, pnlSize, pnlBase) : null;

        // Colour scheme
        const pendingTheme = isPending;
        const entryColor   = pendingTheme ? C.pending
                           : pos.side === 'long' ? C.long : C.short;

        // Badge positions (all relative to LEFT_OFFSET)
        const BX    = LEFT_OFFSET;
        const BY    = entryY - BADGE_H / 2;
        const SL_BX = BX + SL_BTN_OFFSET;
        const TP_BX = BX + TP_BTN_OFFSET;
        const CL_BX = BX + CL_BTN_OFFSET;

        // Line x extent — clipped to plot area
        const LX1 = clipX1;
        const LX2 = clipX2;
        // Centre for PnL labels
        const midX = (LX1 + LX2) / 2;

        return (
          <g key={pos.id}>

            {/* ══ TP ═══════════════════════════════════════════════════ */}
            {tpY != null && (
              <g clipPath={`url(#${CLIP_ID})`}>
                {/* fill */}
                <rect x={LX1} y={Math.min(entryY, tpY)}
                  width={LX2 - LX1} height={Math.abs(tpY - entryY)}
                  fill={C.tp} fillOpacity={0.05}
                  style={{ pointerEvents: 'none' }} />
                {/* line */}
                <line x1={LX1} y1={tpY} x2={LX2} y2={tpY}
                  stroke={pendingTheme ? C.pending : C.tp}
                  strokeWidth={1} strokeDasharray="6 3"
                  style={{ pointerEvents: 'none' }} />
                {/* drag hit — right portion only */}
                <rect x={BUTTONS_END + 4} y={tpY - HIT}
                  width={LX2 - BUTTONS_END - 4} height={HIT * 2}
                  fill="transparent"
                  style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
                  onMouseDown={(e) => startDrag(e, pos.id, 'tp')} />
                {/* PnL label */}
                {tpPnL != null && (
                  <g style={{ pointerEvents: 'none' }}>
                    <rect x={midX - 52} y={tpY - 9} width={104} height={16}
                      rx={3} fill={C.bg} fillOpacity={0.9} />
                    <text x={midX} y={tpY + 4}
                      fill={tpPnL >= 0 ? C.pnlPos : C.pnlNeg}
                      fontSize={10} fontWeight={700} textAnchor="middle"
                      fontFamily="'Inter',monospace,sans-serif">
                      TP {fmt(tpPnL)}
                    </text>
                  </g>
                )}
                {/* price right edge */}
                <text x={LX2 - 4} y={tpY - 3}
                  fill={pendingTheme ? C.pending : C.tp}
                  fontSize={9} fontWeight={600} textAnchor="end"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {fmtP(tpPrice)}
                </text>
              </g>
            )}

            {/* ══ SL ═══════════════════════════════════════════════════ */}
            {slY != null && (
              <g clipPath={`url(#${CLIP_ID})`}>
                {/* fill */}
                <rect x={LX1} y={Math.min(entryY, slY)}
                  width={LX2 - LX1} height={Math.abs(slY - entryY)}
                  fill={C.sl} fillOpacity={0.05}
                  style={{ pointerEvents: 'none' }} />
                {/* line */}
                <line x1={LX1} y1={slY} x2={LX2} y2={slY}
                  stroke={C.sl} strokeWidth={1} strokeDasharray="6 3"
                  style={{ pointerEvents: 'none' }} />
                {/* drag hit */}
                <rect x={BUTTONS_END + 4} y={slY - HIT}
                  width={LX2 - BUTTONS_END - 4} height={HIT * 2}
                  fill="transparent"
                  style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
                  onMouseDown={(e) => startDrag(e, pos.id, 'sl')} />
                {/* PnL label */}
                {slPnL != null && (
                  <g style={{ pointerEvents: 'none' }}>
                    <rect x={midX - 52} y={slY - 9} width={104} height={16}
                      rx={3} fill={C.bg} fillOpacity={0.9} />
                    <text x={midX} y={slY + 4}
                      fill={slPnL >= 0 ? C.pnlPos : C.pnlNeg}
                      fontSize={10} fontWeight={700} textAnchor="middle"
                      fontFamily="'Inter',monospace,sans-serif">
                      SL {fmt(slPnL)}
                    </text>
                  </g>
                )}
                {/* price right edge */}
                <text x={LX2 - 4} y={slY - 3}
                  fill={C.sl} fontSize={9} fontWeight={600} textAnchor="end"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {fmtP(slPrice)}
                </text>
              </g>
            )}

            {/* ══ Entry line ════════════════════════════════════════════ */}
            <g>
              {/* line — clipped */}
              <line x1={LX1} y1={entryY} x2={LX2} y2={entryY}
                stroke={entryColor} strokeWidth={1.5}
                strokeDasharray={isOpen ? '4 3' : undefined}
                clipPath={`url(#${CLIP_ID})`}
                style={{ pointerEvents: 'none' }} />

              {/* entry drag hit — pending only, right of button group */}
              {isPending && (
                <rect x={BUTTONS_END + 4} y={entryY - HIT}
                  width={Math.max(0, LX2 - BUTTONS_END - 4)} height={HIT * 2}
                  fill="transparent"
                  style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
                  onMouseDown={(e) => startDrag(e, pos.id, 'entry')} />
              )}

              {/* ── Badge ──────────────────────────────────────────── */}
              <g style={{ pointerEvents: 'none' }}>
                <rect x={BX} y={BY} width={BADGE_W} height={BADGE_H}
                  rx={4} fill={C.badgeBg} stroke={entryColor} strokeWidth={1} />
                <rect x={BX} y={BY} width={3} height={BADGE_H}
                  rx={2} fill={entryColor} />
                {livePnL != null ? (
                  <>
                    <text x={BX + 10} y={entryY + 4}
                      fill={livePnL >= 0 ? C.pnlPos : C.pnlNeg}
                      fontSize={11} fontWeight={700}
                      fontFamily="'Inter',monospace,sans-serif">
                      {fmt(livePnL)}
                    </text>
                    <text x={BX + BADGE_W - 4} y={entryY + 4}
                      fill={C.textDim} fontSize={9} fontWeight={500} textAnchor="end"
                      fontFamily="'Inter',monospace,sans-serif">
                      {fmtP(entryPrice)}
                    </text>
                  </>
                ) : (
                  <text x={BX + 10} y={entryY + 4}
                    fill={entryColor} fontSize={9} fontWeight={600}
                    fontFamily="'Inter',monospace,sans-serif">
                    {isPending ? 'PENDING ' : ''}{fmtP(entryPrice)}
                  </text>
                )}
              </g>

              {/* ── SL button: drag to set, click to remove ─────────── */}
              <g
                style={{ cursor: slPrice != null ? 'pointer' : 'ns-resize', pointerEvents: 'all' }}
                onMouseDown={(e) => { e.stopPropagation(); if (slPrice == null) startDrag(e, pos.id, 'sl'); }}
                onClick={(e) => { if (slPrice != null) removeSL(e, pos.id); }}
              >
                <rect x={SL_BX} y={entryY - BTN_H / 2} width={BTN_W} height={BTN_H}
                  rx={3}
                  fill={slPrice != null ? C.sl : C.badgeBg}
                  stroke={C.sl} strokeWidth={1} />
                <text x={SL_BX + BTN_W / 2} y={entryY + 4}
                  fill={C.text} fontSize={9} fontWeight={700} textAnchor="middle"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  SL
                </text>
              </g>

              {/* ── TP button: drag to set, click to remove ─────────── */}
              <g
                style={{ cursor: tpPrice != null ? 'pointer' : 'ns-resize', pointerEvents: 'all' }}
                onMouseDown={(e) => { e.stopPropagation(); if (tpPrice == null) startDrag(e, pos.id, 'tp'); }}
                onClick={(e) => { if (tpPrice != null) removeTP(e, pos.id); }}
              >
                <rect x={TP_BX} y={entryY - BTN_H / 2} width={BTN_W} height={BTN_H}
                  rx={3}
                  fill={tpPrice != null ? (pendingTheme ? C.pending : C.tp) : C.badgeBg}
                  stroke={pendingTheme ? C.pending : C.tp} strokeWidth={1} />
                <text x={TP_BX + BTN_W / 2} y={entryY + 4}
                  fill={C.text} fontSize={9} fontWeight={700} textAnchor="middle"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  TP
                </text>
              </g>

              {/* ── × close / cancel ────────────────────────────────── */}
              <g
                style={{ cursor: 'pointer', pointerEvents: 'all' }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => handleClose(e, pos)}
              >
                <rect x={CL_BX} y={entryY - BTN_H / 2} width={BTN_W} height={BTN_H}
                  rx={3} fill={C.badgeBg} stroke={C.short} strokeWidth={1} />
                <text x={CL_BX + BTN_W / 2} y={entryY + 5}
                  fill={C.short} fontSize={12} fontWeight={700} textAnchor="middle"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  ×
                </text>
              </g>

              {/* right-edge price label — clipped so it doesn't overlap the axis */}
              <text x={LX2 - 4} y={entryY - 3}
                fill={entryColor} fontSize={9} fontWeight={600} textAnchor="end"
                fontFamily="'Inter',monospace,sans-serif"
                clipPath={`url(#${CLIP_ID})`}
                style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {isOpen ? `ENTRY ${fmtP(entryPrice)}` : `LIMIT ${fmtP(entryPrice)}`}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
