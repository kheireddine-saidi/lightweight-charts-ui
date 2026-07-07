/**
 * TradePriceLines — TradingView-style horizontal trade line overlay.
 *
 * Per open position / pending order:
 *   • Entry line  — dashed (filled) or solid (pending).  Draggable if pending.
 *   • SL line     — red dashed, draggable, shows projected PnL at that level.
 *   • TP line     — green dashed, draggable, shows projected PnL at that level.
 *
 * Left side of entry line:
 *   • Badge: live PnL (positions) or "PENDING price" (orders)
 *   • [SL] button — click to REMOVE SL only; drag the SL line itself to set/move it
 *   • [TP] button — click to REMOVE TP only; drag the TP line itself to set/move it
 *   • [×] button  — close position / cancel order
 *
 * SL/TP lines are draggable ghosts — project PnL during drag, commit on mouseup.
 * No drag handle shown when SL/TP is not set: a "ghost" drag area is shown instead
 * so the user can drag from the entry area to set SL/TP.
 *
 * Layout offset: BADGE_X starts at LEFT_OFFSET to clear the drawing toolbar.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore }  from '../../stores/marketStore';

// ─── colours ─────────────────────────────────────────────────────────────────
const C = {
  entryLong: '#26a69a',
  entryShort:'#ef5350',
  sl:        '#ef5350',
  tp:        '#26a69a',
  pnlPos:    '#26a69a',
  pnlNeg:    '#ef5350',
  text:      '#d1d4dc',
  textDim:   '#787b86',
  bg:        '#1e222d',
  badgeBg:   '#2a2e39',
  ghostLine: 'rgba(255,255,255,0.15)',
};

// ─── layout ──────────────────────────────────────────────────────────────────
// Offset badge group to clear the left drawing toolbar (~44 px wide)
const LEFT_OFFSET = 52;
const BADGE_W     = 130;
const BADGE_H     = 22;
const BTN_W       = 28;
const BTN_H       = 18;
const BTN_GAP     = 3;
const HIT         = 9;  // vertical px to grab a line

// ─── coordinate helpers ───────────────────────────────────────────────────────
const priceToY = (p, s) => { try { return s?.priceToCoordinate(p) ?? null; } catch { return null; } };
const yToPrice = (y, s) => { try { return s?.coordinateToPrice(y) ?? null; } catch { return null; } };

// ─── PnL ──────────────────────────────────────────────────────────────────────
const calcPnL = (pos, exitPrice) => {
  if (!pos || exitPrice == null) return null;
  const dir = pos.side === 'long' ? 1 : -1;
  return dir * (exitPrice - pos.entryPrice) * pos.positionSize * (pos.leverage ?? 1);
};
const fmt = (v) => {
  if (v == null || !Number.isFinite(v)) return '';
  return (v >= 0 ? '+' : '') + v.toFixed(2);
};
const fmtP = (v) => (v == null ? '' : Number(v).toFixed(5));

// ─── Component ────────────────────────────────────────────────────────────────
export default function TradePriceLines({ containerRef, chartApi, seriesApi, symbol }) {
  const { positions, pendingOrders, closePosition, cancelPendingOrder, updatePosition } =
    useTradingStore();

  const livePrice = useMarketStore((s) => s.getPriceForSymbol(symbol) || s.currentPrice);

  const [dims,      setDims]      = useState({ w: 0, h: 0 });
  const [_tick,     setTick]      = useState(0);
  const [dragGhost, setDragGhost] = useState(null); // { id, handle, price }

  // non-React ref for mousemove/mouseup closures
  const dragRef = useRef(null);

  // ── container size ───────────────────────────────────────────────────────
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

  // ── repaint on scroll/zoom ───────────────────────────────────────────────
  useEffect(() => {
    if (!chartApi) return;
    const bump = () => setTick(n => n + 1);
    const ts = chartApi.timeScale();
    ts.subscribeVisibleLogicalRangeChange(bump);
    return () => ts.unsubscribeVisibleLogicalRangeChange(bump);
  }, [chartApi]);

  // ── repaint on price tick ────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTick(n => n + 1); }, [livePrice]);

  // ── drag ─────────────────────────────────────────────────────────────────
  const startDrag = useCallback((e, id, handle) => {
    e.preventDefault();
    e.stopPropagation();
    const el = containerRef?.current;
    if (!el || !seriesApi) return;

    dragRef.current = { id, handle, price: null };

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const rect = el.getBoundingClientRect();
      const y    = ev.clientY - rect.top;
      const p    = yToPrice(y, seriesApi);
      if (p == null) return;
      dragRef.current.price = p;
      setDragGhost({ id, handle, price: p });
    };

    const onUp = () => {
      if (!dragRef.current) { cleanup(); return; }
      const { id: dId, handle: dHandle, price: dp } = dragRef.current;
      dragRef.current = null;
      setDragGhost(null);

      if (dp != null) {
        // Always use fresh store state — avoids stale closure bug
        const { positions: ps, pendingOrders: po } = useTradingStore.getState();
        const pos = [...ps, ...po].find(p => p.id === dId);
        if (pos) {
          if      (dHandle === 'sl')    updatePosition(dId, { stopLoss:   dp });
          else if (dHandle === 'tp')    updatePosition(dId, { takeProfit: dp });
          else if (dHandle === 'entry') updatePosition(dId, { entryPrice: dp, limitPrice: dp });
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

  // ── remove SL/TP on click ────────────────────────────────────────────────
  const removeSL = useCallback((e, posId) => {
    e.preventDefault(); e.stopPropagation();
    updatePosition(posId, { stopLoss: undefined });
  }, [updatePosition]);

  const removeTP = useCallback((e, posId) => {
    e.preventDefault(); e.stopPropagation();
    updatePosition(posId, { takeProfit: undefined });
  }, [updatePosition]);

  const handleClose = useCallback((e, pos) => {
    e.preventDefault(); e.stopPropagation();
    if (pos._kind === 'position') closePosition(pos.id, livePrice);
    else cancelPendingOrder(pos.id);
  }, [closePosition, cancelPendingOrder, livePrice]);

  // ── render ───────────────────────────────────────────────────────────────
  const { w } = dims;
  if (!seriesApi || !chartApi || w === 0) return null;

  const allItems = [
    ...positions.map(p    => ({ ...p, _kind: 'position' })),
    ...pendingOrders.map(p => ({ ...p, _kind: 'pending'  })),
  ];

  return (
    <svg style={{
      position:'absolute', top:0, left:0,
      width:'100%', height:'100%',
      overflow:'visible', pointerEvents:'none', zIndex:15,
    }}>
      {allItems.map(pos => {
        const isOpen    = pos._kind === 'position';
        const isPending = pos._kind === 'pending';

        // drag ghost overrides
        const ghost     = dragGhost?.id === pos.id ? dragGhost : null;
        const entryPrice = (ghost?.handle === 'entry' ? ghost.price : null) ?? pos.entryPrice;
        const slPrice    = (ghost?.handle === 'sl'    ? ghost.price : null) ?? pos.stopLoss   ?? null;
        const tpPrice    = (ghost?.handle === 'tp'    ? ghost.price : null) ?? pos.takeProfit ?? null;

        const entryY = priceToY(entryPrice, seriesApi);
        if (entryY == null) return null;

        const slY    = slPrice != null ? priceToY(slPrice, seriesApi) : null;
        const tpY    = tpPrice != null ? priceToY(tpPrice, seriesApi) : null;

        const livePnL = isOpen ? calcPnL(pos, livePrice) : null;
        const slPnL   = slPrice != null ? calcPnL(pos, slPrice) : null;
        const tpPnL   = tpPrice != null ? calcPnL(pos, tpPrice) : null;

        const entryColor = pos.side === 'long' ? C.entryLong : C.entryShort;

        // Badge layout — offset from left toolbar
        const BX    = LEFT_OFFSET;
        const BY    = entryY - BADGE_H / 2;
        const SL_BX = BX + BADGE_W + BTN_GAP;
        const TP_BX = SL_BX + BTN_W + BTN_GAP;
        const CL_BX = TP_BX + BTN_W + BTN_GAP;
        const BUTTONS_END = CL_BX + BTN_W;

        return (
          <g key={pos.id}>

            {/* ══ TP ══════════════════════════════════════════════════════ */}
            {tpY != null ? (
              <g>
                {/* shading between entry and TP */}
                <rect x={0} y={Math.min(entryY, tpY)}
                  width={w} height={Math.abs(tpY - entryY)}
                  fill={C.tp} fillOpacity={0.05}
                  style={{ pointerEvents:'none' }} />
                {/* TP line */}
                <line x1={0} y1={tpY} x2={w} y2={tpY}
                  stroke={C.tp} strokeWidth={1} strokeDasharray="6 3"
                  style={{ pointerEvents:'none' }} />
                {/* drag hit area */}
                <rect x={BUTTONS_END + 8} y={tpY - HIT}
                  width={w - BUTTONS_END - 8} height={HIT * 2}
                  fill="transparent"
                  style={{ cursor:'ns-resize', pointerEvents:'all' }}
                  onMouseDown={(e) => startDrag(e, pos.id, 'tp')} />
                {/* TP PnL label */}
                {tpPnL != null && (
                  <g style={{ pointerEvents:'none' }}>
                    <rect x={w / 2 - 52} y={tpY - 9} width={104} height={16}
                      rx={3} fill={C.bg} fillOpacity={0.9} />
                    <text x={w / 2} y={tpY + 4}
                      fill={tpPnL >= 0 ? C.pnlPos : C.pnlNeg}
                      fontSize={10} fontWeight={700} textAnchor="middle"
                      fontFamily="'Inter',monospace,sans-serif">
                      TP {fmt(tpPnL)}
                    </text>
                  </g>
                )}
                {/* TP price label right */}
                <text x={w - 6} y={tpY - 3}
                  fill={C.tp} fontSize={9} fontWeight={600} textAnchor="end"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents:'none', userSelect:'none' }}>
                  {fmtP(tpPrice)}
                </text>
              </g>
            ) : (
              /* Ghost drag zone for setting TP when not set (drag from entry line area) */
              null
            )}

            {/* ══ SL ══════════════════════════════════════════════════════ */}
            {slY != null ? (
              <g>
                {/* shading */}
                <rect x={0} y={Math.min(entryY, slY)}
                  width={w} height={Math.abs(slY - entryY)}
                  fill={C.sl} fillOpacity={0.05}
                  style={{ pointerEvents:'none' }} />
                {/* SL line */}
                <line x1={0} y1={slY} x2={w} y2={slY}
                  stroke={C.sl} strokeWidth={1} strokeDasharray="6 3"
                  style={{ pointerEvents:'none' }} />
                {/* drag hit area */}
                <rect x={BUTTONS_END + 8} y={slY - HIT}
                  width={w - BUTTONS_END - 8} height={HIT * 2}
                  fill="transparent"
                  style={{ cursor:'ns-resize', pointerEvents:'all' }}
                  onMouseDown={(e) => startDrag(e, pos.id, 'sl')} />
                {/* SL PnL label */}
                {slPnL != null && (
                  <g style={{ pointerEvents:'none' }}>
                    <rect x={w / 2 - 52} y={slY - 9} width={104} height={16}
                      rx={3} fill={C.bg} fillOpacity={0.9} />
                    <text x={w / 2} y={slY + 4}
                      fill={slPnL >= 0 ? C.pnlPos : C.pnlNeg}
                      fontSize={10} fontWeight={700} textAnchor="middle"
                      fontFamily="'Inter',monospace,sans-serif">
                      SL {fmt(slPnL)}
                    </text>
                  </g>
                )}
                {/* SL price right */}
                <text x={w - 6} y={slY - 3}
                  fill={C.sl} fontSize={9} fontWeight={600} textAnchor="end"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents:'none', userSelect:'none' }}>
                  {fmtP(slPrice)}
                </text>
              </g>
            ) : null}

            {/* ══ Entry line ══════════════════════════════════════════════ */}
            <g>
              {/* line */}
              <line x1={0} y1={entryY} x2={w} y2={entryY}
                stroke={entryColor} strokeWidth={1.5}
                strokeDasharray={isOpen ? '4 3' : undefined}
                style={{ pointerEvents:'none' }} />

              {/* drag hit — pending only, right of buttons group */}
              {isPending && (
                <rect x={BUTTONS_END + 8} y={entryY - HIT}
                  width={w - BUTTONS_END - 8} height={HIT * 2}
                  fill="transparent"
                  style={{ cursor:'ns-resize', pointerEvents:'all' }}
                  onMouseDown={(e) => startDrag(e, pos.id, 'entry')} />
              )}

              {/* ── Badge ─────────────────────────────────────────────── */}
              <g style={{ pointerEvents:'none' }}>
                {/* background */}
                <rect x={BX} y={BY} width={BADGE_W} height={BADGE_H}
                  rx={4} fill={C.badgeBg} stroke={entryColor} strokeWidth={1} />
                {/* colour bar left edge */}
                <rect x={BX} y={BY} width={3} height={BADGE_H}
                  rx={2} fill={entryColor} />
                {/* PnL / status text */}
                {livePnL != null ? (
                  <>
                    <text x={BX + 10} y={entryY + 4}
                      fill={livePnL >= 0 ? C.pnlPos : C.pnlNeg}
                      fontSize={11} fontWeight={700}
                      fontFamily="'Inter',monospace,sans-serif">
                      {fmt(livePnL)}
                    </text>
                    <text x={BX + BADGE_W - 4} y={entryY + 4}
                      fill={C.textDim} fontSize={9} fontWeight={500}
                      textAnchor="end"
                      fontFamily="'Inter',monospace,sans-serif">
                      {fmtP(entryPrice)}
                    </text>
                  </>
                ) : (
                  <text x={BX + 10} y={entryY + 4}
                    fill={C.text} fontSize={9} fontWeight={600}
                    fontFamily="'Inter',monospace,sans-serif">
                    {isPending ? 'PENDING' : ''} {fmtP(entryPrice)}
                  </text>
                )}
              </g>

              {/* ── SL button — click removes SL ──────────────────────── */}
              <g style={{ cursor: slPrice != null ? 'pointer' : 'ns-resize', pointerEvents:'all' }}
                 onMouseDown={(e) => {
                   e.stopPropagation();
                   // If SL not set: drag this button to set SL
                   if (slPrice == null) startDrag(e, pos.id, 'sl');
                 }}
                 onClick={(e) => {
                   if (slPrice != null) removeSL(e, pos.id);
                 }}>
                <rect x={SL_BX} y={entryY - BTN_H / 2} width={BTN_W} height={BTN_H}
                  rx={3}
                  fill={slPrice != null ? C.sl : C.badgeBg}
                  stroke={C.sl} strokeWidth={1} />
                <text x={SL_BX + BTN_W / 2} y={entryY + 4}
                  fill={C.text} fontSize={9} fontWeight={700} textAnchor="middle"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents:'none', userSelect:'none' }}>
                  SL
                </text>
              </g>

              {/* ── TP button — click removes TP ──────────────────────── */}
              <g style={{ cursor: tpPrice != null ? 'pointer' : 'ns-resize', pointerEvents:'all' }}
                 onMouseDown={(e) => {
                   e.stopPropagation();
                   if (tpPrice == null) startDrag(e, pos.id, 'tp');
                 }}
                 onClick={(e) => {
                   if (tpPrice != null) removeTP(e, pos.id);
                 }}>
                <rect x={TP_BX} y={entryY - BTN_H / 2} width={BTN_W} height={BTN_H}
                  rx={3}
                  fill={tpPrice != null ? C.tp : C.badgeBg}
                  stroke={C.tp} strokeWidth={1} />
                <text x={TP_BX + BTN_W / 2} y={entryY + 4}
                  fill={C.text} fontSize={9} fontWeight={700} textAnchor="middle"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents:'none', userSelect:'none' }}>
                  TP
                </text>
              </g>

              {/* ── × close/cancel button ─────────────────────────────── */}
              <g style={{ cursor:'pointer', pointerEvents:'all' }}
                 onMouseDown={(e) => e.stopPropagation()}
                 onClick={(e) => handleClose(e, pos)}>
                <rect x={CL_BX} y={entryY - BTN_H / 2} width={BTN_W} height={BTN_H}
                  rx={3} fill={C.badgeBg} stroke={C.sl} strokeWidth={1} />
                <text x={CL_BX + BTN_W / 2} y={entryY + 5}
                  fill={C.sl} fontSize={12} fontWeight={700} textAnchor="middle"
                  fontFamily="'Inter',monospace,sans-serif"
                  style={{ pointerEvents:'none', userSelect:'none' }}>
                  ×
                </text>
              </g>

              {/* Entry price right edge */}
              <text x={w - 6} y={entryY - 3}
                fill={entryColor} fontSize={9} fontWeight={600} textAnchor="end"
                fontFamily="'Inter',monospace,sans-serif"
                style={{ pointerEvents:'none', userSelect:'none' }}>
                {isOpen ? `ENTRY ${fmtP(entryPrice)}` : `LIMIT ${fmtP(entryPrice)}`}
              </text>
            </g>

          </g>
        );
      })}
    </svg>
  );
}
