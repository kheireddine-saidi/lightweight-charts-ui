// components/TradingPanel/TradingPanel.jsx
import React, { useState, useCallback, useEffect } from 'react';
import styled from 'styled-components';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore } from '../../stores/marketStore';
import { useTradeSetupStore } from '../../stores/tradeSetupStore';
import { useWorkspaceStore } from '../../features/workspace/WorkspaceStore';
import { useExecutionSettingsStore } from '../../stores/executionSettingsStore';
import { EventBus, Events } from '../../core/EventBus';
import { validateTPSL } from '../../utils/tpslValidation';
import { calculateRiskBasedPositionSize } from '../../utils/positionSizing';

/* ─── Design tokens ─── */
const C = {
  bg: '#131722', surface: '#1e222d', elevated: '#2a2e39',
  border: '#2a2e39',
  text: '#d1d4dc', muted: '#787b86', dim: '#555b6e',
  green: '#0ecb81', greenBg: 'rgba(14,203,129,0.12)',
  red: '#f23645',   redBg:  'rgba(242,54,69,0.12)',
  blue: '#2962ff',  orange: '#f0a500',
};

/* ─── Layout ─── */
const Panel = styled.div`
  display: flex; flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 13px; color: ${C.text};
  background: ${C.bg}; height: 100%; overflow: hidden;
`;

const TopBar = styled.div`
  padding: 12px 16px 0;
  display: flex; flex-direction: column; gap: 6px;
`;

const TickerRow = styled.div`
  display: flex; align-items: center; gap: 8px;
`;

const TickerName = styled.div`
  font-size: 16px; font-weight: 700; color: ${C.text}; letter-spacing: .02em;
`;

const LivePrice = styled.div`
  font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: ${p => p.$up ? C.green : C.red};
  background: ${p => p.$up ? C.greenBg : C.redBg};
  padding: 2px 8px; border-radius: 4px;
`;

const LevRow = styled.div`
  display: flex; align-items: center; gap: 8px;
`;

const BadgeBtn = styled.div`
  background: ${C.elevated}; border-radius: 4px; padding: 4px 10px;
  font-size: 11px; font-weight: 500; color: ${C.muted}; cursor: default;
`;

const LevLabel = styled.span` font-size: 11px; color: ${C.muted}; `;

const LevInput = styled.input`
  background: ${C.elevated}; border: 1px solid ${C.border}; border-radius: 4px;
  padding: 3px 8px; font-size: 12px; font-weight: 700; color: ${C.text};
  width: 58px; outline: none; text-align: center;
  &:focus { border-color: ${C.blue}; }
  -moz-appearance: textfield;
  &::-webkit-outer-spin-button, &::-webkit-inner-spin-button { -webkit-appearance: none; }
`;

const Tabs = styled.div`
  display: flex; gap: 16px; padding: 0 16px;
  margin-top: 8px; border-bottom: 1px solid ${C.border};
`;

const Tab = styled.div`
  padding: 8px 0; font-size: 13px;
  font-weight: ${p => p.$active ? 600 : 500};
  color: ${p => p.$active ? C.text : C.muted};
  border-bottom: 3px solid ${p => p.$active ? C.orange : 'transparent'};
  cursor: pointer; transition: color .15s;
  &:hover { color: ${C.text}; }
`;

const Form = styled.div`
  flex: 1; overflow-y: auto; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 11px;
  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
`;

const Banner = styled.div`
  padding: 6px 10px; background: rgba(41,98,255,.1);
  border-left: 3px solid ${C.blue}; border-radius: 0 4px 4px 0;
  font-size: 11px; color: ${C.blue};
`;

/* ─── Field ─── */
const FieldGroup = styled.div` display: flex; flex-direction: column; gap: 4px; `;
const FieldLabel = styled.label` font-size: 11px; color: ${C.muted}; `;
const InputRow = styled.div`
  display: flex; align-items: center;
  background: ${C.elevated}; border-radius: 6px; height: 38px;
  padding: 0 12px; border: 1px solid transparent;
  &:focus-within { border-color: ${C.muted}; }
`;
const Inp = styled.input`
  flex: 1; background: transparent; border: none; outline: none;
  color: ${C.text}; font-size: 13px; font-variant-numeric: tabular-nums;
  width: 100%; min-width: 0; /* 👈 Fix: Ensures input dynamically shrinks */
  &::placeholder { color: ${C.dim}; }
  -moz-appearance: textfield;
  &::-webkit-outer-spin-button, &::-webkit-inner-spin-button { -webkit-appearance: none; }
`;
const InpSuffix = styled.span` color: ${C.muted}; font-size: 12px; `;

/* ─── Market price display in market mode ─── */
const MarketPriceBox = styled.div`
  background: ${C.elevated}; border-radius: 6px; height: 38px;
  padding: 0 12px; display: flex; align-items: center; justify-content: space-between;
`;
const MarketPriceVal = styled.span`
  font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: ${C.text};
`;

/* ─── Slider ─── */
const SliderWrap = styled.div` margin-top: -2px; `;
const Track = styled.div`
  position: relative; height: 4px; background: ${C.elevated}; border-radius: 2px; margin-bottom: 4px;
`;
const Fill = styled.div`
  position: absolute; left: 0; top: 0; height: 100%;
  width: ${p => p.$pct}%; background: ${C.blue}; border-radius: 2px; pointer-events: none;
`;
const SliderEl = styled.input.attrs({type:'range'})`
  position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; margin: 0;
`;
const Marks = styled.div`
  display: flex; justify-content: space-between; font-size: 10px; color: ${C.dim};
`;
const Mark = styled.span` cursor: pointer; padding: 1px 3px; &:hover { color: ${C.text}; } `;

/* ─── Cost / TP / SL ─── */
const CostRow = styled.div`
  display: flex; justify-content: space-between;
  font-size: 11px; color: ${C.muted};
  padding: 4px 0; border-top: 1px solid ${C.border};
`;

const TPSLGrid = styled.div`
  display: grid; 
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); /* 👈 Fix: Prevents grid blow-out */
  gap: 8px;
`;

const FieldWrap = styled.div`
  position: relative;
`;

const WarningBubble = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0; right: 0;
  background: ${C.surface};
  border: 1px solid ${C.red};
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 11px;
  color: ${C.text};
  box-shadow: 0 6px 18px rgba(0,0,0,.5);
  z-index: 50;
  &::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 24px;
    border: 6px solid transparent;
    border-top-color: ${C.red};
  }
`;

const RRBadge = styled.div`
  border-radius: 4px; padding: 6px 10px; font-size: 11px;
  display: flex; justify-content: space-between; align-items: center;
  background: ${p => p.$risk==='high' ? C.redBg : p.$risk==='med' ? 'rgba(240,165,0,.12)' : C.greenBg};
  color: ${p => p.$risk==='high' ? C.red : p.$risk==='med' ? C.orange : C.green};
`;

/* ─── Actions ─── */
const ActionRow = styled.div` display: flex; gap: 10px; `;
const ActionBtn = styled.button`
  flex: 1; height: 42px; border: none; border-radius: 6px;
  font-weight: 700; font-size: 13px; color: #fff; cursor: pointer;
  background: ${p => p.$side==='long' ? C.green : C.red};
  &:hover { opacity: .9; }
  &:disabled { opacity: .4; cursor: not-allowed; }
`;

/* ─── Balance footer ─── */
const BalanceFooter = styled.div`
  padding: 10px 16px; border-top: 1px solid ${C.border};
  background: ${C.surface}; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 5px;
`;

const BalRow = styled.div`
  display: flex; justify-content: space-between; align-items: center; font-size: 11px;
`;
const BalLabel = styled.span` color: ${C.muted}; `;
const BalVal = styled.span`
  color: ${p => p.$color || C.text}; font-weight: 600; font-variant-numeric: tabular-nums;
`;
const MarginBarWrap = styled.div` height: 3px; background: ${C.elevated}; border-radius: 2px; overflow: hidden; `;
const MarginFill = styled.div`
  height: 100%; border-radius: 2px;
  width: ${p => Math.min(p.$pct, 100)}%;
  background: ${p => p.$pct > 80 ? C.red : p.$pct > 50 ? C.orange : C.blue};
  transition: width .3s;
`;

const SIZE_MARKS = [0, 25, 50, 75, 100];

const TradingPanel = ({ currentTime }) => {
  const [orderType, setOrderType]   = useState('limit');
  const [quoteSize, setQuoteSize]   = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [leverage, setLeverage]     = useState(20);
  const [slider, setSlider]         = useState(0);
  const [stopLoss, setStopLoss]     = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [tpWarning, setTpWarning]   = useState(null);
  const [slWarning, setSlWarning]   = useState(null);
  const [fromSetup, setFromSetup]   = useState(false);
  const [pendingZoneId, setPendingZoneId] = useState(null);
  const [prevPrice, setPrevPrice]   = useState(null);
  const [sizeOverridden, setSizeOverridden] = useState(false);

  const { openPosition, balance, equity, reservedMargin = 0 } = useTradingStore();
  const currentPrice   = useMarketStore(s => s.currentPrice);
  const tradeSetup     = useTradeSetupStore(s => s);
  const symbol         = useWorkspaceStore(s => s.getActiveChart()?.symbol ?? 'BTCUSDT');
  const riskPerTradePercent = useExecutionSettingsStore(s => s.riskPerTradePercent);

  // Track price direction for colour indicator
  useEffect(() => {
    setPrevPrice(p => { if (p !== null && p !== currentPrice) return currentPrice; return currentPrice; });
  }, [currentPrice]);
  const priceUp = prevPrice === null || currentPrice >= prevPrice;

  // Margin calculations
  const freeMargin     = Math.max(0, balance - reservedMargin);
  const entryPrice     = orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : currentPrice;
  const quoteSizeNum   = parseFloat(quoteSize) || 0;
  const positionSize   = entryPrice > 0 ? quoteSizeNum / entryPrice : 0;
  const requiredMargin = leverage > 0 ? quoteSizeNum / leverage : 0;
  const maxPosVal      = freeMargin * leverage;
  const marginUsedPct  = balance > 0 ? (reservedMargin / balance) * 100 : 0;

  const setFromSlider = (pct) => {
    setSizeOverridden(true);
    setSlider(pct);
    const val = (pct / 100) * maxPosVal;
    setQuoteSize(val > 0 ? val.toFixed(2) : '');
  };
  const handleSizeChange = (v) => {
    if (v === '') {
      setSizeOverridden(false);
    } else {
      setSizeOverridden(true);
    }
    setQuoteSize(v);
    const num = parseFloat(v) || 0;
    setSlider(Math.round(maxPosVal > 0 ? Math.min(100, (num / maxPosVal) * 100) : 0));
  };

  // Risk / Reward display
  const slNum         = stopLoss   ? parseFloat(stopLoss)   : null;
  const tpNum         = takeProfit ? parseFloat(takeProfit) : null;
  const riskAmt       = slNum ? Math.abs(entryPrice - slNum)  * positionSize * leverage : null;
  const rewardAmt     = tpNum ? Math.abs(tpNum - entryPrice)  * positionSize * leverage : null;

  // ── TP/SL validation ──────────────────────────────────────────────────
  const refPriceForValidation = orderType === 'market' ? currentPrice : (entryPrice || currentPrice);
  const validationStatus = orderType === 'market' ? 'open' : 'pending';
  const riskPct       = riskAmt && freeMargin > 0 ? (riskAmt / freeMargin) * 100 : null;
  const rrRatio       = riskAmt && rewardAmt ? rewardAmt / riskAmt : null;
  const riskLevel     = riskPct == null ? 'low' : riskPct > 5 ? 'high' : riskPct > 2 ? 'med' : 'low';

  // ── Auto-sizing effect ─────────────────────────────────────────────────
  useEffect(() => {
    if (sizeOverridden) return;
    if (!slNum || !entryPrice) return;
    const sizing = calculateRiskBasedPositionSize({
      balance, riskPercent: riskPerTradePercent, entryPrice, stopLossPrice: slNum, leverage,
    });
    if (sizing) {
      setQuoteSize(sizing.quoteSize.toFixed(2));
      setSlider(Math.round(maxPosVal > 0 ? Math.min(100, (sizing.quoteSize / maxPosVal) * 100) : 0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slNum, entryPrice, leverage, riskPerTradePercent, sizeOverridden]);

  // ── Trade Setup Tool sync ──────────────────────────────────────────────
  useEffect(() => {
    if (!tradeSetup.isReady) return;
    setOrderType('limit');
    if (tradeSetup.entryPrice != null) setLimitPrice(String(tradeSetup.entryPrice));
    if (tradeSetup.stopLoss   != null) setStopLoss(String(tradeSetup.stopLoss));
    if (tradeSetup.takeProfit != null) setTakeProfit(String(tradeSetup.takeProfit));
    setPendingZoneId(tradeSetup.zoneId ?? null);
    setFromSetup(true);
    useTradeSetupStore.getState().clearSetup();
  }, [tradeSetup.isReady, tradeSetup.zoneId]);

  useEffect(() => {
    if (tradeSetup.isReady) return;
    if (!fromSetup && !pendingZoneId) return;
    if (tradeSetup.entryPrice != null) setLimitPrice(String(tradeSetup.entryPrice));
    if (tradeSetup.stopLoss   != null) setStopLoss(String(tradeSetup.stopLoss));
    if (tradeSetup.takeProfit != null) setTakeProfit(String(tradeSetup.takeProfit));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeSetup.entryPrice, tradeSetup.stopLoss, tradeSetup.takeProfit]);

  // ── Place order ──────────────────────────────────────────────────────
  const handleOrder = useCallback((side) => {
    if (!quoteSizeNum || quoteSizeNum <= 0) return;
    if (requiredMargin > freeMargin + 0.001) return;

    // ── Validate TP/SL before placing ──────────────────────────────────
    const refPrice = orderType === 'market' ? currentPrice : (entryPrice || currentPrice);
    const status = orderType === 'market' ? 'open' : 'pending';
    const result = validateTPSL(side, status, refPrice, tpNum, slNum);
    if (!result.valid) {
      if (result.field === 'tp') setTpWarning(result.message);
      else if (result.field === 'sl') setSlWarning(result.message);
      setTimeout(() => { setTpWarning(null); setSlWarning(null); }, 3500);
      return; 
    }
    setTpWarning(null); setSlWarning(null);

    const positionId = openPosition({
      side,
      symbol,   
      type:          orderType,
      entryPrice:    currentPrice,
      limitPrice:    orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : undefined,
      positionSize,
      quoteSize:     quoteSizeNum,
      leverage,
      requiredMargin,
      stopLoss:      slNum ?? undefined,
      takeProfit:    tpNum ?? undefined,
      sizeOverridden,
      entryTime:     currentTime ?? Math.floor(Date.now() / 1000),
    });

    if (pendingZoneId && positionId) {
      EventBus.emit(Events.TRADE_ZONE_LINKED, {
        zoneId: pendingZoneId, positionId, status: 'pending',
      });
    }

    setStopLoss(''); setTakeProfit('');
    setFromSetup(false); setPendingZoneId(null);
    if (orderType === 'limit') setLimitPrice('');
    setQuoteSize(''); setSlider(0);
    setSizeOverridden(false); 
  }, [orderType, quoteSizeNum, positionSize, limitPrice, leverage, requiredMargin, freeMargin,
      slNum, tpNum, currentTime, currentPrice, entryPrice, openPosition, pendingZoneId, sizeOverridden, symbol]);

  const cantPlace = !quoteSizeNum || requiredMargin > freeMargin + 0.001
    || (orderType === 'limit' && !limitPrice);

  return (
    <Panel>
      {/* ── Top: ticker + live price + leverage ── */}
      <TopBar>
        <TickerRow>
          <TickerName>{symbol}</TickerName>
          <LivePrice $up={priceUp}>
            {currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 5})}
          </LivePrice>
        </TickerRow>

        <LevRow>
          <BadgeBtn>Cross</BadgeBtn>
          <LevLabel>Leverage</LevLabel>
          <LevInput
            type="number" min={1} max={200} step={1} value={leverage}
            onChange={e => setLeverage(Math.max(1, parseInt(e.target.value) || 1))}
          />
          <LevLabel>×</LevLabel>
        </LevRow>
      </TopBar>

      {/* ── Tabs: Limit / Market ── */}
      <Tabs>
        <Tab $active={orderType==='limit'}  onClick={() => setOrderType('limit')}>Limit</Tab>
        <Tab $active={orderType==='market'} onClick={() => setOrderType('market')}>Market</Tab>
      </Tabs>

      <Form>
        {fromSetup && <Banner>📐 Pre-filled from chart setup</Banner>}

        {/* ── Price field ── */}
        {orderType === 'limit' ? (
          <FieldGroup>
            <FieldLabel>Limit Price</FieldLabel>
            <InputRow>
              <Inp type="number" step="0.00001"
                placeholder={currentPrice.toFixed(4)}
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
              />
              <InpSuffix>USDT</InpSuffix>
            </InputRow>
          </FieldGroup>
        ) : (
          <FieldGroup>
            <FieldLabel>Market Price</FieldLabel>
            <MarketPriceBox>
              <MarketPriceVal>
                {currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 5})}
              </MarketPriceVal>
              <InpSuffix>USDT</InpSuffix>
            </MarketPriceBox>
          </FieldGroup>
        )}

        {/* ── Amount ── */}
        <FieldGroup>
          <FieldLabel>Amount (USDT)</FieldLabel>
          <InputRow>
            <Inp type="number" step="1" min="0" placeholder="0.00"
              value={quoteSize}
              onChange={e => handleSizeChange(e.target.value)}
            />
            <InpSuffix>USDT</InpSuffix>
          </InputRow>
          {quoteSizeNum > 0 && entryPrice > 0 && (
            <div style={{fontSize:10, color:C.dim, textAlign:'right'}}>
              ≈ {positionSize.toFixed(6)} {symbol.replace('USDT','').replace('BUSD','')}
            </div>
          )}
        </FieldGroup>

        {/* ── Position size slider ── */}
        <SliderWrap>
          <Track>
            <Fill $pct={slider}/>
            <SliderEl min={0} max={100} step={1} value={slider}
              onChange={e => setFromSlider(parseInt(e.target.value))}
            />
          </Track>
          <Marks>
            {SIZE_MARKS.map(m => (
              <Mark key={m} onClick={() => setFromSlider(m)}>{m}%</Mark>
            ))}
          </Marks>
        </SliderWrap>

        {/* ── Required margin summary ── */}
        <CostRow>
          <span>Margin required</span>
          <span style={{
            color: requiredMargin > freeMargin ? C.red : C.text,
            fontWeight: 600,
          }}>
            {requiredMargin.toFixed(2)} USDT
            {requiredMargin > freeMargin && ' ⚠'}
          </span>
        </CostRow>

        {/* ── TP / SL — always visible ── */}
        <TPSLGrid>
          <FieldGroup>
            <FieldLabel>Take Profit</FieldLabel>
            <FieldWrap>
              {tpWarning && <WarningBubble>⚠ {tpWarning}</WarningBubble>}
              <InputRow>
                <Inp type="number" step="0.00001" placeholder="Price"
                  value={takeProfit} onChange={e => { setTakeProfit(e.target.value); setTpWarning(null); }}/>
              </InputRow>
            </FieldWrap>
          </FieldGroup>
          <FieldGroup>
            <FieldLabel>Stop Loss</FieldLabel>
            <FieldWrap>
              {slWarning && <WarningBubble>⚠ {slWarning}</WarningBubble>}
              <InputRow>
                <Inp type="number" step="0.00001" placeholder="Price"
                  value={stopLoss} onChange={e => { setStopLoss(e.target.value); setSlWarning(null); }}/>
              </InputRow>
            </FieldWrap>
          </FieldGroup>
        </TPSLGrid>

        {/* ── R:R badge ── */}
        {riskAmt != null && riskAmt > 0 && (
          <RRBadge $risk={riskLevel}>
            <span>Risk {riskAmt.toFixed(2)} USDT ({riskPct?.toFixed(1)}%)</span>
            {rrRatio != null && (
              <span style={{fontWeight:700}}>R:R {rrRatio.toFixed(2)}</span>
            )}
          </RRBadge>
        )}

        {/* ── Buy / Sell ── */}
        <ActionRow>
          <ActionBtn $side="long"  onClick={() => handleOrder('long')}  disabled={cantPlace}>
            Buy / Long
          </ActionBtn>
          <ActionBtn $side="short" onClick={() => handleOrder('short')} disabled={cantPlace}>
            Sell / Short
          </ActionBtn>
        </ActionRow>
      </Form>

      {/* ── Balance footer (always at bottom) ── */}
      <BalanceFooter>
        {reservedMargin > 0 && (
          <>
            <MarginBarWrap>
              <MarginFill $pct={marginUsedPct}/>
            </MarginBarWrap>
            <BalRow>
              <BalLabel>Margin used</BalLabel>
              <BalVal>{reservedMargin.toFixed(2)} USDT ({marginUsedPct.toFixed(0)}%)</BalVal>
            </BalRow>
          </>
        )}
        <BalRow>
          <BalLabel>Free margin</BalLabel>
          <BalVal $color={freeMargin < balance * 0.2 ? C.red : C.green}>
            {freeMargin.toFixed(2)} USDT
          </BalVal>
        </BalRow>
        <BalRow>
          <BalLabel>Equity</BalLabel>
          <BalVal $color={equity >= balance ? C.green : C.red}>
            {equity.toFixed(2)} USDT
          </BalVal>
        </BalRow>
        <BalRow>
          <BalLabel>Balance</BalLabel>
          <BalVal>{balance.toFixed(2)} USDT</BalVal>
        </BalRow>
      </BalanceFooter>
    </Panel>
  );
};

export default TradingPanel;