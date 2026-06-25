// components/Layout/AppLayout.tsx
import React from 'react';
import styled from 'styled-components';
import TradingPanel from '../TradingPanel/TradingPanel';
import PositionsPanel from '../PositionsPanel/PositionsPanel';
import Watchlist from '../Watchlist/Watchlist';
import AlertsPanel from '../Alerts/AlertsPanel';
import RightToolbar from '../Toolbar/RightToolbar';

/* ─── Layout grid ─── */
// Columns: chart (1fr) | optional panel (280px when visible) | toolbar (52px)
const Layout = styled.div<{ $showPanel: boolean }>`
  display: grid;
  grid-template-columns: 1fr ${(p) => (p.$showPanel ? '280px' : '0px')} 52px;
  grid-template-rows: 1fr 240px;
  height: 100vh;
  width: 100vw;
  background: #131722;
  color: #d1d4dc;
  transition: grid-template-columns 0.18s ease;
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

/* Right toolbar column — spans both rows, now in column 3 (far right) */
const RightToolbarArea = styled.div`
  grid-row: 1 / 3;
  grid-column: 3 / 4;
  background: #1e222d;
  border-left: 1px solid #2a2e39;
  overflow: hidden;
`;

/* Right side panel — spans both rows, now in column 2 (between chart and toolbar) */
const RightPanelArea = styled.div<{ $visible: boolean }>`
  grid-row: 1 / 3;
  grid-column: 2 / 3;
  background: #1e222d;
  border-left: 1px solid #2a2e39;
  overflow-y: auto;
  overflow-x: hidden;
  display: ${(p) => (p.$visible ? 'flex' : 'none')};
  flex-direction: column;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: #2a2e39; border-radius: 2px; }
`;

const PositionsArea = styled.div`
  grid-row: 2 / 3;
  grid-column: 1 / 2;
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
  // Right panel management
  activeRightPanel?: string | null;
  onRightPanelChange?: (panel: string | null) => void;
  rightPanelBadges?: Record<string, number>;
  // Watchlist props (passed through)
  watchlistItems?: any[];
  watchlistCurrentSymbol?: string;
  onWatchlistSymbolSelect?: (symbol: string) => void;
  onWatchlistAddClick?: () => void;
  onWatchlistRemoveClick?: (symbol: string) => void;
  onWatchlistReorder?: (symbols: string[]) => void;
  // Alerts props
  alerts?: any[];
  alertLogs?: any[];
  onRemoveAlert?: (id: string) => void;
  onRestartAlert?: (price: number, condition: string) => void;
  onPauseAlert?: (id: string) => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  chart,
  topbar,
  leftToolbar,
  currentTime,
  activeRightPanel,
  onRightPanelChange,
  rightPanelBadges = {},
  watchlistItems = [],
  watchlistCurrentSymbol,
  onWatchlistSymbolSelect,
  onWatchlistAddClick,
  onWatchlistRemoveClick,
  onWatchlistReorder,
  alerts = [],
  alertLogs = [],
  onRemoveAlert,
  onRestartAlert,
  onPauseAlert,
}) => {
  const showPanel = !!activeRightPanel;

  return (
    <Layout $showPanel={showPanel}>
      {/* Main chart area */}
      <ChartArea>
        {chart}
        <ChartOverlay>
          {topbar && <TopbarWrapper>{topbar}</TopbarWrapper>}
          {leftToolbar && <LeftToolbarWrapper>{leftToolbar}</LeftToolbarWrapper>}
        </ChartOverlay>
      </ChartArea>

      {/* Right side panel — now between chart and toolbar */}
      <RightPanelArea $visible={showPanel}>
        {activeRightPanel === 'watchlist' && (
          <Watchlist
            currentSymbol={watchlistCurrentSymbol}
            items={watchlistItems}
            onSymbolSelect={onWatchlistSymbolSelect}
            onAddClick={onWatchlistAddClick}
            onRemoveClick={onWatchlistRemoveClick}
            onReorder={onWatchlistReorder}
          />
        )}
        {activeRightPanel === 'trading' && (
          <TradingPanel currentTime={currentTime} />
        )}
        {activeRightPanel === 'alerts' && (
          <AlertsPanel
            alerts={alerts}
            logs={alertLogs}
            onRemoveAlert={onRemoveAlert}
            onRestartAlert={onRestartAlert}
            onPauseAlert={onPauseAlert}
          />
        )}
      </RightPanelArea>

      {/* Right toolbar (icon buttons) — now at far right */}
      <RightToolbarArea>
        <RightToolbar
          activePanel={activeRightPanel}
          onPanelChange={onRightPanelChange || (() => {})}
          badges={rightPanelBadges}
        />
      </RightToolbarArea>

      {/* Bottom positions panel */}
      <PositionsArea>
        <PositionsPanel />
      </PositionsArea>
    </Layout>
  );
};