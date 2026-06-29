// components/TradingPanel/TradingPanel.jsx
import React, { useState, useCallback, useEffect } from 'react';
import styled from 'styled-components';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore } from '../../stores/marketStore';
import { useTradeSetupStore } from '../../stores/tradeSetupStore';
import { EventBus, Events } from '../../core/EventBus';

/* ─── Design tokens ─── */
const C = {
  bg: '#131722', surface: '#1e222d', surfaceElevated: '#2a2e39',
  border: '#2a2e39', borderFocus: '#3a5fcd',
  text: '#d1d4dc', textMuted: '#787b86', textDim: '#555b6e',
  green: '#0ecb81', greenMuted: 'rgba(14,203,129,0.15)',
  red: '#f23645', redMuted: 'rgba(242,54,69,0.15)',
  blue: '#2962ff', orange: '#f0a500', orangeMuted: 'rgba(240,165,0,0.12)',
};

/* ─── Styled components ─── */
const Panel = styled.div`display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:13px;color:${C.text};background:${C.bg};height:100%;`;
const TopControls = styled.div`display:flex;gap:8px;padding:12px 16px 0;align-items:center;`;
const BadgeBtn = styled.div`background:${C.surfaceElevated};border-radius:4px;padding:5px 10px;font-size:12px;font-weight:500;color:${C.text};cursor:default;`;
const LeverageInput = styled.input`background:${C.surfaceElevated};border:1px solid ${C.border};border-radius:4px;padding:4px 8px;font-size:12px;font-weight:600;color:${C.text};width:60px;outline:none;text-align:center;&:focus{border-color:${C.blue};}&::-webkit-outer-spin-button,&::-webkit-inner-spin-button{-webkit-appearance:none;}-moz-appearance:textfield;`;
const LevLabel = styled.span`font-size:11px;color:${C.textMuted};`;
const TabsRow = styled.div`display:flex;gap:16px;padding:0 16px;margin-top:10px;border-bottom:1px solid ${C.border};`;
const Tab = styled.div`padding:8px 0;font-size:14px;font-weight:${p=>p.$active?'600':'500'};color:${p=>p.$active?C.text:C.textMuted};border-bottom:3px solid ${p=>p.$active?C.orange:'transparent'};cursor:pointer;transition:all .2s;&:hover{color:${C.text};}`;
const FormContainer = styled.div`padding:16px;display:flex;flex-direction:column;gap:12px;flex:1;overflow-y:auto;`;
const InfoRow = styled.div`display:flex;justify-content:space-between;align-items:center;font-size:12px;`;
const InfoLabel = styled.span`color:${C.textMuted};`;
const InfoValue = styled.span`color:${p=>p.$color||C.text};font-weight:${p=>p.$bold?'600':'500'};font-variant-numeric:tabular-nums;`;
const FieldGroup = styled.div`display:flex;flex-direction:column;gap:5px;`;
const FieldLabel = styled.label`font-size:12px;color:${C.textMuted};`;
const InputWrapper = styled.div`display:flex;align-items:center;background:${C.surfaceElevated};border-radius:6px;padding:0 12px;height:40px;border:1px solid transparent;transition:border-color .2s;&:focus-within{border-color:${C.textMuted};}`;
const StyledInput = styled.input`flex:1;background:transparent;border:none;color:${C.text};font-size:14px;font-variant-numeric:tabular-nums;outline:none;width:100%;&::placeholder{color:${C.textDim};}-moz-appearance:textfield;&::-webkit-outer-spin-button,&::-webkit-inner-spin-button{-webkit-appearance:none;}`;
const Suffix = styled.span`color:${C.text};font-size:13px;font-weight:500;margin-left:8px;`;
const SuffixButton = styled.div`color:${C.textMuted};font-size:12px;margin-left:12px;padding-left:12px;border-left:1px solid ${C.border};display:flex;align-items:center;gap:4px;cursor:pointer;`;

/* ─── Position size slider ─── */
const SliderWrap = styled.div`margin-top:2px;`;
const SliderTrack = styled.div`position:relative;height:4px;background:${C.surfaceElevated};border-radius:2px;margin:0 0 4px;`;
const SliderFill = styled.div`position:absolute;left:0;top:0;height:100%;background:${C.blue};border-radius:2px;transition:width .1s;`;
const SliderInput = styled.input.attrs({type:'range'})`position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;margin:0;`;
const SliderMarkers = styled.div`display:flex;justify-content:space-between;font-size:10px;color:${C.textDim};`;
const MarkerBtn = styled.span`cursor:pointer;padding:1px 3px;border-radius:2px;&:hover{color:${C.text};}`;

const CostSummary = styled.div`display:flex;justify-content:space-between;font-size:12px;color:${C.text};padding:6px 0;border-bottom:1px solid ${C.border};`;
const CheckboxRow = styled.label`display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:${C.text};input[type="checkbox"]{accent-color:${C.orange};width:14px;height:14px;cursor:pointer;}`;
const ActionRow = styled.div`display:flex;gap:12px;margin-top:auto;padding-top:12px;`;
const ActionBtn = styled.button`flex:1;height:44px;border:none;border-radius:6px;font-weight:600;font-size:14px;color:#fff;cursor:pointer;background:${p=>p.$side==='long'?C.green:C.red};transition:opacity .15s,transform .1s;&:hover{opacity:.9;}&:active{transform:scale(.98);}&:disabled{opacity:.5;cursor:not-allowed;}`;
const SetupBanner = styled.div`display:flex;align-items:center;padding:7px 10px;background:rgba(41,98,255,.1);border-left:3px solid ${C.blue};border-radius:0 4px 4px 0;font-size:11px;color:${C.blue};`;
const RiskBadge = styled.div`background:${p=>p.$risk==='high'?C.redMuted:p.$risk==='med'?C.orangeMuted:C.greenMuted};color:${p=>p.$risk==='high'?C.red:p.$risk==='med'?C.orange:C.green};border-radius:4px;padding:7px 10px;font-size:12px;display:flex;justify-content:space-between;align-items:center;`;
const MarginBar = styled.div`height:3px;border-radius:2px;background:${C.surfaceElevated};overflow:hidden;`;
const MarginFill = styled.div`height:100%;border-radius:2px;background:${p=>p.$pct>80?C.red:p.$pct>50?C.orange:C.blue};transition:width .3s;`;

/* ─── Size slider markers (% of available margin) ─── */
const SIZE_MARKS = [0, 25, 50, 75, 100];

const TradingPanel = ({ currentTime }) => {
  const [orderType, setOrderType] = useState('limit');
  const [quoteSize, setQuoteSize]   = useState('');   // position value in USDT (quote currency)
  const [limitPrice, setLimitPrice] = useState('');
  const [leverage, setLeverage]     = useState(20);
  const [sizeSlider, setSizeSlider]  = useState(0);   // 0-100 %
  const [showTPSL, setShowTPSL]     = useState(false);
  const [stopLoss, setStopLoss]     = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [fromSetup, setFromSetup]   = useState(false);
  const [pendingZoneId, setPendingZoneId] = useState(null);

  const { openPosition, balance, equity, reservedMargin = 0 } = useTradingStore();
  const currentPrice = useMarketStore(s => s.currentPrice);
  const tradeSetup   = useTradeSetupStore(s => s);

  // Free margin = balance - margin locked in open positions and pending orders
  const freeMargin = Math.max(0, balance - reservedMargin);

  // Derived: entry price (limit or market)
  const entryPrice  = orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : currentPrice;

  // quoteSize is position value in USDT. positionSize = quoteSize / entryPrice (base units)
  const quoteSizeNum  = parseFloat(quoteSize) || 0;
  const positionSize  = entryPrice > 0 ? quoteSizeNum / entryPrice : 0;

  // Margin required = position value / leverage
  const requiredMargin = leverage > 0 ? quoteSizeNum / leverage : 0;

  // Slider → quoteSize
  const maxPositionValue = freeMargin * leverage;
  const setFromSlider = (pct) => {
    setSizeSlider(pct);
    const val = (pct / 100) * maxPositionValue;
    setQuoteSize(val > 0 ? val.toFixed(2) : '');
  };

  // quoteSize manual input → sync slider
  const handleQuoteSizeChange = (val) => {
    setQuoteSize(val);
    const num = parseFloat(val) || 0;
    const pct  = maxPositionValue > 0 ? Math.min(100, (num / maxPositionValue) * 100) : 0;
    setSizeSlider(Math.round(pct));
  };

  // Risk/Reward
  const slNum  = showTPSL && stopLoss   ? parseFloat(stopLoss)   : null;
  const tpNum  = showTPSL && takeProfit ? parseFloat(takeProfit) : null;
  const riskAmount    = slNum ? Math.abs(entryPrice - slNum) * positionSize * leverage : null;
  const rewardAmount  = tpNum ? Math.abs(tpNum - entryPrice) * positionSize * leverage : null;
  const riskPercent   = riskAmount ? (riskAmount / freeMargin) * 100 : null;
  const rrRatio       = riskAmount && rewardAmount ? rewardAmount / riskAmount : null;
  const riskLevel     = riskPercent === null ? null : riskPercent > 5 ? 'high' : riskPercent > 2 ? 'med' : 'low';

  const marginUsedPct = balance > 0 ? Math.min(100, (reservedMargin / balance) * 100) : 0;

  // ── Trade Setup Tool integration ──────────────────────────────────────
  useEffect(() => {
    if (!tradeSetup.isReady) return;
    setOrderType('limit');
    if (tradeSetup.entryPrice != null) setLimitPrice(String(tradeSetup.entryPrice));
    let hasAdv = false;
    if (tradeSetup.stopLoss != null)   { hasAdv = true; setStopLoss(String(tradeSetup.stopLoss)); }
    if (tradeSetup.takeProfit != null) { hasAdv = true; setTakeProfit(String(tradeSetup.takeProfit)); }
    if (hasAdv) setShowTPSL(true);
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
  const handlePlaceOrder = useCallback((sideToPlace) => {
    if (!quoteSizeNum || quoteSizeNum <= 0) return;
    if (requiredMargin > freeMargin) return; // insufficient margin

    const positionId = openPosition({
      side:         sideToPlace,
      type:         orderType,
      entryPrice:   currentPrice,
      limitPrice:   orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : undefined,
      positionSize,
      quoteSize:    quoteSizeNum,
      leverage,
      requiredMargin,
      stopLoss:     showTPSL && stopLoss   ? parseFloat(stopLoss)   : undefined,
      takeProfit:   showTPSL && takeProfit ? parseFloat(takeProfit) : undefined,
      entryTime:    currentTime ?? Math.floor(Date.now() / 1000),
    });

    // Link the zone to the order IMMEDIATELY — before any async event processing.
    // For immediate fills (limit above/below market), ORDER_FILLED fires inside openPosition
    // synchronously, so the zone must have its positionId set beforehand.
    // We always emit 'pending' first; App.jsx ORDER_FILLED listener will upgrade to 'open'.
    if (pendingZoneId && positionId) {
      EventBus.emit(Events.TRADE_ZONE_LINKED, {
        zoneId:     pendingZoneId,
        positionId,
        status:     'pending',
      });
    }

    setStopLoss(''); setTakeProfit(''); setShowTPSL(false);
    setFromSetup(false); setPendingZoneId(null);
    if (orderType === 'limit') setLimitPrice('');
    setQuoteSize(''); setSizeSlider(0);
  }, [orderType, quoteSizeNum, positionSize, limitPrice, leverage, requiredMargin, freeMargin,
      showTPSL, stopLoss, takeProfit, currentTime, currentPrice, openPosition, pendingZoneId]);

  return (
    <Panel>
      {/* Top: leverage input + margin type badge */}
      <TopControls>
        <BadgeBtn>Cross</BadgeBtn>
        <LevLabel>Leverage</LevLabel>
        <LeverageInput
          type="number" min={1} max={200} step={1} value={leverage}
          onChange={e => setLeverage(Math.max(1, parseInt(e.target.value) || 1))}
        />
        <LevLabel>×</LevLabel>
      </TopControls>

      {/* Tabs */}
      <TabsRow>
        <Tab $active={orderType==='limit'}  onClick={()=>setOrderType('limit')}>Limit</Tab>
        <Tab $active={orderType==='market'} onClick={()=>setOrderType('market')}>Market</Tab>
        <Tab>Trigger ▾</Tab>
      </TabsRow>

      <FormContainer>
        {fromSetup && <SetupBanner>📐 Pre-filled from chart setup — review & place</SetupBanner>}

        {/* Balance / Free margin */}
        <InfoRow>
          <InfoLabel>Balance</InfoLabel>
          <InfoValue>{balance.toFixed(2)} USDT</InfoValue>
        </InfoRow>
        <InfoRow style={{marginTop:'-6px'}}>
          <InfoLabel>Free margin</InfoLabel>
          <InfoValue $color={freeMargin < balance * 0.2 ? C.red : C.green}>
            {freeMargin.toFixed(2)} USDT
          </InfoValue>
        </InfoRow>
        {reservedMargin > 0 && (
          <div>
            <MarginBar>
              <MarginFill $pct={marginUsedPct} style={{width:`${marginUsedPct}%`}}/>
            </MarginBar>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.textDim,marginTop:2}}>
              <span>Used {reservedMargin.toFixed(2)} USDT</span>
              <span>{marginUsedPct.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {/* Price */}
        {orderType === 'limit' && (
          <FieldGroup>
            <FieldLabel>Limit Price</FieldLabel>
            <InputWrapper>
              <StyledInput type="number" step="0.01"
                placeholder={currentPrice.toFixed(2)}
                value={limitPrice}
                onChange={e=>setLimitPrice(e.target.value)}
              />
              <Suffix>USDT</Suffix>
              <SuffixButton>BBO</SuffixButton>
            </InputWrapper>
          </FieldGroup>
        )}

        {/* Amount in quote currency (USDT) */}
        <FieldGroup>
          <FieldLabel>Amount (USDT)</FieldLabel>
          <InputWrapper>
            <StyledInput type="number" step="1" min="0" placeholder="0.00"
              value={quoteSize}
              onChange={e=>handleQuoteSizeChange(e.target.value)}
            />
            <Suffix>USDT</Suffix>
          </InputWrapper>
          {entryPrice > 0 && quoteSizeNum > 0 && (
            <div style={{fontSize:10,color:C.textDim,textAlign:'right'}}>
              ≈ {positionSize.toFixed(6)} {' base units'}
            </div>
          )}
        </FieldGroup>

        {/* Position size slider (% of available margin × leverage) */}
        <SliderWrap>
          <SliderTrack>
            <SliderFill style={{width:`${sizeSlider}%`}}/>
            <SliderInput
              min={0} max={100} step={1} value={sizeSlider}
              onChange={e=>setFromSlider(parseInt(e.target.value))}
            />
          </SliderTrack>
          <SliderMarkers>
            {SIZE_MARKS.map(m=>(
              <MarkerBtn key={m} onClick={()=>setFromSlider(m)}>
                {m}%
              </MarkerBtn>
            ))}
          </SliderMarkers>
        </SliderWrap>

        {/* Margin summary */}
        <CostSummary>
          <span>Required margin: <strong>{requiredMargin.toFixed(2)} USDT</strong></span>
          <span style={{color: requiredMargin > freeMargin ? C.red : C.textMuted, fontSize:11}}>
            {requiredMargin > freeMargin ? '⚠ Insufficient' : `${((requiredMargin/Math.max(freeMargin,1))*100).toFixed(0)}% of free`}
          </span>
        </CostSummary>

        {/* TP/SL */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <CheckboxRow>
            <input type="checkbox" checked={showTPSL} onChange={e=>setShowTPSL(e.target.checked)}/>
            TP / SL
          </CheckboxRow>
          <span style={{fontSize:12,color:C.orange,cursor:'pointer'}}>GTC ▾</span>
        </div>

        {showTPSL && (
          <>
            <FieldGroup>
              <FieldLabel>Take Profit</FieldLabel>
              <InputWrapper>
                <StyledInput type="number" step="0.00001" placeholder="Price"
                  value={takeProfit} onChange={e=>setTakeProfit(e.target.value)}/>
                <SuffixButton style={{border:'none'}}>Last ▾</SuffixButton>
              </InputWrapper>
            </FieldGroup>
            <FieldGroup>
              <FieldLabel>Stop Loss</FieldLabel>
              <InputWrapper>
                <StyledInput type="number" step="0.00001" placeholder="Price"
                  value={stopLoss} onChange={e=>setStopLoss(e.target.value)}/>
                <SuffixButton style={{border:'none'}}>Last ▾</SuffixButton>
              </InputWrapper>
            </FieldGroup>
          </>
        )}

        {riskPercent !== null && showTPSL && (
          <RiskBadge $risk={riskLevel}>
            <span>Risk {riskAmount?.toFixed(2)} USDT ({riskPercent?.toFixed(1)}%)</span>
            {rrRatio !== null && <span style={{fontWeight:600}}>R:R {rrRatio.toFixed(2)}</span>}
          </RiskBadge>
        )}

        <ActionRow>
          <ActionBtn $side="long"
            onClick={()=>handlePlaceOrder('long')}
            disabled={(orderType==='limit'&&!limitPrice)||!quoteSizeNum||requiredMargin>freeMargin}
          >Buy / Long</ActionBtn>
          <ActionBtn $side="short"
            onClick={()=>handlePlaceOrder('short')}
            disabled={(orderType==='limit'&&!limitPrice)||!quoteSizeNum||requiredMargin>freeMargin}
          >Sell / Short</ActionBtn>
        </ActionRow>
      </FormContainer>
    </Panel>
  );
};

export default TradingPanel;
