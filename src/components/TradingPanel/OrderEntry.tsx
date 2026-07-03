// components/TradingPanel/OrderEntry.tsx
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore } from '../../stores/marketStore';
import { useWorkspaceStore } from '../../features/workspace/WorkspaceStore';

const Form = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SideSelector = styled.div`
  display: flex;
  gap: 8px;
  button {
    flex: 1;
    padding: 8px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    background: #2a2e39;
    color: #787b86;
    &.long.active {
      background: #00b894;
      color: #fff;
    }
    &.short.active {
      background: #ff6b6b;
      color: #fff;
    }
  }
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  label {
    font-size: 12px;
    color: #787b86;
  }
  input, select {
    padding: 8px 12px;
    background: #2a2e39;
    border: 1px solid #2a2e39;
    border-radius: 4px;
    color: #d1d4dc;
    font-size: 14px;
    &:focus {
      outline: none;
      border-color: #2962ff;
    }
  }
`;

const PlaceButton = styled.button<{ side: 'long' | 'short' }>`
  padding: 12px;
  border: none;
  border-radius: 4px;
  font-weight: 600;
  font-size: 16px;
  cursor: pointer;
  background: ${props => props.side === 'long' ? '#00b894' : '#ff6b6b'};
  color: #fff;
  &:hover {
    opacity: 0.85;
  }
`;

export const OrderEntry: React.FC = () => {
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [size, setSize] = useState(0.01);
  const [leverage, setLeverage] = useState(1);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');

  const { openPosition } = useTradingStore();
  const symbol = useWorkspaceStore((s) => s.getActiveChart()?.symbol ?? 'BTCUSDT');
  const currentPrice = useMarketStore((s) => s.getPriceForSymbol(symbol) || s.currentPrice);

  const handlePlaceOrder = () => {
    openPosition({
      symbol,
      side,
      type: orderType,
      entryPrice: currentPrice,
      positionSize: size,
      leverage,
      stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
    });
  };

  return (
    <Form>
      <SideSelector>
        <button className={`long${side === 'long' ? ' active' : ''}`} onClick={() => setSide('long')}>
          LONG
        </button>
        <button className={`short${side === 'short' ? ' active' : ''}`} onClick={() => setSide('short')}>
          SHORT
        </button>
      </SideSelector>

      <InputGroup>
        <label>Order Type</label>
        <select value={orderType} onChange={(e) => setOrderType(e.target.value as any)}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
        </select>
      </InputGroup>

      <InputGroup>
        <label>Position Size</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={size}
          onChange={(e) => setSize(parseFloat(e.target.value))}
        />
      </InputGroup>

      <InputGroup>
        <label>Leverage</label>
        <input
          type="number"
          step="1"
          min="1"
          max="100"
          value={leverage}
          onChange={(e) => setLeverage(parseInt(e.target.value))}
        />
      </InputGroup>

      <InputGroup>
        <label>Stop Loss (optional)</label>
        <input
          type="number"
          step="0.00001"
          placeholder="Price"
          value={stopLoss}
          onChange={(e) => setStopLoss(e.target.value)}
        />
      </InputGroup>

      <InputGroup>
        <label>Take Profit (optional)</label>
        <input
          type="number"
          step="0.00001"
          placeholder="Price"
          value={takeProfit}
          onChange={(e) => setTakeProfit(e.target.value)}
        />
      </InputGroup>

      <PlaceButton side={side} onClick={handlePlaceOrder}>
        {side === 'long' ? 'BUY' : 'SELL'} {orderType === 'market' ? 'Market' : 'Limit'}
      </PlaceButton>
    </Form>
  );
};