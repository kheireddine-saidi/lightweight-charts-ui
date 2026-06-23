// components/PositionsPanel/OpenPositions.tsx
import React from 'react';
import styled from 'styled-components';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore } from '../../stores/marketStore';

const Table = styled.table`
  width: 100%;
  font-size: 13px;
  border-collapse: collapse;
  th {
    text-align: left;
    padding: 6px 8px;
    color: #787b86;
    font-weight: 400;
    border-bottom: 1px solid #2a2e39;
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid #2a2e39;
  }
`;

const SideBadge = styled.span<{ side: 'long' | 'short' }>`
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: ${props => props.side === 'long' ? '#00b89433' : '#ff6b6b33'};
  color: ${props => props.side === 'long' ? '#00b894' : '#ff6b6b'};
`;

const PnL = styled.span<{ value: number }>`
  color: ${props => props.value >= 0 ? '#00b894' : '#ff6b6b'};
`;

const CloseButton = styled.button`
  padding: 4px 12px;
  background: #ff6b6b;
  border: none;
  border-radius: 3px;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  &:hover {
    opacity: 0.85;
  }
`;

export const OpenPositions: React.FC = () => {
  const positions = useTradingStore((state) => state.positions);
  const closePosition = useTradingStore((state) => state.closePosition);
  const currentPrice = useMarketStore((state) => state.currentPrice);

  // Update PnL on price change
  React.useEffect(() => {
    // useTradingStore.getState().updatePnL(currentPrice);
  }, [currentPrice]);

  if (positions.length === 0) {
    return <div style={{ padding: '20px', color: '#787b86', textAlign: 'center' }}>No open positions</div>;
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>Side</th>
          <th>Leverage</th>
          <th>Size</th>
          <th>Entry</th>
          <th>PnL</th>
          <th>SL/TP</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((pos) => (
          <tr key={pos.id}>
            <td><SideBadge side={pos.side}>{pos.side.toUpperCase()}</SideBadge></td>
            <td>{pos.leverage}x</td>
            <td>{pos.positionSize}</td>
            <td>{pos.entryPrice.toFixed(5)}</td>
            <td><PnL value={pos.pnl}>{pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)} ({pos.pnlPercent.toFixed(2)}%)</PnL></td>
            <td>{pos.stopLoss || '-'} / {pos.takeProfit || '-'}</td>
            <td>
              <CloseButton onClick={() => closePosition(pos.id, currentPrice)}>
                Close
              </CloseButton>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};