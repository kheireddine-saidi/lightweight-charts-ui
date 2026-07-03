import React, { useState, useEffect, useCallback } from 'react';
import { useWorkspaceStore } from '../features/workspace/WorkspaceStore';
import { EventBus, Events } from '../core/EventBus';
import { useAlerts } from '../features/alerts/useAlerts';
import { useWatchlist } from '../features/watchlist/useWatchlist';
import { useTradeMarkers } from './useTradeMarkers';
import { useReplaySync } from '../features/replay/useReplaySync';
import { useTradingStore } from '../stores/tradingStore';
import html2canvas from 'html2canvas';

/**
 * useWorkspaceState
 *
 * Extracts all non-layout business logic from App.jsx into a single hook.
 * App.jsx becomes composition-only: it calls this hook and renders the layout.
 */
export function useWorkspaceState() {
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
  const [editingIndicator, setEditingIndicator] = useState(null); // UserIndicator | null
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
    // When a pending limit order fills → upgrade its zone from 'pending' to 'open'
    // and pass the fill time so the zone's left edge moves to the fill candle.
    const unsubFilled = EventBus.on(Events.ORDER_FILLED, ({ order, fillTime }) => {
      Object.values(chartRefs.current).forEach((ref) => {
        ref?.updateTradeZone?.(null, { status: 'open', fillTime: fillTime ?? order.filledTime }, order.id, 'open');
      });
    });
    // When an order is cancelled → remove its zone from the chart
    const unsubCancelled = EventBus.on(Events.ORDER_CANCELLED, ({ id }) => {
      Object.values(chartRefs.current).forEach((ref) => {
        ref?.removeZoneByPositionId?.(id);
      });
    });
    // When position closes → mark zone closed
    const unsubClosed = EventBus.on(Events.POSITION_CLOSED, ({ position }) => {
      Object.values(chartRefs.current).forEach((ref) => {
        ref?.updateTradeZone?.(null, null, position.id, 'closed');
      });
    });
    // Journal row click → scroll the active chart to the fill candle
    const unsubScroll = EventBus.on(Events.SCROLL_TO_TIME, ({ time }) => {
      const activeId = Object.keys(chartRefs.current)[0];
      if (activeId) chartRefs.current[activeId]?.scrollToTime?.(time);
    });
    // Invalid TP/SL modification (e.g. dragging a chart zone's TP/SL line
    // to a position that would trigger an immediate market execution) —
    // the engine already rejected the change; surface why via toast.
    const unsubTpslRejected = EventBus.on(Events.TPSL_REJECTED, ({ id, field, message }) => {
      if (message) showToast(message, 'error');
      // Revert the optimistically-drawn zone to the engine's actual current value.
      // Without this the box stays at the invalid position while the engine's real SL/TP is unchanged.
      const state = useTradingStore.getState();
      const current = state.positions.find(p => p.id === id) ?? state.pendingOrders.find(p => p.id === id);
      if (current && (field === 'sl' || field === 'tp')) {
        // Zones use slPrice/tpPrice; positions/orders use stopLoss/takeProfit
        const revertFields = field === 'sl' ? { slPrice: current.stopLoss } : { tpPrice: current.takeProfit };
        Object.values(chartRefs.current).forEach((ref) => {
          ref?.updateTradeZone?.(null, revertFields, id, undefined);
        });
      }
    });
    return () => {
      unsubDrawn(); unsubLink(); unsubFilled(); unsubCancelled();
      unsubClosed(); unsubScroll(); unsubTpslRejected();
    };
  }, []);

  const getCurrentTime = useCallback(() => {
    const ref = chartRefs.current[activeChartId];
    if (ref && typeof ref.getCurrentTime === 'function') return ref.getCurrentTime();
    return Math.floor(Date.now() / 1000);
  }, [activeChartId]);

  return {
    // workspace selectors
    layout, activeChartId, charts, favoriteIntervals, customIntervals,
    lastNonFavoriteInterval, getActiveChart,
    activeChart,
    currentSymbol, currentInterval,
    // workspace actions
    setActiveChartId, toggleActiveChartIndicator,
    // chart refs
    chartRefs,
    // local UI state
    chartType, setChartType,
    isSearchOpen, setIsSearchOpen,
    searchMode, setSearchMode,
    isAlertOpen, setIsAlertOpen,
    alertPrice, setAlertPrice,
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
    currentTimeRange, setCurrentTimeRange,
    isLogScale, setIsLogScale,
    isAutoScale, setIsAutoScale,
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
    watchlistSymbols, setWatchlistSymbols, watchlistData,
    handleWatchlistReorder, handleRemoveFromWatchlist,
    // toasts
    toast, snapshotToast,
    onCloseToast: () => setToast(null),
    onCloseSnapshotToast: () => setSnapshotToast(null),
  };
}
