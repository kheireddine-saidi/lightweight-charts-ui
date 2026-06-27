/**
 * App — application composition root.
 *
 * After refactor this file owns ONLY:
 *  - Providers / layout structure
 *  - UI-only state (tool selection, search dialog, toasts)
 *  - Event wiring between independent features
 *
 * Workspace state (charts, layout, intervals) lives in WorkspaceStore.
 * Trading state lives in tradingStore / ExecutionEngine.
 * Alert state lives in useAlerts.
 * Watchlist state lives in useWatchlist.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout/Layout';
import Topbar from './components/Topbar/Topbar';
import DrawingToolbar from './components/Toolbar/DrawingToolbar';
import ChartGrid from './components/Chart/ChartGrid';
import SymbolSearch from './components/SymbolSearch/SymbolSearch';
import Toast from './components/Toast/Toast';
import SnapshotToast from './components/Toast/SnapshotToast';
import html2canvas from 'html2canvas';

import AlertDialog from './components/Alert/AlertDialog';
import { AppLayout } from './components/Layout/AppLayout';

import { useTradeMarkers } from './hooks/useTradeMarkers';
import { useWatchlist } from './features/watchlist/useWatchlist';
import { useAlerts } from './features/alerts/useAlerts';
import { useReplaySync } from './features/replay/useReplaySync';
import { EventBus, Events } from './core/EventBus';

// ── Workspace state — extracted from App ────────────────────────────────────
import { useWorkspaceStore } from './features/workspace/WorkspaceStore';

function App() {
  // ── Workspace state (from store) ──────────────────────────────────────────
  const layout            = useWorkspaceStore((s) => s.layout);
  const activeChartId     = useWorkspaceStore((s) => s.activeChartId);
  const charts            = useWorkspaceStore((s) => s.charts);
  const favoriteIntervals = useWorkspaceStore((s) => s.favoriteIntervals);
  const customIntervals   = useWorkspaceStore((s) => s.customIntervals);
  const lastNonFavoriteInterval = useWorkspaceStore((s) => s.lastNonFavoriteInterval);
  const getActiveChart    = useWorkspaceStore((s) => s.getActiveChart);

  const setActiveChartId         = useWorkspaceStore((s) => s.setActiveChartId);
  const setLayout                = useWorkspaceStore((s) => s.setLayout);
  const saveLayout               = useWorkspaceStore((s) => s.saveLayout);
  const setActiveChartSymbol     = useWorkspaceStore((s) => s.setActiveChartSymbol);
  const setActiveChartInterval   = useWorkspaceStore((s) => s.setActiveChartInterval);
  const toggleActiveChartIndicator = useWorkspaceStore((s) => s.toggleActiveChartIndicator);
  const addComparisonSymbol      = useWorkspaceStore((s) => s.addComparisonSymbol);
  const toggleFavoriteInterval   = useWorkspaceStore((s) => s.toggleFavoriteInterval);
  const addCustomInterval        = useWorkspaceStore((s) => s.addCustomInterval);
  const removeCustomInterval     = useWorkspaceStore((s) => s.removeCustomInterval);

  const activeChart     = getActiveChart();
  const currentSymbol   = activeChart?.symbol ?? 'BTCUSDT';
  const currentInterval = activeChart?.interval ?? '1d';

  // ── Chart refs (still needed for imperative chart API calls) ──────────────
  const chartRefs = React.useRef({});

  // ── UI-only state ─────────────────────────────────────────────────────────
  const [chartType, setChartType]       = useState('candlestick');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchMode, setSearchMode]     = useState('switch');
  const [toast, setToast]               = useState(null);
  const [snapshotToast, setSnapshotToast] = useState(null);
  const [isAlertOpen, setIsAlertOpen]   = useState(false);
  const [alertPrice, setAlertPrice]     = useState(null);
  const [activeRightPanel, setActiveRightPanel] = useState('watchlist');
  const [theme, setTheme]               = useState(() => localStorage.getItem('tv_theme') || 'dark');
  const [activeTool, setActiveTool]     = useState(null);
  const [isMagnetMode, setIsMagnetMode] = useState(false);
  const [showDrawingToolbar, setShowDrawingToolbar] = useState(true);
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isDrawingsLocked, setIsDrawingsLocked] = useState(false);
  const [isDrawingsHidden, setIsDrawingsHidden] = useState(false);
  const [isTimerVisible, setIsTimerVisible] = useState(false);
  const [currentTimeRange, setCurrentTimeRange] = useState('All');
  const [isLogScale, setIsLogScale]     = useState(false);
  const [isAutoScale, setIsAutoScale]   = useState(true);

  // Toast refs for cleanup
  const toastTimeoutRef         = React.useRef(null);
  const snapshotToastTimeoutRef = React.useRef(null);

  // ── Toast helpers ─────────────────────────────────────────────────────────
  const showToast = useCallback((message, type = 'error') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const showSnapshotToast = useCallback((message) => {
    if (snapshotToastTimeoutRef.current) clearTimeout(snapshotToastTimeoutRef.current);
    setSnapshotToast({ message });
    snapshotToastTimeoutRef.current = setTimeout(() => setSnapshotToast(null), 3000);
  }, []);

  // ── Theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('tv_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    if (snapshotToastTimeoutRef.current) clearTimeout(snapshotToastTimeoutRef.current);
  }, []);

  // ── Features ──────────────────────────────────────────────────────────────
  const {
    alerts, alertLogs, unreadAlertCount,
    handleSaveAlert: _handleSaveAlert,
    handleRemoveAlert: _handleRemoveAlert,
    handleRestartAlert: _handleRestartAlert,
    handlePauseAlert: _handlePauseAlert,
    handleChartAlertsSync: _handleChartAlertsSync,
    handleChartAlertTriggered: _handleChartAlertTriggered,
    markAlertsRead,
  } = useAlerts(currentSymbol, showToast);

  const {
    watchlistSymbols, setWatchlistSymbols, watchlistData,
    handleWatchlistReorder, handleRemoveFromWatchlist,
  } = useWatchlist(showToast);

  // ── Symbol search handlers ─────────────────────────────────────────────────
  const handleSymbolChange = (symbol) => {
    if (searchMode === 'switch') {
      setActiveChartSymbol(symbol);
    } else if (searchMode === 'compare') {
      addComparisonSymbol(symbol);
      // Stay open in compare mode so user can add multiple
      return;
    } else {
      // 'add' mode — add to watchlist
      if (!watchlistSymbols.includes(symbol)) {
        setWatchlistSymbols((prev) => [...prev, symbol]);
        showToast(`${symbol} added to watchlist`, 'success');
      }
    }
    setIsSearchOpen(false);
  };

  const handleWatchlistSymbolSelect = (symbol) => setActiveChartSymbol(symbol);

  const handleSymbolClick  = () => { setSearchMode('switch'); setIsSearchOpen(true); };
  const handleCompareClick = () => { setSearchMode('compare'); setIsSearchOpen(true); };

  // ── Interval handlers ──────────────────────────────────────────────────────
  const handleIntervalChange = (newInterval) => setActiveChartInterval(newInterval);

  const handleToggleFavorite = (interval) => {
    if (!interval) { showToast('Invalid interval provided', 'error'); return; }
    toggleFavoriteInterval(interval);
  };

  const handleAddCustomInterval = (value, unit) => {
    const result = addCustomInterval(value, unit);
    if (result?.error) showToast(result.error, 'error');
    else showToast('Custom interval added successfully!', 'success');
  };

  const handleRemoveCustomInterval = (intervalValue) => removeCustomInterval(intervalValue);

  // ── Layout handlers ────────────────────────────────────────────────────────
  const handleLayoutChange = (newLayout) => setLayout(newLayout);

  const handleSaveLayout = () => {
    const ok = saveLayout();
    if (ok) showSnapshotToast('Layout saved successfully');
    else showToast('Failed to save layout', 'error');
  };

  // ── Drawing tool handlers ──────────────────────────────────────────────────
  const handleToolChange = (tool) => {
    if (tool === 'magnet') {
      setIsMagnetMode((prev) => !prev);
    } else if (tool === 'undo') {
      chartRefs.current[activeChartId]?.undo();
      setActiveTool(null);
    } else if (tool === 'redo') {
      chartRefs.current[activeChartId]?.redo();
      setActiveTool(null);
    } else if (tool === 'clear' || tool === 'clear_all') {
      chartRefs.current[activeChartId]?.clearTools();
      setIsDrawingsHidden(false);
      setIsDrawingsLocked(false);
      setActiveTool(null);
    } else if (tool === 'lock_all') {
      setIsDrawingsLocked((prev) => !prev);
      setActiveTool(tool);
    } else if (tool === 'hide_drawings') {
      setIsDrawingsHidden((prev) => !prev);
      setActiveTool(tool);
    } else if (tool === 'show_timer') {
      setIsTimerVisible((prev) => !prev);
      setActiveTool(tool);
    } else {
      setActiveTool(tool);
    }
  };

  const handleToolUsed = useCallback(() => setActiveTool(null), []);

  const handleUndo = () => handleToolChange('undo');
  const handleRedo = () => handleToolChange('redo');

  // ── Screenshot / fullscreen ────────────────────────────────────────────────
  const handleDownloadImage = async () => {
    const ref = chartRefs.current[activeChartId];
    if (!ref) return;
    const container = ref.getChartContainer();
    if (!container) return;
    try {
      const canvas = await html2canvas(container, { useCORS: true, allowTaint: true, backgroundColor: '#131722' });
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      link.href = image;
      link.download = `${currentSymbol}_${dateStr}_${timeStr}.png`;
      link.click();
    } catch {
      showToast('Failed to download image', 'error');
    }
  };

  const handleCopyImage = async () => {
    const ref = chartRefs.current[activeChartId];
    if (!ref) return;
    const container = ref.getChartContainer();
    if (!container) return;
    try {
      const canvas = await html2canvas(container, { useCORS: true, allowTaint: true, backgroundColor: '#131722' });
      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showSnapshotToast('Link to the chart image copied to clipboard');
        } catch {
          showToast('Failed to copy to clipboard', 'error');
        }
      });
    } catch {
      showToast('Failed to capture image', 'error');
    }
  };

  const handleFullScreen = () => {
    const ref = chartRefs.current[activeChartId];
    const container = ref?.getChartContainer();
    if (!container) return;
    (container.requestFullscreen || container.webkitRequestFullscreen || container.msRequestFullscreen)?.call(container);
  };

  // ── Replay ────────────────────────────────────────────────────────────────
  const handleReplayClick = () => chartRefs.current[activeChartId]?.toggleReplay();

  const handleReplayModeChange = (chartId, isActive) => {
    if (chartId === activeChartId) setIsReplayMode(isActive);
  };

  // ── Alerts ────────────────────────────────────────────────────────────────
  const handleAlertClick = () => {
    const ref = chartRefs.current[activeChartId];
    if (!ref) return;
    const price = ref.getCurrentPrice();
    if (price !== null) { setAlertPrice(price); setIsAlertOpen(true); }
    else showToast('No price data available', 'error');
  };

  const handleSaveAlert      = (alertData) => _handleSaveAlert(alertData, chartRefs, activeChartId);
  const handleRemoveAlert    = (id) => _handleRemoveAlert(id, chartRefs);
  const handleRestartAlert   = (id) => _handleRestartAlert(id, alerts, chartRefs);
  const handlePauseAlert     = (id) => _handlePauseAlert(id, alerts, chartRefs);
  const handleChartAlertsSync = (chartId, symbol, chartAlerts) => _handleChartAlertsSync(chartId, symbol, chartAlerts, alerts);
  const handleChartAlertTriggered = (chartId, symbol, evt) => _handleChartAlertTriggered(chartId, symbol, evt);

  const handleRightPanelToggle = (panel) => {
    setActiveRightPanel(panel);
    if (panel === 'alerts') markAlertsRead();
  };

  // ── Trade markers & replay sync hooks ─────────────────────────────────────
  useTradeMarkers(chartRefs, activeChartId, charts);
  useReplaySync(isReplayMode, activeChartId, chartRefs);

  // ── EventBus wiring ───────────────────────────────────────────────────────
  useEffect(() => {
    const unsubDrawn = EventBus.on(Events.TRADE_SETUP_DRAWN, () => {
      setActiveRightPanel('trading');
    });
    const unsubLink = EventBus.on(Events.TRADE_ZONE_LINKED, ({ zoneId, positionId, status }) => {
      Object.values(chartRefs.current).forEach((ref) => {
        ref?.updateTradeZone?.(zoneId, { positionId, status });
      });
    });
    return () => { unsubDrawn(); unsubLink(); };
  }, []);

  const getCurrentTime = useCallback(() => {
    const ref = chartRefs.current[activeChartId];
    if (ref && typeof ref.getCurrentTime === 'function') return ref.getCurrentTime();
    return Math.floor(Date.now() / 1000);
  }, [activeChartId]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <AppLayout
        currentTime={getCurrentTime()}
        activeRightPanel={activeRightPanel}
        onRightPanelChange={handleRightPanelToggle}
        rightPanelBadges={{ alerts: unreadAlertCount }}
        watchlistItems={watchlistData}
        watchlistCurrentSymbol={currentSymbol}
        onWatchlistSymbolSelect={handleWatchlistSymbolSelect}
        onWatchlistAddClick={() => { setSearchMode('switch'); setIsSearchOpen(true); }}
        onWatchlistRemoveClick={handleRemoveFromWatchlist}
        onWatchlistReorder={handleWatchlistReorder}
        alerts={alerts}
        alertLogs={alertLogs}
        onRemoveAlert={handleRemoveAlert}
        onRestartAlert={handleRestartAlert}
        onPauseAlert={handlePauseAlert}
        chart={
          <ChartGrid
            currentTime={getCurrentTime()}
            charts={charts}
            layout={layout}
            activeChartId={activeChartId}
            onActiveChartChange={setActiveChartId}
            chartRefs={chartRefs}
            onAlertsSync={handleChartAlertsSync}
            onAlertTriggered={handleChartAlertTriggered}
            onReplayModeChange={handleReplayModeChange}
            chartType={chartType}
            activeTool={activeTool}
            onToolUsed={handleToolUsed}
            isLogScale={isLogScale}
            isAutoScale={isAutoScale}
            magnetMode={isMagnetMode}
            timeRange={currentTimeRange}
            isToolbarVisible={showDrawingToolbar}
            theme={theme}
            isDrawingsLocked={isDrawingsLocked}
            isDrawingsHidden={isDrawingsHidden}
            isTimerVisible={isTimerVisible}
          />
        }
        topbar={
          <Topbar
            symbol={currentSymbol}
            interval={currentInterval}
            chartType={chartType}
            indicators={activeChart?.indicators}
            favoriteIntervals={favoriteIntervals}
            customIntervals={customIntervals}
            lastNonFavoriteInterval={lastNonFavoriteInterval}
            onSymbolClick={handleSymbolClick}
            onIntervalChange={handleIntervalChange}
            onChartTypeChange={setChartType}
            onToggleIndicator={toggleActiveChartIndicator}
            onToggleFavorite={handleToggleFavorite}
            onAddCustomInterval={handleAddCustomInterval}
            onRemoveCustomInterval={handleRemoveCustomInterval}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onMenuClick={() => setShowDrawingToolbar((prev) => !prev)}
            theme={theme}
            onToggleTheme={toggleTheme}
            onDownloadImage={handleDownloadImage}
            onCopyImage={handleCopyImage}
            onFullScreen={handleFullScreen}
            onReplayClick={handleReplayClick}
            isReplayMode={isReplayMode}
            onAlertClick={handleAlertClick}
            onCompareClick={handleCompareClick}
            layout={layout}
            onLayoutChange={handleLayoutChange}
            onSaveLayout={handleSaveLayout}
          />
        }
        leftToolbar={
          <DrawingToolbar
            activeTool={activeTool}
            isMagnetMode={isMagnetMode}
            onToolChange={handleToolChange}
            isDrawingsLocked={isDrawingsLocked}
            isDrawingsHidden={isDrawingsHidden}
            isTimerVisible={isTimerVisible}
          />
        }
      />

      <SymbolSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelect={handleSymbolChange}
        addedSymbols={searchMode === 'compare' ? (activeChart?.comparisonSymbols || []).map((s) => s.symbol) : []}
        isCompareMode={searchMode === 'compare'}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {snapshotToast && <SnapshotToast message={snapshotToast} onClose={() => setSnapshotToast(null)} />}

      <AlertDialog
        isOpen={isAlertOpen}
        onClose={() => setIsAlertOpen(false)}
        onSave={handleSaveAlert}
        initialPrice={alertPrice}
        theme={theme}
      />
    </>
  );
}

export default App;
