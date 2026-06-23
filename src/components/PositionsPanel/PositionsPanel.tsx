// components/PositionsPanel/PositionsPanel.jsx
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTradingStore } from '../../stores/tradingStore';
import { useMarketStore } from '../../stores/marketStore';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const Tabs = styled.div`
  display: flex;
  gap: 16px;
  border-bottom: 1px solid #2a2e39;
  padding-bottom: 8px;
  margin-bottom: 8px;
`;

const Tab = styled.button`
  background: none;
  border: none;
  color: ${(props) => (props.$active ? '#d1d4dc' : '#787b86')};
  font-size: 14px;
  font-weight: ${(props) => (props.$active ? '600' : '400')};
  cursor: pointer;
  padding: 4px 0;
  border-bottom: ${(props) => (props.$active ? '2px solid #2962ff' : 'none')};
  &:hover {
    color: #d1d4dc;
  }
`;

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

const SideBadge = styled.span`
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: ${(props) => (props.$side === 'long' ? '#00b89433' : '#ff6b6b33')};
  color: ${(props) => (props.$side === 'long' ? '#00b894' : '#ff6b6b')};
`;

const PnL = styled.span`
  color: ${(props) => (props.$value >= 0 ? '#00b894' : '#ff6b6b')};
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

const OpenPositions = () => {
  const positions = useTradingStore((state) => state.positions);
  const closePosition = useTradingStore((state) => state.closePosition);
  const currentPrice = useMarketStore((state) => state.currentPrice);

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
            <td>
              <SideBadge $side={pos.side}>{pos.side.toUpperCase()}</SideBadge>
            </td>
            <td>{pos.leverage}x</td>
            <td>{pos.positionSize}</td>
            <td>{pos.entryPrice.toFixed(5)}</td>
            <td>
              <PnL $value={pos.pnl}>
                {pos.pnl >= 0 ? '+' : ''}
                {pos.pnl.toFixed(2)} ({pos.pnlPercent.toFixed(2)}%)
              </PnL>
            </td>
            <td>
              {pos.stopLoss || '-'} / {pos.takeProfit || '-'}
            </td>
            <td>
              <CloseButton onClick={() => closePosition(pos.id, currentPrice)}>Close</CloseButton>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

const HistoryTab = () => {
  const closedPositions = useTradingStore((state) => state.closedPositions);

  if (closedPositions.length === 0) {
    return <div style={{ padding: '20px', color: '#787b86', textAlign: 'center' }}>No history</div>;
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>Side</th>
          <th>Size</th>
          <th>Entry</th>
          <th>Exit</th>
          <th>PnL</th>
        </tr>
      </thead>
      <tbody>
        {closedPositions.map((pos) => (
          <tr key={pos.id}>
            <td>
              <SideBadge $side={pos.side}>{pos.side.toUpperCase()}</SideBadge>
            </td>
            <td>{pos.positionSize}</td>
            <td>{pos.entryPrice.toFixed(5)}</td>
            <td>{pos.closePrice.toFixed(5)}</td>
            <td>
              <PnL $value={pos.pnl}>{pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)}</PnL>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

const PositionsPanel = () => {
  const [activeTab, setActiveTab] = useState('open');
  const positions = useTradingStore((state) => state.positions);
  const closedPositions = useTradingStore((state) => state.closedPositions);

  return (
    <Container>
      <Tabs>
        <Tab $active={activeTab === 'open'} onClick={() => setActiveTab('open')}>
          Open Positions ({positions.length})
        </Tab>
        <Tab $active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
          History ({closedPositions.length})
        </Tab>
      </Tabs>
      {activeTab === 'open' ? <OpenPositions /> : <HistoryTab />}
    </Container>
  );
};

export default PositionsPanel;