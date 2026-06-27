import React, { useState, useEffect, useCallback } from 'react';import Layout from './components/Layout/Layout';
import Topbar from './components/Topbar/Topbar';
import DrawingToolbar from './components/Toolbar/DrawingToolbar';
import Watchlist from './components/Watchlist/Watchlist';
import ChartComponent from './components/Chart/ChartComponent';
import SymbolSearch from './components/SymbolSearch/SymbolSearch';
import Toast from './components/Toast/Toast';
import SnapshotToast from './components/Toast/SnapshotToast';
import html2canvas from 'html2canvas';
import { getTickerPrice, subscribeToMultiTicker } from './services/binance';

import BottomBar from './components/BottomBar/BottomBar';
import ChartGrid from './components/Chart/ChartGrid';
import AlertDialog from './components/Alert/AlertDialog';
import RightToolbar from './components/Toolbar/RightToolbar';
import AlertsPanel from './components/Alerts/AlertsPanel';
import { AppLayout } from './components/Layout/AppLayout';

import { useTradeMarkers } from './hooks/useTradeMarkers';
import { useWatchlist } from './features/watchlist/useWatchlist';
import { useAlerts } from './features/alerts/useAlerts';
import { useReplaySync } from './features/replay/useReplaySync';
import { EventBus, Events } from './core/EventBus';



const VALID_INTERVAL_UNITS = new Set(['s', 'm', 'h', 'd', 'w', 'M']);
const DEFAULT_FAVORITE_INTERVALS = []; // No default favorites

const isValidIntervalValue = (value) => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) > 0;
  }
  const match = /^([1-9]\d*)([smhdwM])$/.exec(trimmed);
  if (!match) return false;
  const unit = match[2];
  return VALID_INTERVAL_UNITS.has(unit);
};

const sanitizeFavoriteIntervals = (raw) => {
  if (!Array.isArray(raw)) return DEFAULT_FAVORITE_INTERVALS;
  const filtered = raw.filter(isValidIntervalValue);
  const unique = Array.from(new Set(filtered));
  return unique; // Allow empty array
};

const sanitizeCustomIntervals = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object' && isValidIntervalValue(item.value))
    .map((item) => ({
      value: item.value,
      label: item.label || item.value,
      isCustom: true,
    }));
};

const safeParseJSON = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error('Failed to parse JSON from localStorage:', error);
    return fallback;
  }
};

const ALERT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

const formatPrice = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toFixed(2);
};

function App() {
  // Multi-Chart State
  const [layout, setLayout] = useState(() => {
    const saved = safeParseJSON(localStorage.getItem('tv_saved_layout'), null);
    return saved && saved.layout ? saved.layout : '1';
  });
  const [activeChartId, setActiveChartId] = useState(1);
  const [charts, setCharts] = useState(() => {
    const saved = safeParseJSON(localStorage.getItem('tv_saved_layout'), null);
    return saved && Array.isArray(saved.charts) ? saved.charts : [
      { id: 1, symbol: 'BTCUSDT', interval: localStorage.getItem('tv_interval') || '1d', indicators: { sma: false, ema: false }, comparisonSymbols: [] }
    ];
  });

  // Derived state for active chart
  const activeChart = charts.find(c => c.id === activeChartId) || charts[0];
  const currentSymbol = activeChart.symbol;
  const currentInterval = activeChart.interval;

  // Refs for multiple charts
  const chartRefs = React.useRef({});

  useEffect(() => {
    localStorage.setItem('tv_interval', currentInterval);
  }, [currentInterval]);
  const [chartType, setChartType] = useState('candlestick');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState('switch'); // 'switch' or 'add'
  // const [indicators, setIndicators] = useState({ sma: false, ema: false }); // Moved to charts state
  const [toast, setToast] = useState(null);
  const [snapshotToast, setSnapshotToast] = useState(null);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertPrice, setAlertPrice] = useState(null);

  // Toast timeout refs for cleanup — must be before showToast
  const toastTimeoutRef = React.useRef(null);
  const snapshotToastTimeoutRef = React.useRef(null);

  // Show toast helper — defined here so it can be passed into hooks below
  const showToast = (message, type = 'error') => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 5000);
  };

  const showSnapshotToast = (message) => {
    if (snapshotToastTimeoutRef.current) {
      clearTimeout(snapshotToastTimeoutRef.current);
    }
    setSnapshotToast({ message });
    snapshotToastTimeoutRef.current = setTimeout(() => setSnapshotToast(null), 3000);
  };

  // Alert State (persisted with 24h retention)
  const {
    alerts,
    alertLogs,
    unreadAlertCount,
    skipNextSyncRef,
    handleSaveAlert: _handleSaveAlert,
    handleRemoveAlert: _handleRemoveAlert,
    handleRestartAlert: _handleRestartAlert,
    handlePauseAlert: _handlePauseAlert,
    handleChartAlertsSync: _handleChartAlertsSync,
    handleChartAlertTriggered: _handleChartAlertTriggered,
    markAlertsRead,
  } = useAlerts(currentSymbol, showToast);

  // Bottom Bar State
  const [currentTimeRange, setCurrentTimeRange] = useState('All');
  const [isLogScale, setIsLogScale] = useState(false);
  const [isAutoScale, setIsAutoScale] = useState(true);

  // Right Panel State
  const [activeRightPanel, setActiveRightPanel] = useState('watchlist');

  // Theme State
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('tv_theme') || 'dark';
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('tv_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Cleanup toast timeouts on unmount
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (snapshotToastTimeoutRef.current) clearTimeout(snapshotToastTimeoutRef.current);
    };
  }, []);

  // Timeframe Management
  const [favoriteIntervals, setFavoriteIntervals] = useState(() => {
    const saved = safeParseJSON(localStorage.getItem('tv_fav_intervals_v2'), null);
    return sanitizeFavoriteIntervals(saved);
  });

  const [customIntervals, setCustomIntervals] = useState(() => {
    const saved = safeParseJSON(localStorage.getItem('tv_custom_intervals'), []);
    return sanitizeCustomIntervals(saved);
  });

  // Track last selected non-favorite interval (persisted)
  const [lastNonFavoriteInterval, setLastNonFavoriteInterval] = useState(() => {
    const saved = localStorage.getItem('tv_last_nonfav_interval');
    return isValidIntervalValue(saved) ? saved : null;
  });

  useEffect(() => {
    try {
      localStorage.setItem('tv_fav_intervals_v2', JSON.stringify(favoriteIntervals));
    } catch (error) {
      console.error('Failed to persist favorite intervals:', error);
    }
  }, [favoriteIntervals]);

  useEffect(() => {
    try {
      localStorage.setItem('tv_custom_intervals', JSON.stringify(customIntervals));
    } catch (error) {
      console.error('Failed to persist custom intervals:', error);
    }
  }, [customIntervals]);

  useEffect(() => {
    if (lastNonFavoriteInterval && !isValidIntervalValue(lastNonFavoriteInterval)) {
      return;
    }
    if (lastNonFavoriteInterval) {
      try {
        localStorage.setItem('tv_last_nonfav_interval', lastNonFavoriteInterval);
      } catch (error) {
        console.error('Failed to persist last non-favorite interval:', error);
      }
    } else {
      localStorage.removeItem('tv_last_nonfav_interval');
    }
  }, [lastNonFavoriteInterval]);

  // Handle interval change - track non-favorite selections
  // Handle interval change - track non-favorite selections
  const handleIntervalChange = (newInterval) => {
    setCharts(prev => prev.map(chart =>
      chart.id === activeChartId ? { ...chart, interval: newInterval } : chart
    ));

    // If the new interval is not a favorite, save it as the last non-favorite
    if (!favoriteIntervals.includes(newInterval)) {
      setLastNonFavoriteInterval(newInterval);
    }
  };

  const handleToggleFavorite = (interval) => {
    if (!isValidIntervalValue(interval)) {
      showToast('Invalid interval provided', 'error');
      return;
    }
    setFavoriteIntervals(prev =>
      prev.includes(interval) ? prev.filter(i => i !== interval) : [...prev, interval]
    );
  };

  const handleAddCustomInterval = (value, unit) => {
    const numericValue = parseInt(value, 10);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      showToast('Enter a valid number greater than 0', 'error');
      return;
    }
    const unitNormalized = VALID_INTERVAL_UNITS.has(unit) ? unit : null;
    if (!unitNormalized) {
      showToast('Invalid interval unit', 'error');
      return;
    }
    const newValue = `${numericValue}${unitNormalized}`;

    if (!isValidIntervalValue(newValue)) {
      showToast('Invalid interval format', 'error');
      return;
    }

    // Check if already exists in default or custom
    if (DEFAULT_FAVORITE_INTERVALS.includes(newValue) || customIntervals.some(i => i.value === newValue)) {
      showToast('Interval already available!', 'info');
      return;
    }

    const newInterval = { value: newValue, label: newValue, isCustom: true };
    setCustomIntervals(prev => [...prev, newInterval]);
    showToast('Custom interval added successfully!', 'success');
  };

  const handleRemoveCustomInterval = (intervalValue) => {
    setCustomIntervals(prev => prev.filter(i => i.value !== intervalValue));
    // Also remove from favorites if present
    setFavoriteIntervals(prev => prev.filter(i => i !== intervalValue));
    // If current interval is removed, switch to default
    if (currentInterval === intervalValue) {
      handleIntervalChange('1d');
    }
  };

  // Load watchlist from localStorage or default
  const {
    watchlistSymbols,
    setWatchlistSymbols,
    watchlistData,
    handleWatchlistReorder,
    handleRemoveFromWatchlist,
  } = useWatchlist(showToast);


  const handleSymbolChange = (symbol) => {
    if (searchMode === 'switch') {
      setCharts(prev => prev.map(chart =>
        chart.id === activeChartId ? { ...chart, symbol: symbol } : chart
      ));
    } else if (searchMode === 'compare') {
      const colors = ['#f57f17', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5'];
      setCharts(prev => prev.map(chart => {
        if (chart.id === activeChartId) {
          const currentComparisons = chart.comparisonSymbols || [];
          const exists = currentComparisons.find(c => c.symbol === symbol);

          if (exists) {
            // Remove
            return {
              ...chart,
              comparisonSymbols: currentComparisons.filter(c => c.symbol !== symbol)
            };
          } else {
            // Add
            const nextColor = colors[currentComparisons.length % colors.length];
            return {
              ...chart,
              comparisonSymbols: [
                ...currentComparisons,
                { symbol: symbol, color: nextColor }
              ]
            };
          }
        }
        return chart;
      }));
      // Do not close search in compare mode to allow multiple selections
    } else {
      if (!watchlistSymbols.includes(symbol)) {
        setWatchlistSymbols(prev => [...prev, symbol]);
        showToast(`${symbol} added to watchlist`, 'success');
      }
      setIsSearchOpen(false);
    }
  };

  const handleWatchlistSymbolSelect = (symbol) => {
    setCharts(prev => prev.map(chart =>
      chart.id === activeChartId ? { ...chart, symbol } : chart
    ));
  };

  const handleAddClick = () => {
    setSearchMode('add');
    setIsSearchOpen(true);
  };

  const handleSymbolClick = () => {
    setSearchMode('switch');
    setIsSearchOpen(true);
  };

  const handleCompareClick = () => {
    setSearchMode('compare');
    setIsSearchOpen(true);
  };

  const toggleIndicator = (name) => {
    setCharts(prev => prev.map(chart =>
      chart.id === activeChartId ? { ...chart, indicators: { ...chart.indicators, [name]: !chart.indicators[name] } } : chart
    ));
  };

  const [activeTool, setActiveTool] = useState(null);
  const [isMagnetMode, setIsMagnetMode] = useState(false);
  const [showDrawingToolbar, setShowDrawingToolbar] = useState(true);
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isDrawingsLocked, setIsDrawingsLocked] = useState(false);
  const [isDrawingsHidden, setIsDrawingsHidden] = useState(false);
  const [isTimerVisible, setIsTimerVisible] = useState(false);

  const toggleDrawingToolbar = () => {
    setShowDrawingToolbar(prev => !prev);
  };

  const handleToolChange = (tool) => {
    if (tool === 'magnet') {
      setIsMagnetMode(prev => !prev);
    } else if (tool === 'undo') {
      const activeRef = chartRefs.current[activeChartId];
      if (activeRef) {
        activeRef.undo();
      }
      setActiveTool(null); // Reset active tool after undo
    } else if (tool === 'redo') {
      const activeRef = chartRefs.current[activeChartId];
      if (activeRef) {
        activeRef.redo();
      }
      setActiveTool(null); // Reset active tool after redo
    } else if (tool === 'clear') { // Renamed from 'remove' to 'clear' based on new logic
      const activeRef = chartRefs.current[activeChartId];
      if (activeRef) {
        activeRef.clearTools();
      }
      setActiveTool(null); // Reset active tool after clear
    } else if (tool === 'clear_all') { // Clear All Drawings button
      const activeRef = chartRefs.current[activeChartId];
      if (activeRef) {
        activeRef.clearTools();
      }
      setIsDrawingsHidden(false); // Reset hidden state when all cleared
      setIsDrawingsLocked(false); // Reset locked state when all cleared
      setActiveTool(null); // Reset active tool after clearing all
    } else if (tool === 'lock_all') { // Lock All Drawings toggle
      setIsDrawingsLocked(prev => !prev);
      setActiveTool(tool); // Pass to ChartComponent to call toggleDrawingsLock
    } else if (tool === 'hide_drawings') { // Hide All Drawings toggle
      setIsDrawingsHidden(prev => !prev);
      setActiveTool(tool); // Pass to ChartComponent to call toggleDrawingsVisibility
    } else if (tool === 'show_timer') { // Show Timer toggle
      setIsTimerVisible(prev => !prev);
      setActiveTool(tool); // Pass to ChartComponent to toggle timer visibility
    } else {
      setActiveTool(tool);
    }
  };

  const handleToolUsed = React.useCallback(() => {
    setActiveTool(null);
  }, []);

  // const chartComponentRef = React.useRef(null); // Removed in favor of chartRefs

  const handleLayoutChange = (newLayout) => {
    setLayout(newLayout);
    const count = parseInt(newLayout);
    setCharts(prev => {
      const newCharts = [...prev];
      if (newCharts.length < count) {
        // Add charts
        for (let i = newCharts.length; i < count; i++) {
          newCharts.push({
            id: i + 1,
            symbol: activeChart.symbol,
            interval: activeChart.interval,
            indicators: { sma: false, ema: false },
            comparisonSymbols: []
          });
        }
      } else if (newCharts.length > count) {
        // Remove charts
        newCharts.splice(count);
      }
      return newCharts;
    });
    // Ensure active chart is valid
    if (activeChartId > count) {
      setActiveChartId(1);
    }
  };

  const handleSaveLayout = () => {
    const layoutData = {
      layout,
      charts
    };
    try {
      localStorage.setItem('tv_saved_layout', JSON.stringify(layoutData));
      showSnapshotToast('Layout saved successfully');
    } catch (error) {
      console.error('Failed to save layout:', error);
      showToast('Failed to save layout', 'error');
    }
  };

  // handleUndo and handleRedo are now integrated into handleToolChange, but we need wrappers for Topbar
  const handleUndo = () => handleToolChange('undo');
  const handleRedo = () => handleToolChange('redo');

  const handleDownloadImage = async () => {
    const activeRef = chartRefs.current[activeChartId];
    if (activeRef) {
      const chartContainer = activeRef.getChartContainer();
      if (chartContainer) {
        try {
          const canvas = await html2canvas(chartContainer, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#131722', // Match chart background
          });

          const image = canvas.toDataURL('image/png');
          const link = document.createElement('a');

          // Format filename: SYMBOL_YYYY-MM-DD_HH-MM-SS
          const now = new Date();
          const dateStr = now.toISOString().split('T')[0];
          const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
          const filename = `${currentSymbol}_${dateStr}_${timeStr}.png`;

          link.href = image;
          link.download = filename;
          link.click();
        } catch (error) {
          console.error('Screenshot failed:', error);
          showToast('Failed to download image', 'error');
        }
      }
    }
  };

  const handleCopyImage = async () => {
    const activeRef = chartRefs.current[activeChartId];
    if (activeRef) {
      const chartContainer = activeRef.getChartContainer();
      if (chartContainer) {
        try {
          const canvas = await html2canvas(chartContainer, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#131722', // Match chart background
          });

          canvas.toBlob(async (blob) => {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({
                  'image/png': blob
                })
              ]);
              showSnapshotToast('Link to the chart image copied to clipboard');
            } catch (err) {
              console.error('Failed to copy to clipboard:', err);
              showToast('Failed to copy to clipboard', 'error');
            }
          });
        } catch (error) {
          console.error('Screenshot failed:', error);
          showToast('Failed to capture image', 'error');
        }
      }
    }
  };

  const handleFullScreen = () => {
    const activeRef = chartRefs.current[activeChartId];
    if (activeRef) {
      const chartContainer = activeRef.getChartContainer();
      if (chartContainer) {
        if (chartContainer.requestFullscreen) {
          chartContainer.requestFullscreen();
        } else if (chartContainer.webkitRequestFullscreen) { /* Safari */
          chartContainer.webkitRequestFullscreen();
        } else if (chartContainer.msRequestFullscreen) { /* IE11 */
          chartContainer.msRequestFullscreen();
        }
      }
    }
  };


  const handleReplayClick = () => {
    const activeRef = chartRefs.current[activeChartId];
    if (activeRef) {
      activeRef.toggleReplay();
    }
  };

  const handleReplayModeChange = (chartId, isActive) => {
    // Only track active chart's replay mode for the topbar toggle
    if (chartId === activeChartId) {
      setIsReplayMode(isActive);
    }
  };

  const handleAlertClick = () => {
    const activeRef = chartRefs.current[activeChartId];
    if (activeRef) {
      const price = activeRef.getCurrentPrice();
      if (price !== null) {
        setAlertPrice(price);
        setIsAlertOpen(true);
      } else {
        showToast('No price data available', 'error');
      }
    }
  };

  // Wrappers that bind chartRefs/activeChartId into the hook functions
  const handleSaveAlert = (alertData) => _handleSaveAlert(alertData, chartRefs, activeChartId);
  const handleRemoveAlert = (id) => _handleRemoveAlert(id, chartRefs);
  const handleRestartAlert = (id) => _handleRestartAlert(id, alerts, chartRefs);
  const handlePauseAlert = (id) => _handlePauseAlert(id, alerts, chartRefs);
  const handleChartAlertsSync = (chartId, symbol, chartAlerts) =>
    _handleChartAlertsSync(chartId, symbol, chartAlerts, alerts);
  const handleChartAlertTriggered = (chartId, symbol, evt) =>
    _handleChartAlertTriggered(chartId, symbol, evt);

  const handleRightPanelToggle = (panel) => {
    setActiveRightPanel(panel);
    if (panel === 'alerts') {
      markAlertsRead();
    }
  };


useTradeMarkers(chartRefs, activeChartId, charts);

// Replay synchronisation via extracted hook
useReplaySync(isReplayMode, activeChartId, chartRefs);

// Listen to EventBus for trade setup events (Phase 5)
React.useEffect(() => {
  const unsubDrawn = EventBus.on(Events.TRADE_SETUP_DRAWN, () => {
    setActiveRightPanel('trading');
  });
  const unsubLink = EventBus.on(Events.TRADE_ZONE_LINKED, ({ zoneId, positionId, status }) => {
    Object.values(chartRefs.current).forEach(ref => {
      ref?.updateTradeZone?.(zoneId, { positionId, status });
    });
  });
  return () => { unsubDrawn(); unsubLink(); };
}, []);

const getCurrentTime = useCallback(() => {
  const ref = chartRefs.current[activeChartId];
  if (ref && typeof ref.getCurrentTime === 'function') {
    return ref.getCurrentTime();
  }
  return Math.floor(Date.now() / 1000); // fallback
}, [activeChartId, chartRefs]);


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
            indicators={activeChart.indicators}
            favoriteIntervals={favoriteIntervals}
            customIntervals={customIntervals}
            lastNonFavoriteInterval={lastNonFavoriteInterval}
            onSymbolClick={handleSymbolClick}
            onIntervalChange={handleIntervalChange}
            onChartTypeChange={setChartType}
            onToggleIndicator={toggleIndicator}
            onToggleFavorite={handleToggleFavorite}
            onAddCustomInterval={handleAddCustomInterval}
            onRemoveCustomInterval={handleRemoveCustomInterval}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onMenuClick={toggleDrawingToolbar}
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

      {/* Keep the rest of the UI (SymbolSearch, Toasts, AlertDialog) unchanged */}
      <SymbolSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelect={handleSymbolChange}
        addedSymbols={searchMode === 'compare' ? (activeChart.comparisonSymbols || []).map(s => s.symbol) : []}
        isCompareMode={searchMode === 'compare'}
      />
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      {snapshotToast && (
        <SnapshotToast
          message={snapshotToast}
          onClose={() => setSnapshotToast(null)}
        />
      )}
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
