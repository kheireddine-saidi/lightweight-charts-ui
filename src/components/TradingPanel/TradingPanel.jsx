// components/TradingPanel/TradingPanel.jsx
import React, { useState, useCallback, useEffect } from 'react';
import styled from 'styled-components';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore } from '../../stores/marketStore';
import { useTradeSetupStore } from '../../stores/tradeSetupStore';

/* ─── Design tokens ─────────────────────────────── */
const C = {
  bg: '#131722',
  surface: '#1e222d',
  surfaceElevated: '#2a2e39', // Adjusted to match the dark inputs in the screenshot
  border: '#2a2e39',
  borderFocus: '#3a5fcd',
  text: '#d1d4dc',
  textMuted: '#787b86',
  textDim: '#555b6e',
  green: '#0ecb81', // Updated to match screenshot's bright green
  greenMuted: 'rgba(14, 203, 129, 0.15)',
  red: '#f23645', // Updated to match screenshot's bright red
  redMuted: 'rgba(242, 54, 69, 0.15)',
  blue: '#2962ff',
  orange: '#f0a500', // Used for active tab indicator
  orangeMuted: 'rgba(240, 165, 0, 0.12)',
};

/* ─── Styled components ─────────────────────────── */
const Panel = styled.div`
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 13px;
  color: ${C.text};
  background: ${C.bg};
  height: 100%;
`;

const TopControls = styled.div`
  display: flex;
  gap: 12px;
  padding: 16px 16px 0;
`;

const BadgeBtn = styled.div`
  background: ${C.surfaceElevated};
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: ${C.text};
  cursor: default;
`;

const TabsRow = styled.div`
  display: flex;
  gap: 16px;
  padding: 0 16px;
  margin-top: 16px;
  border-bottom: 1px solid ${C.border};
`;

const Tab = styled.div`
  padding: 8px 0;
  font-size: 14px;
  font-weight: ${(p) => (p.$active ? '600' : '500')};
  color: ${(p) => (p.$active ? C.text : C.textMuted)};
  border-bottom: 3px solid ${(p) => (p.$active ? C.orange : 'transparent')};
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    color: ${C.text};
  }
`;

const FormContainer = styled.div`
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  overflow-y: auto;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
`;

const InfoLabel = styled.span`
  color: ${C.textMuted};
`;

const InfoValue = styled.span`
  color: ${(p) => p.$color || C.text};
  font-weight: ${(p) => (p.$bold ? '600' : '500')};
  font-variant-numeric: tabular-nums;
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FieldLabel = styled.label`
  font-size: 12px;
  color: ${C.textMuted};
`;

const InputWrapper = styled.div`
  display: flex;
  align-items: center;
  background: ${C.surfaceElevated};
  border-radius: 6px;
  padding: 0 12px;
  height: 40px;
  border: 1px solid transparent;
  transition: border-color 0.2s;
  &:focus-within {
    border-color: ${C.textMuted};
  }
`;

const StyledInput = styled.input`
  flex: 1;
  background: transparent;
  border: none;
  color: ${C.text};
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  outline: none;
  width: 100%;
  &::placeholder {
    color: ${C.textDim};
  }
  -moz-appearance: textfield;
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
  }
`;

const Suffix = styled.span`
  color: ${C.text};
  font-size: 13px;
  font-weight: 500;
  margin-left: 8px;
`;

const SuffixButton = styled.div`
  color: ${C.textMuted};
  font-size: 12px;
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid ${C.border};
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
`;

const SliderContainer = styled.div`
  padding: 8px 0;
  input[type='range'] {
    width: 100%;
    height: 4px;
    background: ${C.surfaceElevated};
    border-radius: 2px;
    appearance: none;
    outline: none;
    &::-webkit-slider-thumb {
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: ${C.textMuted};
      cursor: pointer;
    }
  }
`;

const SliderMarkers = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 10px;
  color: ${C.textDim};
`;

const CostSummary = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: ${C.text};
  padding: 8px 0;
  border-bottom: 1px solid ${C.border};
`;

const CheckboxRow = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: ${C.text};
  margin-top: 4px;
  input[type="checkbox"] {
    accent-color: ${C.orange};
    width: 14px;
    height: 14px;
    cursor: pointer;
  }
`;

const ActionRow = styled.div`
  display: flex;
  gap: 12px;
  margin-top: auto;
  padding-top: 16px;
`;

const ActionBtn = styled.button`
  flex: 1;
  height: 44px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 14px;
  color: #fff;
  cursor: pointer;
  background: ${(p) => (p.$side === 'long' ? C.green : C.red)};
  transition: opacity 0.15s, transform 0.1s;
  &:hover {
    opacity: 0.9;
  }
  &:active {
    transform: scale(0.98);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SetupBanner = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: rgba(41, 98, 255, 0.1);
  border-left: 3px solid ${C.blue};
  border-radius: 0 4px 4px 0;
  font-size: 11px;
  color: ${C.blue};
  margin-bottom: 8px;
`;

const RiskBadge = styled.div`
  background: ${(p) =>
    p.$risk === 'high' ? C.redMuted : p.$risk === 'med' ? C.orangeMuted : C.greenMuted};
  color: ${(p) =>
    p.$risk === 'high' ? C.red : p.$risk === 'med' ? C.orange : C.green};
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const TradingPanel = ({ currentTime }) => {
  // UI State
  const [orderType, setOrderType] = useState('limit');
  const [size, setSize] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [leverage, setLeverage] = useState(20);
  const [showTPSL, setShowTPSL] = useState(false);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');

  // Store Connections
  const { openPosition, balance, equity } = useTradingStore();
  const currentPrice = useMarketStore((s) => s.currentPrice);

  const [fromSetup, setFromSetup] = useState(false);
  const [pendingZoneId, setPendingZoneId] = useState(null);
  const tradeSetup = useTradeSetupStore((s) => s);

  // ── Trade Setup Tool integration ──────────────────────────────────────
  useEffect(() => {
    if (!tradeSetup.isReady) return;

    setOrderType('limit');
    if (tradeSetup.entryPrice != null) setLimitPrice(String(tradeSetup.entryPrice));
    
    let hasAdvanced = false;
    if (tradeSetup.stopLoss != null) {
      hasAdvanced = true;
      setStopLoss(String(tradeSetup.stopLoss));
    }
    if (tradeSetup.takeProfit != null) {
      hasAdvanced = true;
      setTakeProfit(String(tradeSetup.takeProfit));
    }
    
    if (hasAdvanced) setShowTPSL(true);
    setPendingZoneId(tradeSetup.zoneId ?? null);
    setFromSetup(true);
    
    useTradeSetupStore.getState().clearSetup();
  }, [tradeSetup.isReady, tradeSetup]);

  // Derived values & Risk Calcs
  const entryPrice = orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : currentPrice;
  const sizeNum = parseFloat(size) || 0;
  const slNum = showTPSL && stopLoss ? parseFloat(stopLoss) : null;
  const tpNum = showTPSL && takeProfit ? parseFloat(takeProfit) : null;

  // Margin required for the position cost summary
  const requiredMargin = entryPrice > 0 && leverage > 0 ? (sizeNum * entryPrice) / leverage : 0;

  // Risk amounts (agnostic of side until placed, calculated as absolute distance)
  const riskAmount = slNum ? Math.abs(entryPrice - slNum) * sizeNum * leverage : null;
  const rewardAmount = tpNum ? Math.abs(tpNum - entryPrice) * sizeNum * leverage : null;
  const riskPercent = riskAmount ? (riskAmount / balance) * 100 : null;
  const rrRatio = riskAmount && rewardAmount ? rewardAmount / riskAmount : null;

  const riskLevel =
    riskPercent === null ? null :
    riskPercent > 5 ? 'high' :
    riskPercent > 2 ? 'med' : 'low';

  // Submission handler modified to accept side from bottom buttons
  const handlePlaceOrder = useCallback((sideToPlace) => {
    if (!sizeNum || sizeNum <= 0) return;

    const positionId = openPosition({
      side: sideToPlace,
      type: orderType,
      entryPrice: currentPrice,
      limitPrice: orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : undefined,
      positionSize: sizeNum,
      leverage,
      stopLoss: showTPSL && stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: showTPSL && takeProfit ? parseFloat(takeProfit) : undefined,
      entryTime: currentTime ?? Math.floor(Date.now() / 1000),
    });

    if (pendingZoneId && positionId) {
      useTradeSetupStore.getState().setSetup({
        zoneLink: { zoneId: pendingZoneId, positionId, status: orderType === 'limit' ? 'pending' : 'open' },
      });
    }

    setStopLoss('');
    setTakeProfit('');
    setShowTPSL(false);
    setFromSetup(false);
    setPendingZoneId(null);
    if (orderType === 'limit') setLimitPrice('');
  }, [orderType, sizeNum, limitPrice, leverage, showTPSL, stopLoss, takeProfit, currentTime, currentPrice, openPosition, pendingZoneId]);

  return (
    <Panel>
      {/* Top Margin/Leverage Controls */}
      <TopControls>
        <BadgeBtn>Cross</BadgeBtn>
        <BadgeBtn>{leverage} X</BadgeBtn>
      </TopControls>

      {/* Tabs */}
      <TabsRow>
        <Tab $active={orderType === 'limit'} onClick={() => setOrderType('limit')}>Limit</Tab>
        <Tab $active={orderType === 'market'} onClick={() => setOrderType('market')}>Market</Tab>
        <Tab>Trigger ▾</Tab>
      </TabsRow>

      <FormContainer>
        {fromSetup && (
          <SetupBanner>📐 Pre-filled from chart setup — review & place</SetupBanner>
        )}

        {/* Balance & Equity row replaces Available */}
        <InfoRow>
          <InfoLabel>Balance</InfoLabel>
          <InfoValue>{balance.toFixed(2)} USDT</InfoValue>
        </InfoRow>
        <InfoRow style={{ marginTop: '-10px' }}>
          <InfoLabel>Equity</InfoLabel>
          <InfoValue $color={equity >= balance ? C.green : C.red}>
            {equity.toFixed(2)} USDT
          </InfoValue>
        </InfoRow>

        {/* Price Input */}
        <FieldGroup>
          <FieldLabel>Price</FieldLabel>
          <InputWrapper>
            <StyledInput
              type="number"
              step="0.01"
              placeholder={orderType === 'market' ? 'Market Price' : currentPrice.toFixed(2)}
              value={orderType === 'market' ? '' : limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              disabled={orderType === 'market'}
            />
            <Suffix>USDT</Suffix>
            {orderType === 'limit' && <SuffixButton>BBO</SuffixButton>}
          </InputWrapper>
        </FieldGroup>

        {/* Amount Input */}
        <FieldGroup>
          <FieldLabel>Amount (Lots)</FieldLabel>
          <InputWrapper>
            <StyledInput
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            />
            <Suffix>Lots</Suffix>
          </InputWrapper>
        </FieldGroup>

        {/* Leverage Slider (Integrated into the form to match the screenshot slider's position) */}
        <SliderContainer>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={leverage}
            onChange={(e) => setLeverage(parseInt(e.target.value))}
          />
          <SliderMarkers>
            <span>1x</span><span>25x</span><span>50x</span><span>75x</span><span>100x</span>
          </SliderMarkers>
        </SliderContainer>

        {/* Cost Summary */}
        <CostSummary>
          <span>Buy {requiredMargin.toFixed(2)} USDT</span>
          <span>Sell {requiredMargin.toFixed(2)} USDT</span>
        </CostSummary>

        {/* Extras Checkboxes */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CheckboxRow>
            <input type="checkbox" />
            Reduce-only
          </CheckboxRow>
          <span style={{ fontSize: '12px', color: C.text, cursor: 'pointer' }}>GTC ▾</span>
        </div>

        {/* TP/SL Toggle Section */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
          <CheckboxRow>
            <input 
              type="checkbox" 
              checked={showTPSL} 
              onChange={(e) => setShowTPSL(e.target.checked)} 
            />
            TP/SL
          </CheckboxRow>
          <span style={{ fontSize: '12px', color: C.orange, cursor: 'pointer' }}>Advanced</span>
        </div>

        {/* Conditional TP/SL Inputs */}
        {showTPSL && (
          <>
            <FieldGroup>
              <FieldLabel>TP trigger price</FieldLabel>
              <InputWrapper>
                <StyledInput
                  type="number"
                  step="0.00001"
                  placeholder="Price"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                />
                <SuffixButton style={{ border: 'none' }}>Last ▾</SuffixButton>
              </InputWrapper>
            </FieldGroup>
            
            <FieldGroup>
              <FieldLabel>SL trigger price</FieldLabel>
              <InputWrapper>
                <StyledInput
                  type="number"
                  step="0.00001"
                  placeholder="Price"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                />
                <SuffixButton style={{ border: 'none' }}>Last ▾</SuffixButton>
              </InputWrapper>
            </FieldGroup>
          </>
        )}

        {/* Original Risk/Reward Summary Box */}
        {riskPercent !== null && showTPSL && (
          <RiskBadge $risk={riskLevel}>
            <span>Risk {riskAmount?.toFixed(2)} ({riskPercent?.toFixed(1)}%)</span>
            {rrRatio !== null && (
              <span style={{ fontWeight: 600 }}>R:R {rrRatio.toFixed(2)}</span>
            )}
          </RiskBadge>
        )}

        {/* Action Buttons */}
        <ActionRow>
          <ActionBtn 
            $side="long" 
            onClick={() => handlePlaceOrder('long')}
            disabled={orderType === 'limit' && !limitPrice}
          >
            Buy long
          </ActionBtn>
          <ActionBtn 
            $side="short" 
            onClick={() => handlePlaceOrder('short')}
            disabled={orderType === 'limit' && !limitPrice}
          >
            Sell short
          </ActionBtn>
        </ActionRow>
      </FormContainer>
    </Panel>
  );
};

export default TradingPanel;