// components/PositionsPanel/PositionsPanel.tsx
import React, { useState } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore } from '../../stores/marketStore';
import { useThemeStore } from '../../stores/themeStore';
import TradeJournal from '../Journal/TradeJournal';
import EditablePrice from '../shared/EditablePrice';
import { validateTPSL } from '../../utils/tpslValidation';

/* ─── Design tokens ─────────────────────────────────────────────────────────
 * Values are CSS custom properties so the panel responds live to dark/light
 * theme changes without rewriting every styled-component usage site. The
 * actual hex values per theme are injected by <PanelThemeVars> below, scoped
 * to this panel's wrapper via [data-pp-theme].
 */
const C = {
  bg: 'var(--pp-bg)',
  surface: 'var(--pp-surface)',
  surfaceAlt: 'var(--pp-surface-alt)',
  border: 'var(--pp-border)',
  text: 'var(--pp-text)',
  textMuted: 'var(--pp-text-muted)',
  textDim: 'var(--pp-text-dim)',
  green: 'var(--pp-green)',
  greenMuted: 'var(--pp-green-muted)',
  red: 'var(--pp-red)',
  redMuted: 'var(--pp-red-muted)',
  blue: 'var(--pp-blue)',
  orange: 'var(--pp-orange)',
  orangeMuted: 'var(--pp-orange-muted)',
};

const DARK_VARS = {
  '--pp-bg': '#131722',
  '--pp-surface': '#1e222d',
  '--pp-surface-alt': '#252b3b',
  '--pp-border': '#2a2e39',
  '--pp-text': '#d1d4dc',
  '--pp-text-muted': '#787b86',
  '--pp-text-dim': '#555b6e',
  '--pp-green': '#089981',
  '--pp-green-muted': 'rgba(8,153,129,0.12)',
  '--pp-red': '#f23645',
  '--pp-red-muted': 'rgba(242,54,69,0.12)',
  '--pp-blue': '#2962ff',
  '--pp-orange': '#f0a500',
  '--pp-orange-muted': 'rgba(240,165,0,0.12)',
};

const LIGHT_VARS = {
  '--pp-bg': '#ffffff',
  '--pp-surface': '#f8f9fb',
  '--pp-surface-alt': '#eef0f3',
  '--pp-border': '#e0e3eb',
  '--pp-text': '#131722',
  '--pp-text-muted': '#5d606b',
  '--pp-text-dim': '#9598a1',
  '--pp-green': '#089981',
  '--pp-green-muted': 'rgba(8,153,129,0.10)',
  '--pp-red': '#f23645',
  '--pp-red-muted': 'rgba(242,54,69,0.10)',
  '--pp-blue': '#2962ff',
  '--pp-orange': '#b8790a',
  '--pp-orange-muted': 'rgba(184,121,10,0.10)',
};

const PanelThemeVars = createGlobalStyle<{ $vars: Record<string, string> }>`
  [data-pp-theme] {
    ${(p) => Object.entries(p.$vars).map(([k, v]) => `${k}: ${v};`).join('\n    ')}
  }
`;

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 12px;
  color: ${C.text};
  overflow: hidden;
`;

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid ${C.border};
  flex-shrink: 0;
`;

const Tab = styled.button<{ $active: boolean }>`
  padding: 8px 14px;
  background: none;
  border: none;
  border-bottom: 2px solid ${(p) => (p.$active ? C.blue : 'transparent')};
  color: ${(p) => (p.$active ? C.text : C.textMuted)};
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? '600' : '400')};
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s;
  margin-bottom: -1px;
  &:hover { color: ${C.text}; }
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 5px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: ${C.surfaceAlt};
  color: ${C.textMuted};
  font-size: 10px;
  font-weight: 600;
`;

const ScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  &::-webkit-scrollbar { width: 4px; height: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 6px;
  color: ${C.textDim};
  font-size: 12px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  min-width: 700px;
`;

const TH = styled.th`
  padding: 6px 10px;
  text-align: left;
  color: ${C.textMuted};
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid ${C.border};
  white-space: nowrap;
  position: sticky;
  top: 0;
  background: ${C.surface};
  z-index: 1;
`;

const TR = styled.tr`
  &:hover td { background: ${C.surfaceAlt}; }
  &:not(:last-child) td { border-bottom: 1px solid ${C.border}; }
`;

const TD = styled.td`
  padding: 7px 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: background 0.1s;
`;

const SidePill = styled.span<{ $side: string }>`
  display: inline-block;
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  background: ${(p) => (p.$side === 'long' ? C.greenMuted : C.redMuted)};
  color: ${(p) => (p.$side === 'long' ? C.green : C.red)};
`;

const PendingPill = styled.span`
  display: inline-block;
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  background: ${C.orangeMuted};
  color: ${C.orange};
`;

const PnLCell = styled.span<{ $val: number }>`
  color: ${(p) => (p.$val >= 0 ? C.green : C.red)};
  font-weight: 600;
`;

const ActionBtn = styled.button`
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid ${C.border};
  background: transparent;
  color: ${C.textMuted};
  font-size: 11px;
  cursor: pointer;
  transition: all 0.1s;
  &:hover {
    border-color: ${C.red};
    color: ${C.red};
    background: ${C.redMuted};
  }
`;

const SummaryRow = styled.div`
  display: flex;
  gap: 20px;
  padding: 6px 10px;
  border-top: 1px solid ${C.border};
  background: ${C.surface};
  flex-shrink: 0;
`;

const SumItem = styled.div`
  display: flex;
  gap: 5px;
  align-items: center;
  font-size: 11px;
`;

const SumLabel = styled.span`
  color: ${C.textMuted};
`;

const SumVal = styled.span<{ $color?: string }>`
  color: ${(p) => p.$color || C.text};
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

/* ─── Helpers ─── */
const formatDateTime = (ts: number | undefined) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
};

/* Compute live PnL from current price (used for display; store also updates) */
const livePnL = (pos: any, currentPrice: number) => {
  if (pos.status === 'pending') return null;
  const pnl =
    pos.side === 'long'
      ? (currentPrice - pos.entryPrice) * pos.positionSize * pos.leverage
      : (pos.entryPrice - currentPrice) * pos.positionSize * pos.leverage;
  const pnlPct = (pnl / (pos.entryPrice * pos.positionSize)) * 100;
  return { pnl, pnlPct };
};

/* ─── Tabs ─── */
const OpenTab = () => {
  const positions = useTradingStore((s) => s.positions);
  const pendingOrders = useTradingStore((s) => s.pendingOrders);
  const closePosition = useTradingStore((s) => s.closePosition);
  const cancelPendingOrder = useTradingStore((s) => s.cancelPendingOrder);
  const updatePosition = useTradingStore((s) => s.updatePosition);
  const updatePendingOrder = useTradingStore((s) => s.updatePendingOrder);
  const currentPrice = useMarketStore((s) => s.currentPrice);

  const allItems = [...positions, ...pendingOrders];

  if (allItems.length === 0) {
    return <EmptyState>📭 No open positions or pending orders</EmptyState>;
  }

  const fmt = (n: number, dec = 5) => n.toFixed(dec);

  // Compute live total PnL from current price
  const totalPnL = positions.reduce((s, p) => {
    const live = livePnL(p, currentPrice);
    return s + (live ? live.pnl : 0);
  }, 0);

  return (
    <>
      <ScrollArea>
        <Table>
          <thead>
            <tr>
              <TH>Order ID</TH>
              <TH>Side</TH>
              <TH>Symbol</TH>
              <TH>Size</TH>
              <TH>Lev</TH>
              <TH>Entry</TH>
              <TH>Current</TH>
              <TH>PnL</TH>
              <TH>SL / TP</TH>
              <TH>Filled At</TH>
              <TH>Action</TH>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const live = livePnL(pos, currentPrice);
              const pnl = live ? live.pnl : pos.pnl;
              const pnlPct = live ? live.pnlPct : pos.pnlPercent;
              return (
                <TR key={pos.id}>
                  <TD style={{ color: C.textMuted, fontFamily: 'monospace', fontSize: 11 }}>{pos.id}</TD>
                  <TD><SidePill $side={pos.side}>{pos.side.toUpperCase()}</SidePill></TD>
                  <TD style={{ color: C.text, fontWeight: 500 }}>{pos.symbol}</TD>
                  <TD>{pos.positionSize}</TD>
                  <TD>{pos.leverage}×</TD>
                  <TD>
                    {/* Entry is locked for open positions — cannot be changed after fill */}
                    <EditablePrice
                      value={pos.entryPrice}
                      locked
                      onValidate={() => ({ valid: false, message: null })}
                      onCommit={() => {}}
                    />
                  </TD>
                  <TD style={{ color: C.textMuted }}>{fmt(currentPrice)}</TD>
                  <TD>
                    <PnLCell $val={pnl}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                      <span style={{ color: C.textDim, fontWeight: 400, fontSize: 10, marginLeft: 3 }}>
                        ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                      </span>
                    </PnLCell>
                  </TD>
                  <TD style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>
                    <EditablePrice
                      value={pos.stopLoss}
                      color={C.red}
                      onValidate={(newVal) => {
                        const r = validateTPSL(pos.side, 'open', currentPrice, pos.takeProfit ?? null, newVal);
                        return { valid: r.valid || r.field !== 'sl', message: r.field === 'sl' ? r.message : null };
                      }}
                      onCommit={(newVal) => updatePosition(pos.id, { stopLoss: newVal })}
                    />
                    {' / '}
                    <EditablePrice
                      value={pos.takeProfit}
                      color={C.green}
                      onValidate={(newVal) => {
                        const r = validateTPSL(pos.side, 'open', currentPrice, newVal, pos.stopLoss ?? null);
                        return { valid: r.valid || r.field !== 'tp', message: r.field === 'tp' ? r.message : null };
                      }}
                      onCommit={(newVal) => updatePosition(pos.id, { takeProfit: newVal })}
                    />
                  </TD>
                  <TD style={{ color: C.textMuted, fontSize: 11 }}>
                    {formatDateTime(pos.filledTime ?? pos.entryTime)}
                  </TD>
                  <TD>
                    <ActionBtn onClick={() => closePosition(pos.id, currentPrice)}>Close</ActionBtn>
                  </TD>
                </TR>
              );
            })}
            {pendingOrders.map((order) => (
              <TR key={order.id}>
                <TD style={{ color: C.textMuted, fontFamily: 'monospace', fontSize: 11 }}>{order.id}</TD>
                <TD>
                  <PendingPill>LIMIT {order.side.toUpperCase()}</PendingPill>
                </TD>
                <TD style={{ color: C.text, fontWeight: 500 }}>{order.symbol}</TD>
                <TD>{order.positionSize}</TD>
                <TD>{order.leverage}×</TD>
                <TD>
                  {/* Entry IS editable for pending (not-yet-filled) orders */}
                  <EditablePrice
                    value={order.entryPrice}
                    color={C.orange}
                    onValidate={() => ({ valid: true, message: null })}
                    onCommit={(newVal) => updatePendingOrder(order.id, { entryPrice: newVal, limitPrice: newVal })}
                  />
                </TD>
                <TD style={{ color: C.textMuted }}>{fmt(currentPrice)}</TD>
                <TD style={{ color: C.textDim }}>—</TD>
                <TD style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>
                  {/* Pending orders: SL/TP validated against the order's ENTRY price, not market */}
                  <EditablePrice
                    value={order.stopLoss}
                    color={C.red}
                    onValidate={(newVal) => {
                      const r = validateTPSL(order.side, 'pending', order.entryPrice, order.takeProfit ?? null, newVal);
                      return { valid: r.valid || r.field !== 'sl', message: r.field === 'sl' ? r.message : null };
                    }}
                    onCommit={(newVal) => updatePendingOrder(order.id, { stopLoss: newVal })}
                  />
                  {' / '}
                  <EditablePrice
                    value={order.takeProfit}
                    color={C.green}
                    onValidate={(newVal) => {
                      const r = validateTPSL(order.side, 'pending', order.entryPrice, newVal, order.stopLoss ?? null);
                      return { valid: r.valid || r.field !== 'tp', message: r.field === 'tp' ? r.message : null };
                    }}
                    onCommit={(newVal) => updatePendingOrder(order.id, { takeProfit: newVal })}
                  />
                </TD>
                <TD style={{ color: C.textMuted, fontSize: 11 }}>
                  Pending — {formatDateTime(order.entryTime)}
                </TD>
                <TD>
                  <ActionBtn onClick={() => cancelPendingOrder(order.id)}>Cancel</ActionBtn>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </ScrollArea>
      {positions.length > 0 && (
        <SummaryRow>
          <SumItem>
            <SumLabel>Open P&L:</SumLabel>
            <SumVal $color={totalPnL >= 0 ? C.green : C.red}>
              {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
            </SumVal>
          </SumItem>
          <SumItem>
            <SumLabel>Positions:</SumLabel>
            <SumVal>{positions.length}</SumVal>
          </SumItem>
          {pendingOrders.length > 0 && (
            <SumItem>
              <SumLabel>Pending:</SumLabel>
              <SumVal $color={C.orange}>{pendingOrders.length}</SumVal>
            </SumItem>
          )}
        </SummaryRow>
      )}
    </>
  );
};

const HistoryTab = () => {
  const closedPositions = useTradingStore((s) => s.closedPositions);

  if (closedPositions.length === 0) {
    return <EmptyState>📋 No trade history yet</EmptyState>;
  }

  const totalPnL = closedPositions.reduce((s, p) => s + p.pnl, 0);
  const wins = closedPositions.filter((p) => p.pnl > 0).length;
  const winRate = closedPositions.length > 0 ? (wins / closedPositions.length) * 100 : 0;
  const fmt = (n: number, dec = 5) => n.toFixed(dec);

  return (
    <>
      <ScrollArea>
        <Table>
          <thead>
            <tr>
              <TH>Order ID</TH>
              <TH>Side</TH>
              <TH>Symbol</TH>
              <TH>Size / Lev</TH>
              <TH>Entry</TH>
              <TH>Exit</TH>
              <TH>PnL</TH>
              <TH>% Return</TH>
              <TH>Filled At</TH>
              <TH>Closed At</TH>
            </tr>
          </thead>
          <tbody>
            {closedPositions.map((pos) => (
              <TR key={pos.id}>
                <TD style={{ color: C.textMuted, fontFamily: 'monospace', fontSize: 11 }}>{pos.id}</TD>
                <TD><SidePill $side={pos.side}>{pos.side.toUpperCase()}</SidePill></TD>
                <TD style={{ color: C.text, fontWeight: 500 }}>{pos.symbol}</TD>
                <TD style={{ color: C.textMuted }}>{pos.positionSize} · {pos.leverage}×</TD>
                <TD>{fmt(pos.entryPrice)}</TD>
                <TD>{fmt(pos.closePrice)}</TD>
                <TD>
                  <PnLCell $val={pos.pnl}>
                    {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)}
                  </PnLCell>
                </TD>
                <TD>
                  <PnLCell $val={pos.pnlPercent}>
                    {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                  </PnLCell>
                </TD>
                <TD style={{ color: C.textMuted, fontSize: 11 }}>
                  {formatDateTime(pos.filledTime ?? pos.entryTime)}
                </TD>
                <TD style={{ color: C.textMuted, fontSize: 11 }}>
                  {formatDateTime(pos.closeTime)}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </ScrollArea>
      <SummaryRow>
        <SumItem>
          <SumLabel>Total P&L:</SumLabel>
          <SumVal $color={totalPnL >= 0 ? C.green : C.red}>
            {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
          </SumVal>
        </SumItem>
        <SumItem>
          <SumLabel>Win Rate:</SumLabel>
          <SumVal $color={winRate >= 50 ? C.green : C.red}>{winRate.toFixed(0)}%</SumVal>
        </SumItem>
        <SumItem>
          <SumLabel>Trades:</SumLabel>
          <SumVal>{closedPositions.length}</SumVal>
        </SumItem>
        <SumItem>
          <SumLabel>W/L:</SumLabel>
          <SumVal>{wins}/{closedPositions.length - wins}</SumVal>
        </SumItem>
      </SummaryRow>
    </>
  );
};

const PositionsPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'open' | 'history' | 'journal'>('open');
  const positions = useTradingStore((s) => s.positions);
  const pendingOrders = useTradingStore((s) => s.pendingOrders);
  const closedPositions = useTradingStore((s) => s.closedPositions);
  const theme = useThemeStore((s) => s.theme);
  const themeVars = theme === 'light' ? LIGHT_VARS : DARK_VARS;

  return (
    <Wrap data-pp-theme={theme}>
      <PanelThemeVars $vars={themeVars} />
      <TabBar>
        <Tab $active={activeTab === 'open'} onClick={() => setActiveTab('open')}>
          Positions
          {(positions.length + pendingOrders.length) > 0 && (
            <Badge>{positions.length + pendingOrders.length}</Badge>
          )}
        </Tab>
        <Tab $active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
          History
          {closedPositions.length > 0 && <Badge>{closedPositions.length}</Badge>}
        </Tab>
        <Tab $active={activeTab === 'journal'} onClick={() => setActiveTab('journal')}>
          Journal
        </Tab>
      </TabBar>
      {activeTab === 'open' && <OpenTab />}
      {activeTab === 'history' && <HistoryTab />}
      {activeTab === 'journal' && <TradeJournal />}
    </Wrap>
  );
};

export default PositionsPanel;
