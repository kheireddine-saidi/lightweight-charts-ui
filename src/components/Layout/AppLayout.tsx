// components/Layout/AppLayout.tsx
import React from 'react';
import styled from 'styled-components';
import TradingPanel from '../TradingPanel/TradingPanel';
import PositionsPanel from '../PositionsPanel/PositionsPanel';

const Layout = styled.div`
  display: grid;
  grid-template-columns: 1fr 280px;
  grid-template-rows: 1fr 240px;
  height: 100vh;
  width: 100vw;
  background: #131722;
  color: #d1d4dc;
`;

const ChartArea = styled.div`
  grid-row: 1 / 2;
  grid-column: 1 / 2;
  position: relative;
  background: #131722;
  overflow: hidden;
  padding-top: 48px;
`;

const ChartOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  & > * {
    pointer-events: auto;
  }
`;

const TopbarWrapper = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  z-index: 10;
  background: #1e222d;
  border-bottom: 1px solid #2a2e39;
`;

const LeftToolbarWrapper = styled.div`
  position: absolute;
  top: 48px;
  left: 0;
  z-index: 10;
`;

const TradingPanelArea = styled.div`
  grid-row: 1 / 2;
  grid-column: 2 / 3;
  background: #1e222d;
  border-left: 1px solid #2a2e39;
  overflow-y: auto;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: #2a2e39; border-radius: 2px; }
`;

const PositionsArea = styled.div`
  grid-row: 2 / 3;
  grid-column: 1 / 3;
  background: #1e222d;
  border-top: 1px solid #2a2e39;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

interface AppLayoutProps {
  chart: React.ReactNode;
  topbar?: React.ReactNode;
  leftToolbar?: React.ReactNode;
  currentTime?: number;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ chart, topbar, leftToolbar, currentTime }) => {
  return (
    <Layout>
      <ChartArea>
        {chart}
        <ChartOverlay>
          {topbar && <TopbarWrapper>{topbar}</TopbarWrapper>}
          {leftToolbar && <LeftToolbarWrapper>{leftToolbar}</LeftToolbarWrapper>}
        </ChartOverlay>
      </ChartArea>
      <TradingPanelArea>
        <TradingPanel currentTime={currentTime} />
      </TradingPanelArea>
      <PositionsArea>
        <PositionsPanel />
      </PositionsArea>
    </Layout>
  );
};
