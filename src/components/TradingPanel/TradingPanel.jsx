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
  surfaceElevated: '#2a2e39', 
  border: '#2a2e39',
  borderFocus: '#3a5fcd',
  text: '#d1d4dc',
  textMuted: '#787b86',
  textDim: '#555b6e',
  green: '#0ecb81', 
  greenMuted: 'rgba(14, 203, 129, 0.15)',
  red: '#f23645', 
  redMuted: 'rgba(242, 54, 69, 0.15)',
  blue: '#2962ff',
  orange: '#f0a500', 
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

const HeaderSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 16px 0;
`;

const AccountRow = styled.div`
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
  margin-left: 4px;
`;

const TickerDisplay = styled.div`
  font-size: 22px;
  font-weight: 700;
  color: ${C.text};
  letter-spacing: -0.5px;
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
  margin-top: 8px;
`;

const TradingPanel = ({ currentTime, ticker = "BTC/USDT" }) => {
  // UI State
  const [orderType, setOrderType] = useState('limit');
  const [size, setSize] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [leverage, setLeverage] = useState(20);
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
    
    if (tradeSetup.stopLoss != null) {
      setStopLoss(String(tradeSetup.stopLoss));
    }
    if (tradeSetup.takeProfit != null) {
      setTakeProfit(String(tradeSetup.takeProfit));
    }
    
    setPendingZoneId(tradeSetup.zoneId ?? null);
    setFromSetup(true);
    
    useTradeSetupStore.getState().clearSetup();
  }, [tradeSetup.isReady, tradeSetup]);

  // Derived values & Risk Calcs
  const entryPrice = orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : currentPrice;
  const sizeNum = parseFloat(size) || 0;
  
  // SL/TP are always considered if populated
  const slNum = stopLoss ? parseFloat(stopLoss) : null;
  const tpNum = takeProfit ? parseFloat(takeProfit) : null;

  // Margin required for the position cost summary
  const requiredMargin = entryPrice > 0 && leverage > 0 ? (sizeNum * entryPrice) / leverage : 0;

  // Risk amounts
  const riskAmount = slNum ? Math.abs(entryPrice - slNum) * sizeNum * leverage : null;
  const rewardAmount = tpNum ? Math.abs(tpNum - entryPrice) * sizeNum * leverage : null;
  const riskPercent = riskAmount ? (riskAmount / balance) * 100 : null;
  const rrRatio = riskAmount && rewardAmount ? rewardAmount / riskAmount : null;

  const riskLevel =
    riskPercent === null ? null :
    riskPercent > 5 ? 'high' :
    riskPercent > 2 ? 'med' : 'low';

  // Submission handler 
  const handlePlaceOrder = useCallback((sideToPlace) => {
    if (!sizeNum || sizeNum <= 0) return;

    const positionId = openPosition({
      side: sideToPlace,
      type: orderType,
      entryPrice: currentPrice,
      limitPrice: orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : undefined,
      positionSize: sizeNum,
      leverage,
      stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
      entryTime: currentTime ?? Math.floor(Date.now() / 1000),
    });

    if (pendingZoneId && positionId) {
      useTradeSetupStore.getState().setSetup({
        zoneLink: { zoneId: pendingZoneId, positionId, status: orderType === 'limit' ? 'pending' : 'open' },
      });
    }

    setStopLoss('');
    setTakeProfit('');
    setFromSetup(false);
    setPendingZoneId(null);
    if (orderType === 'limit') setLimitPrice('');
  }, [orderType, sizeNum, limitPrice, leverage, stopLoss, takeProfit, currentTime, currentPrice, openPosition, pendingZoneId]);

  return (
    <Panel>
      {/* 1. Account Info & 4. Ticker Section */}
      <HeaderSection>
        <AccountRow>
          <div>
            <InfoLabel>Balance</InfoLabel>
            <InfoValue>{balance.toFixed(2)} USDT</InfoValue>
          </div>
          <div>
            <InfoLabel>Equity</InfoLabel>
            <InfoValue $color={equity >= balance ? C.green : C.red}>
              {equity.toFixed(2)} USDT
            </InfoValue>
          </div>
        </AccountRow>
        <TickerDisplay>{ticker}</TickerDisplay>
      </HeaderSection>

      {/* Top Margin/Leverage Controls */}
      <TopControls>
        <BadgeBtn>Cross</BadgeBtn>
        <BadgeBtn>{leverage} X</BadgeBtn>
      </TopControls>

      {/* 2. Simplified Tabs */}
      <TabsRow>
        <Tab $active={orderType === 'limit'} onClick={() => setOrderType('limit')}>Limit</Tab>
        <Tab $active={orderType === 'market'} onClick={() => setOrderType('market')}>Market</Tab>
      </TabsRow>

      <FormContainer>
        {fromSetup && (
          <SetupBanner>📐 Pre-filled from chart setup — review & place</SetupBanner>
        )}

        {/* 5. Live Price for Market Tab */}
        <FieldGroup>
          <FieldLabel>Price</FieldLabel>
          <InputWrapper>
            <StyledInput
              type="number"
              step="0.01"
              placeholder={orderType === 'market' ? currentPrice.toFixed(2) : '0.00'}
              value={orderType === 'market' ? currentPrice.toFixed(2) : limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              disabled={orderType === 'market'}
            />
            <Suffix>USDT</Suffix>
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

        {/* Leverage Slider */}
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

        {/* 3. Always Visible TP/SL Inputs */}
        <FieldGroup style={{ marginTop: '8px' }}>
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

        {/* Risk/Reward Summary Box */}
        {riskPercent !== null && (
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