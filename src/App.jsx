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
import React from 'react';
import Layout from './components/Layout/Layout';
import Topbar from './components/Topbar/Topbar';
import DrawingToolbar from './components/Toolbar/DrawingToolbar';
import ChartGrid from './components/Chart/ChartGrid';
import SymbolSearch from './components/SymbolSearch/SymbolSearch';
import Toast from './components/Toast/Toast';
import SnapshotToast from './components/Toast/SnapshotToast';
import AlertDialog from './components/Alert/AlertDialog';
import { AppLayout } from './components/Layout/AppLayout';

// ── Workspace state — extracted from App ────────────────────────────────────
import { useWorkspaceState } from './hooks/useWorkspaceState';

function App() {
  const {
    // workspace selectors
    layout, activeChartId, charts, favoriteIntervals, customIntervals,
    lastNonFavoriteInterval, activeChart,
    currentSymbol, currentInterval,
    setActiveChartId, toggleActiveChartIndicator,
    // chart refs
    chartRefs,
    // UI state
    chartType, setChartType,
    isSearchOpen, setIsSearchOpen,
    searchMode, setSearchMode,
    isAlertOpen, setIsAlertOpen,
    alertPrice,
    activeRightPanel,
    theme,
    activeTool,
    isMagnetMode,
    editingIndicator, setEditingIndicator,
    showDrawingToolbar,
    setShowDrawingToolbar,
    isReplayMode,
    isDrawingsLocked,
    isDrawingsHidden,
    isTimerVisible,
    currentTimeRange,
    isLogScale,
    isAutoScale,
    // handlers
    handleSymbolChange,
    handleWatchlistSymbolSelect,
    handleSymbolClick,
    handleCompareClick,
    handleIntervalChange,
    handleToggleFavorite,
    handleAddCustomInterval,
    handleRemoveCustomInterval,
    handleLayoutChange,
    handleSaveLayout,
    handleToolChange,
    handleToolUsed,
    handleUndo,
    handleRedo,
    handleDownloadImage,
    handleCopyImage,
    handleFullScreen,
    handleReplayClick,
    handleReplayModeChange,
    handleAlertClick,
    handleSaveAlert,
    handleRemoveAlert,
    handleRestartAlert,
    handlePauseAlert,
    handleChartAlertsSync,
    handleChartAlertTriggered,
    handleRightPanelToggle,
    getCurrentTime,
    toggleTheme,
    // alerts / watchlist
    alerts, alertLogs, unreadAlertCount,
    watchlistData,
    handleWatchlistReorder, handleRemoveFromWatchlist,
    // toasts
    toast, snapshotToast,
    onCloseToast, onCloseSnapshotToast,
  } = useWorkspaceState();

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
            onMenuClick={() => setShowDrawingToolbar(prev => !prev)}
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
            onEditIndicatorSource={setEditingIndicator}
          />
        }
        editingIndicator={editingIndicator}
        onCloseSourceEditor={() => setEditingIndicator(null)}
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

      {toast && <Toast message={toast.message} type={toast.type} onClose={onCloseToast} />}
      {snapshotToast && <SnapshotToast message={snapshotToast} onClose={onCloseSnapshotToast} />}

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
