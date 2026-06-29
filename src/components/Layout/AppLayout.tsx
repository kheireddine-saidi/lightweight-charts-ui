/**
 * AppLayout — resizable trading terminal layout.
 *
 * Panels are separated by drag handles (splitters).
 * Sizes are stored in state as pixel values and applied via inline styles
 * so CSS grid transitions don't interfere with dragging.
 *
 * Resizable seams:
 *   [chart | ←→ | right-panel] [chart | ←→ | right-panel]
 *   [         ↕ positions bar          ]
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import styled from 'styled-components';
import TradingPanel from '../TradingPanel/TradingPanel';
import PositionsPanel from '../PositionsPanel/PositionsPanel';
import SourceEditor from '../Indicators/SourceEditor';
import Watchlist from '../Watchlist/Watchlist';
import AlertsPanel from '../Alerts/AlertsPanel';
import RightToolbar from '../Toolbar/RightToolbar';

/* ─── Splitter handle ─── */
const HSplitter = styled.div<{ $dragging: boolean }>`
  width: 4px;
  background: ${(p) => (p.$dragging ? '#2962ff' : 'transparent')};
  cursor: col-resize;
  flex-shrink: 0;
  transition: background 0.15s;
  position: relative;
  z-index: 20;
  &:hover { background: #2962ff88; }
  &::after {
    content: '';
    position: absolute;
    inset: 0 -3px;  /* widen the hit area */
  }
`;

const VSplitter = styled.div<{ $dragging: boolean }>`
  height: 4px;
  background: ${(p) => (p.$dragging ? '#2962ff' : 'transparent')};
  cursor: row-resize;
  flex-shrink: 0;
  width: 100%;
  transition: background 0.15s;
  position: relative;
  z-index: 20;
  &:hover { background: #2962ff88; }
  &::after {
    content: '';
    position: absolute;
    inset: -3px 0;  /* widen the hit area */
  }
`;

/* ─── Layout shells ─── */
const Root = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: #131722;
  color: #d1d4dc;
  overflow: hidden;
  user-select: none;
`;

const TopRow = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: visible;
  position: relative;
`;

const ChartArea = styled.div`
  flex: 1;
  min-width: 0;
  position: relative;
  background: #131722;
  overflow: hidden;
  padding-top: 48px;
`;

const ChartOverlay = styled.div`
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  & > * { pointer-events: auto; }
`;

const TopbarWrapper = styled.div`
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 48px;
  /* z-index must exceed LWC's internal max (49) AND any other overlays */
  z-index: 1000;
  background: #1e222d;
  border-bottom: 1px solid #2a2e39;
`;

const LeftToolbarWrapper = styled.div`
  position: absolute;
  top: 48px; left: 0;
  z-index: 10;
`;

const RightPanel = styled.div<{ $visible: boolean; $width: number }>`
  width: ${(p) => (p.$visible ? `${p.$width}px` : '0px')};
  min-width: ${(p) => (p.$visible ? '180px' : '0px')};
  flex-shrink: 0;
  background: #1e222d;
  border-left: 1px solid #2a2e39;
  overflow-y: auto;
  overflow-x: hidden;
  display: ${(p) => (p.$visible ? 'flex' : 'none')};
  flex-direction: column;
  transition: ${(p) => (p.$visible ? 'none' : 'width 0.15s')};
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: #2a2e39; border-radius: 2px; }
`;

const RightToolbarArea = styled.div`
  width: 52px;
  flex-shrink: 0;
  background: #1e222d;
  border-left: 1px solid #2a2e39;
`;

const BottomRow = styled.div<{ $height: number }>`
  height: ${(p) => p.$height}px;
  min-height: 80px;
  flex-shrink: 0;
  background: #1e222d;
  border-top: 1px solid #2a2e39;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

/* ─── Props ─── */
interface AppLayoutProps {
  chart: React.ReactNode;
  topbar?: React.ReactNode;
  leftToolbar?: React.ReactNode;
  currentTime?: number;
  activeRightPanel?: string | null;
  onRightPanelChange?: (panel: string | null) => void;
  rightPanelBadges?: Record<string, number>;
  watchlistItems?: any[];
  watchlistCurrentSymbol?: string;
  onWatchlistSymbolSelect?: (symbol: string) => void;
  onWatchlistAddClick?: () => void;
  onWatchlistRemoveClick?: (symbol: string) => void;
  onWatchlistReorder?: (symbols: string[]) => void;
  alerts?: any[];
  alertLogs?: any[];
  onRemoveAlert?: (id: string) => void;
  onRestartAlert?: (price: number, condition: string) => void;
  onPauseAlert?: (id: string) => void;
  editingIndicator?: any | null;
  onCloseSourceEditor?: () => void;
}

/* ─── Hook: single-axis drag ─── */
function useDrag(
  onDelta: (delta: number) => void,
  axis: 'x' | 'y'
) {
  const dragging = useRef(false);
  const last = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    last.current = axis === 'x' ? e.clientX : e.clientY;
    setIsDragging(true);

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const cur = axis === 'x' ? ev.clientX : ev.clientY;
      onDelta(cur - last.current);
      last.current = cur;
    };

    const onUp = () => {
      dragging.current = false;
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [axis, onDelta]);

  return { onMouseDown, isDragging };
}

/* ─── Component ─── */
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
  editingIndicator = null,
  onCloseSourceEditor,
}) => {
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const [bottomHeight, setBottomHeight] = useState(240);
  const showPanel = !!activeRightPanel;

  /* Horizontal splitter — resizes right panel */
  const onHDelta = useCallback((delta: number) => {
    setRightPanelWidth((w) => Math.max(180, Math.min(600, w - delta)));
  }, []);

  /* Vertical splitter — resizes bottom bar */
  const onVDelta = useCallback((delta: number) => {
    setBottomHeight((h) => Math.max(80, Math.min(window.innerHeight - 200, h - delta)));
  }, []);

  const hDrag = useDrag(onHDelta, 'x');
  const vDrag = useDrag(onVDelta, 'y');

  /* Prevent text selection while dragging */
  useEffect(() => {
    if (hDrag.isDragging || vDrag.isDragging) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = hDrag.isDragging ? 'col-resize' : 'row-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  }, [hDrag.isDragging, vDrag.isDragging]);

  return (
    <Root>
      {/* Top area: chart + optional right panel + toolbar */}
      <TopRow>
        <ChartArea>
          {chart}
          <ChartOverlay>
            {topbar && <TopbarWrapper>{topbar}</TopbarWrapper>}
            {leftToolbar && <LeftToolbarWrapper>{leftToolbar}</LeftToolbarWrapper>}
          </ChartOverlay>
        </ChartArea>

        {/* Horizontal splitter — only visible when panel is open */}
        {showPanel && (
          <HSplitter
            $dragging={hDrag.isDragging}
            onMouseDown={hDrag.onMouseDown}
            title="Drag to resize panel"
          />
        )}

        <RightPanel $visible={showPanel} $width={rightPanelWidth}>
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
        </RightPanel>

        <RightToolbarArea>
          <RightToolbar
            activePanel={activeRightPanel}
            onPanelChange={onRightPanelChange || (() => {})}
            badges={rightPanelBadges}
          />
        </RightToolbarArea>
      </TopRow>

      {/* Vertical splitter between chart and bottom bar */}
      <VSplitter
        $dragging={vDrag.isDragging}
        onMouseDown={vDrag.onMouseDown}
        title="Drag to resize positions panel"
      />

      {/* Bottom: positions panel OR source editor */}
      <BottomRow $height={bottomHeight}>
        {editingIndicator
          ? <SourceEditor indicator={editingIndicator} onClose={onCloseSourceEditor ?? (() => {})} />
          : <PositionsPanel />
        }
      </BottomRow>
    </Root>
  );
};
