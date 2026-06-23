// components/TradingPanel/TradingPanel.jsx
import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore } from '../../stores/marketStore';

/* ─── Design tokens ─────────────────────────────── */
const C = {
  bg: '#131722',
  surface: '#1e222d',
  surfaceElevated: '#252b3b',
  border: '#2a2e39',
  borderFocus: '#3a5fcd',
  text: '#d1d4dc',
  textMuted: '#787b86',
  textDim: '#555b6e',
  green: '#089981',
  greenMuted: 'rgba(8,153,129,0.15)',
  red: '#f23645',
  redMuted: 'rgba(242,54,69,0.15)',
  blue: '#2962ff',
  blueMuted: 'rgba(41,98,255,0.12)',
  orange: '#f0a500',
  orangeMuted: 'rgba(240,165,0,0.12)',
};

/* ─── Styled components ─────────────────────────── */
const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 13px;
  color: ${C.text};
  height: 100%;
`;

const Section = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${C.border};
`;

const AccountRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const AccountStat = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const StatLabel = styled.span`
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${C.textMuted};
`;

const StatValue = styled.span`
  font-size: 15px;
  font-weight: 600;
  color: ${(p) => p.$color || C.text};
  font-variant-numeric: tabular-nums;
`;

const PriceDisplay = styled.div`
  text-align: center;
  font-size: 22px;
  font-weight: 700;
  color: ${C.text};
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  padding: 4px 0;
`;

const BuySellRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
`;

const DirectionBtn = styled.button`
  padding: 10px 0;
  border: 2px solid ${(p) => (p.$active ? p.$color : C.border)};
  border-radius: 6px;
  background: ${(p) => (p.$active ? p.$colorMuted : 'transparent')};
  color: ${(p) => (p.$active ? p.$color : C.textMuted)};
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    border-color: ${(p) => p.$color};
    color: ${(p) => p.$color};
    background: ${(p) => p.$colorMuted};
  }
`;

const TypeRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
`;

const TypeBtn = styled.button`
  padding: 7px 0;
  border: 1px solid ${(p) => (p.$active ? C.blue : C.border)};
  border-radius: 5px;
  background: ${(p) => (p.$active ? C.blueMuted : 'transparent')};
  color: ${(p) => (p.$active ? C.blue : C.textMuted)};
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? '600' : '400')};
  cursor: pointer;
  transition: all 0.12s;
  &:hover {
    border-color: ${C.blue};
    color: ${C.blue};
  }
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const FieldLabel = styled.label`
  font-size: 11px;
  font-weight: 500;
  color: ${C.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const InputRow = styled.div`
  display: flex;
  align-items: center;
  background: ${C.surfaceElevated};
  border: 1px solid ${C.border};
  border-radius: 5px;
  overflow: hidden;
  transition: border-color 0.12s;
  &:focus-within {
    border-color: ${C.borderFocus};
  }
`;

const StyledInput = styled.input`
  flex: 1;
  padding: 8px 10px;
  background: transparent;
  border: none;
  color: ${C.text};
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  outline: none;
  min-width: 0;
  &::placeholder {
    color: ${C.textDim};
  }
  /* hide number spinners */
  -moz-appearance: textfield;
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
  }
`;

const InputUnit = styled.span`
  padding: 0 10px;
  color: ${C.textMuted};
  font-size: 11px;
  border-left: 1px solid ${C.border};
  background: ${C.surface};
  align-self: stretch;
  display: flex;
  align-items: center;
  white-space: nowrap;
`;

const StepButtons = styled.div`
  display: flex;
  flex-direction: column;
  border-left: 1px solid ${C.border};
`;

const StepBtn = styled.button`
  flex: 1;
  width: 22px;
  background: transparent;
  border: none;
  color: ${C.textMuted};
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover { color: ${C.text}; background: ${C.border}; }
  &:first-child { border-bottom: 1px solid ${C.border}; }
`;

const TwoCol = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`;

const LeverageTrack = styled.div`
  margin-top: 4px;
  input[type='range'] {
    width: 100%;
    height: 3px;
    accent-color: ${C.blue};
    cursor: pointer;
  }
`;

const LeverageMarkers = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: ${C.textDim};
  margin-top: 2px;
`;

const OptionalToggle = styled.button`
  background: none;
  border: none;
  color: ${(p) => (p.$active ? C.blue : C.textMuted)};
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  &:hover { color: ${C.text}; }
`;

const RiskBadge = styled.div`
  background: ${(p) => (p.$risk === 'high' ? C.redMuted : p.$risk === 'med' ? C.orangeMuted : C.greenMuted)};
  color: ${(p) => (p.$risk === 'high' ? C.red : p.$risk === 'med' ? C.orange : C.green)};
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 11px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
`;

const PlaceBtn = styled.button`
  width: 100%;
  padding: 13px;
  border: none;
  border-radius: 6px;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.03em;
  cursor: pointer;
  color: #fff;
  background: ${(p) => (p.$side === 'long' ? C.green : C.red)};
  transition: opacity 0.12s, transform 0.08s;
  &:hover { opacity: 0.88; }
  &:active { transform: scale(0.98); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const SectionTitle = styled.div`
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${C.textDim};
  margin-bottom: 10px;
`;

/* ─── Component ─────────────────────────────────── */
const TradingPanel = ({ currentTime }) => {
  const [side, setSide] = useState('long');
  const [orderType, setOrderType] = useState('market');
  const [size, setSize] = useState('0.01');
  const [limitPrice, setLimitPrice] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [showSL, setShowSL] = useState(false);
  const [showTP, setShowTP] = useState(false);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');

  const { openPosition, balance, equity } = useTradingStore();
  const currentPrice = useMarketStore((s) => s.currentPrice);

  const entryPrice = orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : currentPrice;

  // Risk calculations
  const sizeNum = parseFloat(size) || 0;
  const slNum = showSL && stopLoss ? parseFloat(stopLoss) : null;
  const tpNum = showTP && takeProfit ? parseFloat(takeProfit) : null;

  const riskAmount = slNum
    ? Math.abs(entryPrice - slNum) * sizeNum * leverage
    : null;
  const rewardAmount = tpNum
    ? Math.abs(tpNum - entryPrice) * sizeNum * leverage
    : null;
  const riskPercent = riskAmount ? (riskAmount / balance) * 100 : null;
  const rrRatio = riskAmount && rewardAmount ? rewardAmount / riskAmount : null;

  const riskLevel =
    riskPercent === null ? null :
    riskPercent > 5 ? 'high' :
    riskPercent > 2 ? 'med' : 'low';

  const handlePlaceOrder = useCallback(() => {
    const parsedSize = parseFloat(size);
    if (!parsedSize || parsedSize <= 0) return;

    openPosition({
      side,
      type: orderType,
      entryPrice: currentPrice,
      limitPrice: orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : undefined,
      positionSize: parsedSize,
      leverage,
      stopLoss: showSL && stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: showTP && takeProfit ? parseFloat(takeProfit) : undefined,
      entryTime: currentTime ?? Math.floor(Date.now() / 1000),
    });

    // Reset optional fields
    setStopLoss('');
    setTakeProfit('');
    setShowSL(false);
    setShowTP(false);
    if (orderType === 'limit') setLimitPrice('');
  }, [side, orderType, size, limitPrice, leverage, showSL, stopLoss, showTP, takeProfit, currentTime, currentPrice, openPosition]);

  const pnlColor = equity >= balance ? C.green : C.red;

  return (
    <Panel>
      {/* Account summary */}
      <Section>
        <AccountRow>
          <AccountStat>
            <StatLabel>Balance</StatLabel>
            <StatValue>${balance.toFixed(2)}</StatValue>
          </AccountStat>
          <AccountStat style={{ textAlign: 'right' }}>
            <StatLabel>Equity</StatLabel>
            <StatValue $color={pnlColor}>${equity.toFixed(2)}</StatValue>
          </AccountStat>
        </AccountRow>
      </Section>

      {/* Current price */}
      <Section>
        <PriceDisplay>{currentPrice.toFixed(currentPrice < 10 ? 5 : 2)}</PriceDisplay>
      </Section>

      {/* Direction + Order type */}
      <Section>
        <SectionTitle>Order</SectionTitle>
        <BuySellRow style={{ marginBottom: 8 }}>
          <DirectionBtn
            $active={side === 'long'}
            $color={C.green}
            $colorMuted={C.greenMuted}
            onClick={() => setSide('long')}
          >
            ▲ BUY / LONG
          </DirectionBtn>
          <DirectionBtn
            $active={side === 'short'}
            $color={C.red}
            $colorMuted={C.redMuted}
            onClick={() => setSide('short')}
          >
            ▼ SELL / SHORT
          </DirectionBtn>
        </BuySellRow>
        <TypeRow>
          <TypeBtn $active={orderType === 'market'} onClick={() => setOrderType('market')}>
            Market
          </TypeBtn>
          <TypeBtn $active={orderType === 'limit'} onClick={() => setOrderType('limit')}>
            Limit
          </TypeBtn>
        </TypeRow>
      </Section>

      {/* Fields */}
      <Section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Limit price (only for limit orders) */}
        {orderType === 'limit' && (
          <FieldGroup>
            <FieldLabel>Limit Price</FieldLabel>
            <InputRow>
              <StyledInput
                type="number"
                step="0.00001"
                placeholder={currentPrice.toFixed(5)}
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
              />
              <InputUnit>price</InputUnit>
            </InputRow>
          </FieldGroup>
        )}

        {/* Size */}
        <FieldGroup>
          <FieldLabel>Position Size</FieldLabel>
          <InputRow>
            <StyledInput
              type="number"
              step="0.01"
              min="0.01"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            />
            <StepButtons>
              <StepBtn onClick={() => setSize((s) => (Math.max(0.01, parseFloat(s) + 0.01)).toFixed(2))}>▲</StepBtn>
              <StepBtn onClick={() => setSize((s) => (Math.max(0.01, parseFloat(s) - 0.01)).toFixed(2))}>▼</StepBtn>
            </StepButtons>
            <InputUnit>lots</InputUnit>
          </InputRow>
        </FieldGroup>

        {/* Leverage */}
        <FieldGroup>
          <FieldLabel style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Leverage</span>
            <span style={{ color: C.blue, fontWeight: 700 }}>{leverage}×</span>
          </FieldLabel>
          <LeverageTrack>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
            />
            <LeverageMarkers>
              <span>1×</span><span>25×</span><span>50×</span><span>75×</span><span>100×</span>
            </LeverageMarkers>
          </LeverageTrack>
        </FieldGroup>

        {/* SL / TP toggles */}
        <TwoCol>
          <FieldGroup>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <FieldLabel>Stop Loss</FieldLabel>
              <OptionalToggle $active={showSL} onClick={() => setShowSL((v) => !v)}>
                {showSL ? '✕' : '+'}
              </OptionalToggle>
            </div>
            {showSL && (
              <InputRow>
                <StyledInput
                  type="number"
                  step="0.00001"
                  placeholder={
                    side === 'long'
                      ? (currentPrice * 0.99).toFixed(5)
                      : (currentPrice * 1.01).toFixed(5)
                  }
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                />
              </InputRow>
            )}
          </FieldGroup>
          <FieldGroup>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <FieldLabel>Take Profit</FieldLabel>
              <OptionalToggle $active={showTP} onClick={() => setShowTP((v) => !v)}>
                {showTP ? '✕' : '+'}
              </OptionalToggle>
            </div>
            {showTP && (
              <InputRow>
                <StyledInput
                  type="number"
                  step="0.00001"
                  placeholder={
                    side === 'long'
                      ? (currentPrice * 1.02).toFixed(5)
                      : (currentPrice * 0.98).toFixed(5)
                  }
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                />
              </InputRow>
            )}
          </FieldGroup>
        </TwoCol>

        {/* Risk/reward summary */}
        {riskPercent !== null && (
          <RiskBadge $risk={riskLevel}>
            <span>Risk {riskAmount?.toFixed(2)} ({riskPercent?.toFixed(1)}%)</span>
            {rrRatio !== null && (
              <span style={{ fontWeight: 600 }}>R:R {rrRatio.toFixed(2)}</span>
            )}
          </RiskBadge>
        )}
      </Section>

      {/* Place order button */}
      <Section>
        <PlaceBtn
          $side={side}
          onClick={handlePlaceOrder}
          disabled={orderType === 'limit' && !limitPrice}
        >
          {side === 'long' ? 'BUY' : 'SELL'}{' '}
          {orderType === 'market' ? 'MARKET' : 'LIMIT'}{' '}
          {sizeNum > 0 ? `· ${sizeNum} lots` : ''}
        </PlaceBtn>
      </Section>
    </Panel>
  );
};

export default TradingPanel;
