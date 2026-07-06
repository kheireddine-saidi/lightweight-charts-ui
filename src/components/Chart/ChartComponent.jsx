import React, { useEffect, useRef, useState, forwardRef, useCallback } from 'react';
import {
    createChart,
    LineSeries,
} from 'lightweight-charts';
// CandlestickSeries, BarSeries, AreaSeries, BaselineSeries imported inside SeriesManager
import { createSeries, transformData, reattachTradeMarkers, reattachTimer, applySeriesColors } from '../../engine/chart/SeriesManager';
import { useChartSettingsStore } from '../../stores/chartSettingsStore';
import { IndicatorRenderer } from '../../engine/indicators/IndicatorRenderer';
import { DrawingManager, TOOL_MAP as DM_TOOL_MAP } from '../../engine/chart/DrawingManager';
import styles from './ChartComponent.module.css';
import { binanceLiveFeed as binanceLiveFeedSingleton } from '../../feeds/BinanceLiveFeed';
import { EventBus, Events } from '../../core/EventBus';
// calculateHeikinAshi moved to SeriesManager (Phase 5)
import { IndicatorRegistry, INDICATOR_CONSTRUCTORS } from '../../indicators/registry';
import { executionEngine } from '../../engine/trading/ExecutionEngine';
import { useIndicatorStore } from '../../stores/indicatorStore';
// PineTSRuntime moved to IndicatorRenderer (Phase 5)
import { intervalToSeconds } from '../../utils/timeframes';
import { useLatestRef } from '../../hooks/useLatestRef';
import { useChartImperativeHandle } from '../../hooks/useChartImperativeHandle';
import { useChartReplayBinding } from '../../hooks/useChartReplayBinding';

import { LineToolManager, PriceScaleTimer } from '../../plugins/line-tools/line-tools.js';
// IndicatorEngine moved to IndicatorRenderer (Phase 5)
import { TradeVisualizationManager } from '../../engine/chart/TradeVisualizationManager';
import '../../plugins/line-tools/line-tools.css';
import ReplayControls from '../Replay/ReplayControls';
import ReplaySlider from '../Replay/ReplaySlider';
import { useReplayEngine } from '../../engine/replay/useReplayEngine';
import { ReplayFeed } from '../../feeds/ReplayFeed';
import { ReplayController } from '../../engine/replay/ReplayController';
import { ChartDataManager } from '../../chart/ChartDataManager';
import TradeSetupTool from './TradeSetupTool';
import { PineTableOverlay } from './PineTableOverlay';

// TOOL_MAP moved to DrawingManager.js (Phase 6)
const TOOL_MAP = DM_TOOL_MAP;

const ChartComponent = forwardRef(({
    feed,          // ← new: must implement IDataFeed
    chartId = null, // ← WorkspaceStore chart.id; scopes which Pine indicators this instance renders
    symbol,
    interval,
    chartType,
    indicators,
    activeTool,
    onToolUsed,
    isLogScale,
    isAutoScale,
    timeRange,
    magnetMode,
    isToolbarVisible = true,
    theme = 'dark',
    comparisonSymbols = [],
    onAlertsSync,
    onAlertTriggered,
    onReplayModeChange,
    isDrawingsLocked = false,
    isDrawingsHidden = false,
    isTimerVisible = false,
}, ref) => {

    // Fallback to live feed if no feed prop provided (backward compat)
    const activeFeed = feed ?? binanceLiveFeedSingleton;
    const activeFeedRef = useLatestRef(activeFeed);
    // Always-current symbol/interval, readable from stable-identity callbacks
    // (e.g. runPineIndicators) without needing them in a dependency array.
    const symbolRef = useLatestRef(symbol);
    const intervalRef = useLatestRef(interval);

    // ── Magnet mode tracking refs ───────────────────────────────────────────
    // magnetModeRef: always-current copy of the magnetMode prop, readable from
    //   inside the coordinateToPrice wrapper (which is set up once and must not
    //   capture a stale closure of magnetMode).
    // magnetLastLogicalRef: continuously updated logical X index of the cursor,
    //   tracked via subscribeCrosshairMove. The bundled LineToolManager plugin's
    //   coordinateToPrice(y) call has no X parameter, so this is how the magnet
    //   wrapper knows WHICH candle's OHLC to snap against.
    const magnetModeRef = useLatestRef(magnetMode);
    const magnetLastLogicalRef = useRef(null);

    const chartContainerRef = useRef();
    const [isLoading, setIsLoading] = useState(true);
    const isActuallyLoadingRef = useRef(true); // Track if we're actually loading data (not just updating indicators) - start as true on mount
    const chartRef = useRef(null);
    const mainSeriesRef = useRef(null);
    const indicatorRegistryRef = useRef(new IndicatorRegistry());
    // IndicatorEngine facade — unifies built-in and Pine indicator execution paths (Phase 5.1)
    const indicatorEngineRef = useRef(null);
    // IndicatorRenderer — owns PineTS runtime + pineSeriesRef management (Phase 5)
    const indicatorRendererRef = useRef(null);
    // DrawingManager — owns LineToolManager + PriceScaleTimer + zoom (Phase 6)
    const drawingManagerRef = useRef(null);
    // TradeVisualizationManager — pure projection of engine state to chart drawings (Phase 5.3)
    const tradeVisualizationManagerRef = useRef(null);
    const chartReadyRef = useRef(false); // Track when chart is fully stable and ready for indicator additions
    const lineToolManagerRef = useRef(null);
    const priceScaleTimerRef = useRef(null); // Ref for the candle countdown timer
    const isTimerVisibleRef = useRef(isTimerVisible); // Always-current copy of isTimerVisible prop
    // wsRef removed — ChartDataManager owns the WebSocket subscription (Phase 4)
    const chartTypeRef = useRef(chartType);
    const dataRef = useRef([]);
    const comparisonSeriesRefs = useRef(new Map());
    const tradeLinesRef = useRef(new Map());
    const timeIndexMapRef = useRef(new Map());

    // Trade marker primitive (createSeriesMarkers) attached to main series
    const tradeMarkersPrimitiveRef = useRef(null); // the SeriesMarkers wrapper
    const tradeMarkerListRef = useRef([]);          // [{id, time, price, text, color, position, shape}]

    // Trade setup tool — committed zones (persist after order is placed)
    const [committedTradeZones, setCommittedTradeZones] = useState([]);

    // Pine table overlay — indicatorId → PineTableObject[]
    // Updated via the onTables callback from IndicatorRenderer
    const [pineTables, setPineTables] = useState({});

    // ── Replay state — driven by the singleton ReplayEngine via EventBus ──
    const {
        isPlaying,
        index: replayIndex,
        speed: replaySpeed,
        load: _replayLoad,
        play: replayPlay,
        pause: replayPause,
        stop: replayStop,
        step: replayStep,
        seek: replaySeek,
        setSpeed: replaySetSpeed,
    } = useReplayEngine();

    const [isReplayMode, setIsReplayMode] = useState(false);
    const isReplayModeRef = useLatestRef(isReplayMode); // Ref to track replay mode in callbacks

    const [isSelectingReplayPoint, setIsSelectingReplayPoint] = useState(false);
    const fullDataRef = useRef([]); // Store full data for replay
    const followerFullDataRef = useRef([]); // Immutable snapshot for follower sync — never mutated by replay
    const fadedSeriesRef = useRef(null); // Store faded series for future candles
    // Per-chart ReplayFeed — owns binary-search advanceTo logic for REPLAY_TICK events
    // NOTE: replayFeedRef is still used by toggleReplay / syncToTimestamp / exitFollowerReplay.
    //       ReplayController owns its own internal feed for TICK→CANDLE subscription path.
    const replayFeedRef = useRef(null);
    // Phase 7: ReplayController — owns event subscriptions and seek logic.
    const replayControllerRef = useRef(null);

    // ── ChartDataManager (Phase 4) ─────────────────────────────────────────
    // Owns history loading + live WebSocket subscription for this chart.
    // Callbacks bridge pure data events → chart rendering + engine side-effects.
    // Created once on mount; symbol/interval effect below calls manager.load().
    const chartDataManagerRef = useRef(null);

    useEffect(() => {
        // ── TradeVisualizationManager ──────────────────────────────────────
        const tvm = new TradeVisualizationManager({
            onZoneCreate: (positionId, zoneData) => {
                setCommittedTradeZones(prev => {
                    if (prev.some(z => z.positionId === positionId)) return prev;
                    return [...prev, { id: `tvm_${positionId}`, ...zoneData }];
                });
            },
            onZoneUpdate: (positionId, fields) => {
                setCommittedTradeZones(prev =>
                    prev.map(z =>
                        z.positionId === positionId ? { ...z, ...fields } : z
                    )
                );
            },
            onZoneRemove: (positionId) => {
                setCommittedTradeZones(prev =>
                    prev.filter(z => z.positionId !== positionId)
                );
            },
        });
        tradeVisualizationManagerRef.current = tvm;

        const mgr = new ChartDataManager({
            chartId: `chart-${symbol}-${interval}`,
            feed: activeFeed,

            // Called after history fetch AND after prependHistory (pagination).
            // mgr._isInitialLoad is true only for the first load per symbol/interval.
            onHistoryLoaded: (data) => {
                if (!mainSeriesRef.current) return;
                const isInitial = mgr._isInitialLoad !== false;
                dataRef.current = data;

                const activeType = chartTypeRef.current;
                const transformedData = transformData(data, activeType);
                mainSeriesRef.current.setData(transformedData);
                timeIndexMapRef.current = new Map(data.map((d, i) => [d.time, i]));
                chartReadyRef.current = true;

                if (runPineIndicatorsRef.current) runPineIndicatorsRef.current(data);
                if (indicatorRendererRef.current) indicatorRendererRef.current.runWithData(data, symbol, interval);

                if (isInitial) {
                    // Timer setup — only needed once per symbol/interval
                    const ivSec = intervalToSeconds(interval);
                    if (Number.isFinite(ivSec) && ivSec > 0) {
                        if (!priceScaleTimerRef.current) {
                            initializePriceScaleTimer(mainSeriesRef.current, ivSec);
                        } else {
                            priceScaleTimerRef.current.applyOptions({ timeframeSeconds: ivSec });
                        }
                    }

                    requestAnimationFrame(() => {
                        if (chartDataManagerRef.current) updateIndicators(data, indicators);
                    });

                    const preserved = mgr._preservedCandleWindow ?? DEFAULT_CANDLE_WINDOW;
                    applyDefaultCandlePosition(transformedData.length, preserved);

                    setTimeout(() => {
                        if (chartDataManagerRef.current) {
                            isActuallyLoadingRef.current = false;
                            setIsLoading(false);
                            updateAxisLabel();
                        }
                    }, 50);

                    mgr._isInitialLoad = false; // subsequent calls = pagination
                }
            },

            // Called on every live tick. isClosed=true when Binance marks the candle as final.
            onCandle: (candle, allData, isClosed) => {
                if (isReplayModeRef.current) return;
                dataRef.current = allData;

                EventBus.emit(Events.PRICE_TICK, { price: candle.close, time: candle.time, symbol });
                executionEngine.processTick(symbol, candle.close, candle.time);

                if (isClosed) {
                    EventBus.emit(Events.CANDLE, { candle, index: allData.length - 1, symbol });
                }

                if (!mainSeriesRef.current) return;
                const currentChartType = chartTypeRef.current;
                const transformedAll   = transformData(allData, currentChartType);
                const latest           = transformedAll[transformedAll.length - 1];

                const isValid = latest && (
                    latest.value !== undefined
                        ? Number.isFinite(latest.value)
                        : ['open', 'high', 'low', 'close'].every(k => Number.isFinite(latest[k]))
                );

                if (isValid) {
                    mainSeriesRef.current.update(latest);
                    updateRealtimeIndicators(candle);
                    updateAxisLabel();
                    updateOhlcFromLatest();
                    if (priceScaleTimerRef.current) {
                        priceScaleTimerRef.current.updateCandleData(candle.open, candle.close);
                    }
                }
            },

            onError: (err) => {
                console.error('[ChartDataManager]', err);
                isActuallyLoadingRef.current = false;
                setIsLoading(false);
            },
        });

        chartDataManagerRef.current = mgr;

        // ── IndicatorRenderer (Phase 5) ───────────────────────────────────
        const renderer = new IndicatorRenderer({
            indicatorRegistry: indicatorRegistryRef.current,
            chartId,
            onTables: (indicatorId, tables) => {
                // React state setter is stable — safe to capture in closure
                setPineTables(prev => ({ ...prev, [indicatorId]: tables }));
            },
        });
        renderer.setMainSeries(mainSeriesRef.current);
        indicatorRendererRef.current = renderer;

        // ── DrawingManager (Phase 6) ──────────────────────────────────────
        const dm = new DrawingManager({
            symbol:               symbol,
            getActiveTool:        () => activeToolRef.current,
            getMagnetMode:        () => magnetModeRef.current,
            getMagnetLastLogical: () => magnetLastLogicalRef.current,
            getFullData:          () => fullDataRef.current,
            onToolUsed:           onToolUsed ?? null,
            onAlertsSync:         onAlertsSync ?? null,
            onAlertTriggered:     onAlertTriggered ?? null,
        });
        drawingManagerRef.current = dm;

        return () => {
            mgr.destroy();
            chartDataManagerRef.current = null;
            tvm.destroy();
            tradeVisualizationManagerRef.current = null;
            renderer.destroy();
            indicatorRendererRef.current = null;
            dm.destroy();
            drawingManagerRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);


    // Derived refs kept in sync with hook state (needed in callbacks/closures)
    const replayIndexRef = useLatestRef(replayIndex);
    const isPlayingRef = useLatestRef(isPlaying);
    const updateReplayDataRef = useRef(null); // Ref to store updateReplayData function
    const transformDataRef = useRef(null);   // Ref to store transformData function
    const updateIndicatorsRef = useRef(null); // Ref to store updateIndicators function
    // Ref wrapper for getOrCreateReplayController — declared here (before useChartImperativeHandle)
    // to avoid the TDZ; .current is assigned right after the useCallback is defined below.
    const getOrCreateReplayControllerRef = useRef(null);

    const DEFAULT_CANDLE_WINDOW = 230;
    const DEFAULT_RIGHT_OFFSET = 10;

    const applyDefaultCandlePosition = (explicitLength, candleWindow = DEFAULT_CANDLE_WINDOW) => {
        if (!chartRef.current) return;

        const inferredLength = Number.isFinite(explicitLength)
            ? explicitLength
            : (mainSeriesRef.current?.data()?.length ?? 0);

        if (!inferredLength || inferredLength <= 0) {
            return;
        }

        const lastIndex = Math.max(inferredLength - 1, 0);
        const to = lastIndex + DEFAULT_RIGHT_OFFSET;
        const from = to - candleWindow;

        try {
            const timeScale = chartRef.current.timeScale();
            timeScale.applyOptions({ rightOffset: DEFAULT_RIGHT_OFFSET });
            timeScale.setVisibleLogicalRange({ from, to });
        } catch (err) {
            console.warn('Failed to apply default candle position', err);
        }

        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        if (lineToolManagerRef.current) {
            lineToolManagerRef.current.setDefaultRange({ from, to });
        }
    };

    // Axis Label State
    const [_axisLabel, setAxisLabel] = useState(null);

    const isChartVisibleRef = useRef(true);

    // OHLC Header Bar State
    const [ohlcData, setOhlcData] = useState(null);

    useEffect(() => {
        chartTypeRef.current = chartType;
    }, [chartType]);

    // Expose undo/redo and line tool manager to parent
    // Imperative handle methods extracted to src/hooks/useChartImperativeHandle.js
    useChartImperativeHandle(ref, {
        // Original deps
        lineToolManagerRef,
        chartRef,
        dataRef,
        chartContainerRef,
        mainSeriesRef,
        tradeMarkerListRef,
        tradeMarkersPrimitiveRef,
        tradeLinesRef,
        fullDataRef,
        isReplayModeRef,
        applyDefaultCandlePosition,
        setCommittedTradeZones,
        symbol,
        // Wiring-gap deps — timer
        priceScaleTimerRef,
        // Wiring-gap deps — replay state
        setIsReplayMode,
        replayIndexRef,
        replayFeedRef,
        // getOrCreateReplayController is declared after this call site (TDZ risk if passed directly).
        // Pass a ref wrapper instead; .current is assigned right after the useCallback below.
        getOrCreateReplayControllerRef,
        updateReplayDataRef,
        replayControllerRef,
        replayStop,
        chartTypeRef,
        // updateIndicators is declared after this call site (TDZ risk).
        // All usages inside the hook use updateIndicatorsRef.current instead.
        indicators,
        setIsSelectingReplayPoint,
        fadedSeriesRef,
        onReplayModeChange,
        // Wiring-gap deps — follower/sync
        followerFullDataRef,
        interval,
        // Wiring-gap deps — transform refs
        transformDataRef,
        updateIndicatorsRef,
    });

    // zoomChart moved to DrawingManager.zoomChart() (Phase 6)
    // ── Drawing sync effects — delegate to DrawingManager (Phase 6) ──────────

    useEffect(() => {
        drawingManagerRef.current?.syncActiveTool(activeTool, onToolUsed);
        lineToolManagerRef.current = drawingManagerRef.current?.lineToolManager ?? null;
    }, [activeTool, onToolUsed]);

    useEffect(() => {
        drawingManagerRef.current?.syncDrawingsLocked(isDrawingsLocked);
    }, [isDrawingsLocked]);

    useEffect(() => {
        drawingManagerRef.current?.syncDrawingsHidden(isDrawingsHidden);
    }, [isDrawingsHidden]);

    useEffect(() => {
        isTimerVisibleRef.current = isTimerVisible;
        drawingManagerRef.current?.syncTimerVisible(isTimerVisible, mainSeriesRef.current);
        priceScaleTimerRef.current = drawingManagerRef.current?.priceScaleTimer ?? null;
    }, [isTimerVisible]);

    // Zoom-tool DOM listener stays in ChartComponent (needs container ref + cleanup)
    useEffect(() => {
        const isZoomIn  = activeTool === 'zoom_in';
        const isZoomOut = activeTool === 'zoom_out';
        if ((!isZoomIn && !isZoomOut) || !chartContainerRef.current) return;
        const handleZoomClick = (e) => {
            if (e.button !== 0) return;
            drawingManagerRef.current?.zoomChart(chartRef.current, isZoomIn);
        };
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); onToolUsed?.(); }
        };
        const container = chartContainerRef.current;
        container.addEventListener('click', handleZoomClick);
        window.addEventListener('keydown', handleKeyDown);
        container.style.cursor = isZoomIn ? 'zoom-in' : 'zoom-out';
        return () => {
            container.removeEventListener('click', handleZoomClick);
            window.removeEventListener('keydown', handleKeyDown);
            container.style.cursor = '';
        };
    }, [activeTool, onToolUsed]);

    // Track chart visibility to avoid unnecessary RAF work
    useEffect(() => {
        if (!chartContainerRef.current) return undefined;

        const handleVisibility = (entries) => {
            if (entries && entries[0]) {
                isChartVisibleRef.current = entries[0].isIntersecting;
            }
        };

        const observer = new IntersectionObserver(handleVisibility, { threshold: 0 });
        observer.observe(chartContainerRef.current);

        const handleDocumentVisibility = () => {
            if (document.visibilityState === 'hidden') {
                isChartVisibleRef.current = false;
            }
        };

        document.addEventListener('visibilitychange', handleDocumentVisibility);

        return () => {
            observer.disconnect();
            document.removeEventListener('visibilitychange', handleDocumentVisibility);
        };
    }, []);

    // Update Axis Label Position and Content
    const updateAxisLabel = useCallback(() => {
        if (!chartRef.current || !mainSeriesRef.current || !chartContainerRef.current) return;

        const data = mainSeriesRef.current.data();
        if (!data || data.length === 0) {
            setAxisLabel(null);
            return;
        }

        const lastData = data[data.length - 1];
        const price = lastData.close ?? lastData.value;
        if (price === undefined) {
            setAxisLabel(null);
            return;
        }

        const coordinate = mainSeriesRef.current.priceToCoordinate(price);

        if (coordinate === null) {
            setAxisLabel(null);
            return;
        }

        let color = '#2962FF';
        if (lastData.open !== undefined && lastData.close !== undefined) {
            color = lastData.close >= lastData.open ? '#089981' : '#F23645';
        }

        try {
            let labelText = price.toFixed(2);

            // Handle Percentage Mode Label
            if (comparisonSymbols.length > 0) {
                const timeScale = chartRef.current.timeScale();
                const visibleRange = timeScale.getVisibleLogicalRange();

                if (visibleRange) {
                    const firstIndex = Math.max(0, Math.round(visibleRange.from));
                    if (dataRef.current && firstIndex < dataRef.current.length) {
                        const baseData = dataRef.current[firstIndex];
                        if (baseData) {
                            const baseValue = baseData.close ?? baseData.value;

                            if (baseValue && baseValue !== 0) {
                                const percentage = ((price - baseValue) / baseValue) * 100;
                                labelText = `${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%`;
                            }
                        }
                    }
                }
            }

            const newLabel = {
                top: coordinate,
                price: labelText,
                symbol: comparisonSymbols.length > 0 ? symbol : null, // Only show symbol if in comparison mode
                color: color
            };

            setAxisLabel(prev => {
                if (!prev || prev.top !== newLabel.top || prev.price !== newLabel.price || prev.symbol !== newLabel.symbol || prev.color !== newLabel.color) {
                    return newLabel;
                }
                return prev;
            });
        } catch (err) {
            console.error('Error in updateAxisLabel:', err);
        }
    }, [comparisonSymbols]);

    // Helper to update OHLC from latest candle data (for real-time updates)
    const updateOhlcFromLatest = useCallback(() => {
        if (dataRef.current && dataRef.current.length > 0) {
            const lastData = dataRef.current[dataRef.current.length - 1];
            const prevData = dataRef.current.length > 1 ? dataRef.current[dataRef.current.length - 2] : null;
            const change = prevData ? lastData.close - prevData.close : 0;
            const changePercent = prevData && prevData.close ? ((change / prevData.close) * 100) : 0;

            setOhlcData({
                open: lastData.open,
                high: lastData.high,
                low: lastData.low,
                close: lastData.close,
                change: change,
                changePercent: changePercent,
                isUp: lastData.close >= lastData.open
            });
        }
    }, []);

    // RAF Loop for smooth updates
    // RAF Loop for smooth updates - pauses when not visible to save CPU/battery
    useEffect(() => {
        let animationFrameId;
        let isRunning = true;

        const animate = () => {
            if (!isRunning) return;

            if (isChartVisibleRef.current && document.visibilityState !== 'hidden') {
                updateAxisLabel();
                animationFrameId = requestAnimationFrame(animate);
            }
            // Don't schedule next frame if not visible - will resume on visibility change
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && isChartVisibleRef.current && isRunning) {
                // Resume animation when tab becomes visible again
                animationFrameId = requestAnimationFrame(animate);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        animationFrameId = requestAnimationFrame(animate);

        return () => {
            isRunning = false;
            cancelAnimationFrame(animationFrameId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [updateAxisLabel]);



    // transformData and createSeries are imported from SeriesManager (Phase 5).
    // They are kept as local aliases so all existing call sites are unchanged.

    // Keep track of active tool for the wrapper
    const activeToolRef = useRef(activeTool);
    useEffect(() => {
        activeToolRef.current = activeTool;
    }, [activeTool]);

    // initializeLineTools delegates to DrawingManager (Phase 6)
    const initializeLineTools = (series) => {
        drawingManagerRef.current?.initializeLineTools(series, chartRef.current);
        lineToolManagerRef.current = drawingManagerRef.current?.lineToolManager ?? null;
    };

    // initializePriceScaleTimer delegates to DrawingManager (Phase 6)
    const initializePriceScaleTimer = (series, intervalSeconds) => {
        const visible = isTimerVisibleRef?.current ?? false;
        drawingManagerRef.current?.initializePriceScaleTimer(series, intervalSeconds, visible);
        priceScaleTimerRef.current = drawingManagerRef.current?.priceScaleTimer ?? null;
    };

    // Initialize chart once on mount
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                textColor: theme === 'dark' ? '#D1D4DC' : '#131722',
                background: { color: theme === 'dark' ? '#131722' : '#ffffff' },
            },
            grid: {
                vertLines: { color: theme === 'dark' ? '#2A2E39' : '#e0e3eb' },
                horzLines: { color: theme === 'dark' ? '#2A2E39' : '#e0e3eb' },
            },
            crosshair: {
                mode: magnetMode ? 3 : 0, // 3=MagnetOHLC snaps to open/high/low/close; 0=Normal
                vertLine: {
                    width: 1,
                    color: theme === 'dark' ? '#758696' : '#9598a1',
                    style: 3,
                    labelBackgroundColor: theme === 'dark' ? '#758696' : '#9598a1',
                },
                horzLine: {
                    width: 1,
                    color: theme === 'dark' ? '#758696' : '#9598a1',
                    style: 3,
                    labelBackgroundColor: theme === 'dark' ? '#758696' : '#9598a1',
                },
            },
            timeScale: {
                borderColor: theme === 'dark' ? '#2A2E39' : '#e0e3eb',
                timeVisible: true,
            },
            rightPriceScale: {
                borderColor: theme === 'dark' ? '#2A2E39' : '#e0e3eb',
            },
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
            },
            handleScale: {
                mouseWheel: true,
                pinch: true,
            },
        });

        chartRef.current = chart;



        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight,
                });
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(chartContainerRef.current);

        // Handle Visible Time Range Change (Scrolling/Panning)
        const handleVisibleTimeRangeChange = (newVisibleRange) => {
            if (!newVisibleRange || !mainSeriesRef.current || !dataRef.current || dataRef.current.length === 0) return;

            // Find the index of the last visible candle
            // We can approximate the index or search for it. Since data is sorted by time:
            // The 'to' of visible range is a Logical Range index if we use getVisibleLogicalRange, 
            // but here we get a TimeRange (from/to as Time). 
            // However, subscribeVisibleLogicalRangeChange is better for index-based access, but let's see what we have.
            // Actually, let's use the Logical Range from the chart directly as it maps better to array indices.

            const timeScale = chart.timeScale();
            const logicalRange = timeScale.getVisibleLogicalRange();

            if (logicalRange) {
                // The 'to' logical index represents the rightmost visible bar.
                const rawIndex = logicalRange.to;
                // Use Math.round to align with the visual bar boundary at x.5
                const lastIndex = Math.min(Math.round(rawIndex), dataRef.current.length - 1);

                // If we are scrolling back, 'to' might be valid.
                if (lastIndex >= 0) {
                    const candle = dataRef.current[lastIndex];
                    if (candle && priceScaleTimerRef.current) {
                        // Only update if we have valid open/close
                        if (candle.open !== undefined && candle.close !== undefined) {
                            priceScaleTimerRef.current.updateCandleData(candle.open, candle.close);
                        }
                    }
                }
            }
        };

        // ── Historical data loading on scroll ─────────────────────────────────
        // When the user scrolls left to within 50 bars of the oldest loaded candle,
        // fetch the previous page. If Binance returns 0 new bars, show a "no earlier
        // data" dinosaur marker.
        let isLoadingMore = false;
        let noMoreHistory = false;
        let dinoMarkerId = null;
        // Dedicated abort controller for pagination fetches — separate from the
        // data-loading effect's controller since this lives in the chart-init effect.
        const paginationAbortController = new AbortController();

        const loadMoreHistory = async (logicalFrom) => {
            if (isLoadingMore || noMoreHistory || isReplayModeRef.current) return;
            if (!dataRef.current?.length) return;

            // Only trigger when user is near the left edge (within 50 bars of oldest)
            if (logicalFrom > 50) return;

            isLoadingMore = true;
            const oldestCandle = dataRef.current[0];
            const endTimeMs = oldestCandle.time * 1000; // convert seconds → ms for Binance

            try {
                const feed = activeFeedRef.current;
                if (!feed || typeof feed.loadHistoryBefore !== 'function') return;

                const olderCandles = await feed.loadHistoryBefore(
                    symbol, interval, endTimeMs, 500, paginationAbortController.signal
                );

                if (!olderCandles?.length) {
                    // No more data — place dinosaur marker at the beginning
                    noMoreHistory = true;
                    if (mainSeriesRef.current && !dinoMarkerId) {
                        dinoMarkerId = 'dino_marker';
                        mainSeriesRef.current.setMarkers([{
                            time: oldestCandle.time,
                            position: 'belowBar',
                            color: '#787b86',
                            shape: 'text',
                            text: '🦕 No earlier data',
                            id: dinoMarkerId,
                            size: 1,
                        }]);
                    }
                    return;
                }

                // Prepend new candles — filter out any that overlap existing data
                const existingTimes = new Set(dataRef.current.map(c => c.time));
                const fresh = olderCandles.filter(c => !existingTimes.has(c.time));
                if (!fresh.length) { noMoreHistory = true; return; }

                // Delegate prepend to ChartDataManager — it updates its internal
                // data array, deduplicates, and fires onHistoryLoaded which updates
                // dataRef, series, timeIndexMap, and re-runs indicators.
                if (chartDataManagerRef.current) {
                    chartDataManagerRef.current.prependHistory(fresh);
                } else {
                    // Fallback (manager not yet ready)
                    const newData = [...fresh, ...dataRef.current];
                    dataRef.current = newData;
                    timeIndexMapRef.current = new Map(newData.map((d, i) => [d.time, i]));
                    mainSeriesRef.current?.setData(transformData(newData, chartTypeRef.current));
                    if (runPineIndicatorsRef.current) runPineIndicatorsRef.current(newData);
                }

                // Remove dino marker if we managed to load data
                if (dinoMarkerId) {
                    mainSeriesRef.current?.setMarkers([]);
                    dinoMarkerId = null;
                    noMoreHistory = false;
                }
            } catch (err) {
                if (err?.name !== 'AbortError') console.warn('[loadMoreHistory]', err);
            } finally {
                isLoadingMore = false;
            }
        };

        const origHandleVisible = handleVisibleTimeRangeChange;
        const handleVisibleWithPagination = () => {
            origHandleVisible?.();
            const logRange = chart.timeScale().getVisibleLogicalRange();
            if (logRange) loadMoreHistory(logRange.from);
        };

        // Subscribe to logical range changes for both price-scale label updates and pagination
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleWithPagination);

        // Track the cursor's logical X index continuously. The bundled
        // LineToolManager plugin's coordinateToPrice(y) wrapper (see
        // initializeLineTools) has no X parameter available to it, so this is
        // how it knows which candle's OHLC to snap against for magnet mode.
        const handleCrosshairForMagnet = (param) => {
            if (param?.point?.x != null) {
                try {
                    magnetLastLogicalRef.current = chart.timeScale().coordinateToLogical(param.point.x);
                } catch { /* noop */ }
            }
        };
        chart.subscribeCrosshairMove(handleCrosshairForMagnet);

        // Handle right-click to cancel tool
        const handleContextMenu = (event) => {
            event.preventDefault(); // Prevent default right-click menu
            if (activeToolRef.current && activeToolRef.current !== 'cursor') {
                if (onToolUsed) onToolUsed();
            }
        };
        const container = chartContainerRef.current;
        container.addEventListener('contextmenu', handleContextMenu, true);

        return () => {
            // Abort any in-flight pagination fetch
            paginationAbortController.abort();

            try { chart.unsubscribeCrosshairMove(handleCrosshairForMagnet); } catch { /* ignore */ }

            // Clean up global window references to prevent memory leaks
            if (import.meta.env.DEV) {
            window.lineToolManager = null;
            window.chartInstance = null;
            window.seriesInstance = null;
            }

            try {
                chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleWithPagination);
            } catch (e) {
                console.warn('Failed to unsubscribe visible logical range change', e);
            }

            try {
                container.removeEventListener('contextmenu', handleContextMenu, true);
            } catch (error) {
                console.warn('Failed to remove contextmenu listener', error);
            }
            try {
                resizeObserver.disconnect();
            } catch (error) {
                console.warn('Failed to disconnect resize observer', error);
            }
            // WebSocket is now managed by ChartDataManager (destroyed in its own effect cleanup)
            tradeLinesRef.current.forEach(({ series, chart }) => { try { chart.removeSeries(series); } catch { /* ignore */ } });
            tradeLinesRef.current.clear();
            try {
                chart.remove();
            } catch (error) {
                console.warn('Failed to remove chart instance', error);
            } finally {
                chartRef.current = null;
                // Refs managed by other effects (lineToolManagerRef, mainSeriesRef) are cleared in their own cleanup functions
            }
        };
    }, []); // Only create chart once

    // Re-create main series when chart type changes
    useEffect(() => {
        if (!chartRef.current) {
            return;
        }

        const chart = chartRef.current;

        const { bullColor, bearColor } = useChartSettingsStore.getState();
        const replacementSeries = createSeries(chart, chartType, symbol, { bullColor, bearColor });
        mainSeriesRef.current = replacementSeries;
        initializeLineTools(replacementSeries);

        // Sync new series reference into managers (Phase 5)
        if (tradeVisualizationManagerRef.current) {
            tradeVisualizationManagerRef.current.setChart(chart, replacementSeries);
        }
        if (indicatorRendererRef.current) {
            indicatorRendererRef.current.setChart(chart);
            indicatorRendererRef.current.setMainSeries(replacementSeries);
        }

        // Re-attach trade markers and timer via SeriesManager helpers (Phase 5)
        tradeMarkersPrimitiveRef.current = reattachTradeMarkers(replacementSeries, tradeMarkerListRef.current);
        reattachTimer(replacementSeries, priceScaleTimerRef.current);

        const existingData = transformData(dataRef.current, chartType);
        if (existingData.length) {
            replacementSeries.setData(existingData);
            indicatorRegistryRef.current.reattachAll(dataRef.current, chartRef.current);
            updateIndicators(dataRef.current, indicators);
            applyDefaultCandlePosition(existingData.length);
            updateAxisLabel();

            // Re-apply active tool to the new manager
            if (activeTool && activeTool !== 'cursor') {
                const mappedTool = TOOL_MAP[activeTool] || 'None';
                if (lineToolManagerRef.current && typeof lineToolManagerRef.current.startTool === 'function') {
                    lineToolManagerRef.current.startTool(mappedTool);

                }
            }
        }

        // Recreate faded series if in replay mode
        if (isReplayMode && fadedSeriesRef.current) {
            try {
                chart.removeSeries(fadedSeriesRef.current);
            } catch (e) {
                console.warn('Error removing faded series on chart type change:', e);
            }
            fadedSeriesRef.current = null;

            // Trigger replay data update to recreate faded series with new type
            if (replayIndex !== null) {
                updateReplayData(replayIndex);
            }
        }

        return () => {
            // Detach + clear via DrawingManager (Phase 6)
            drawingManagerRef.current?.detachFromSeries(mainSeriesRef.current);
            lineToolManagerRef.current = null;



            if (mainSeriesRef.current) {
                try {
                    chart.removeSeries(mainSeriesRef.current);
                } catch (e) {
                    // Ignore 'Value is undefined' which happens during strict mode cleanup
                    if (e.message !== 'Value is undefined') {
                        console.warn('Error removing series:', e);
                    }
                }
                mainSeriesRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chartType, symbol]);

    // ── Data loading effect (Phase 4) ─────────────────────────────────────
    // When symbol or interval changes: capture zoom, start loading spinner,
    // then delegate to ChartDataManager.load(). The manager fires onHistoryLoaded
    // and onCandle callbacks (defined in the mount effect above) so all rendering,
    // engine ticks, and indicator updates happen there — not here.
    useEffect(() => {
        if (!chartRef.current) return;

        // Capture current zoom level so we can restore it after the new data arrives
        let preservedCandleWindow = DEFAULT_CANDLE_WINDOW;
        try {
            const range = chartRef.current.timeScale().getVisibleLogicalRange();
            if (range) {
                const count = range.to - range.from;
                if (count > 5 && Number.isFinite(count)) preservedCandleWindow = count;
            }
        } catch (_) { /* ignore */ }

        isActuallyLoadingRef.current = true;
        chartReadyRef.current = false;
        setIsLoading(true);

        const mgr = chartDataManagerRef.current;
        if (!mgr) return;

        // Store zoom so the onHistoryLoaded callback can retrieve it
        mgr._preservedCandleWindow = preservedCandleWindow;
        // Signal that the next onHistoryLoaded call is the initial load (not pagination)
        mgr._isInitialLoad = true;
        // Keep the manager's feed reference current (may have changed e.g. live→replay)
        mgr.setFeed(activeFeedRef.current);
        mgr.load(symbol, interval, 1000);

        // No cleanup needed here — mgr.load() internally aborts the previous fetch
        // and closes the previous WebSocket before starting the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, interval]);

    const updateRealtimeIndicators = useCallback((candle) => {
        if (!chartRef.current) return;
        // Built-in O(1) path via IndicatorRegistry
        indicatorRegistryRef.current.updateIncremental(candle, chartRef.current);
        // Pine debounced path via IndicatorRenderer (Phase 5)
        if (indicatorRendererRef.current) {
            indicatorRendererRef.current.updateIncremental(candle);
        }
    }, []);

    const updateIndicators = useCallback((data, indicatorsConfig) => {
        if (!chartRef.current || !data?.length) return;
        const registry = indicatorRegistryRef.current;
        const chart = chartRef.current;

        for (const [key, enabled] of Object.entries(indicatorsConfig)) {
            if (enabled) {
                if (!registry._plugins.has(key)) {
                    const ctor = INDICATOR_CONSTRUCTORS.get ? INDICATOR_CONSTRUCTORS.get(key) : INDICATOR_CONSTRUCTORS[key];
                    if (ctor) registry.add(key, ctor, data, chart);
                }
            } else {
                registry.remove(key, chart);
            }
        }
    }, []);

    // Separate effect for indicators to prevent data reload
    useEffect(() => {
        if (dataRef.current.length > 0) {
            try {
                updateIndicators(dataRef.current, indicators);
            } catch (error) {
                console.error('Error updating indicators:', error);
            }
        }
    }, [indicators, updateIndicators]);

    // ── PineTS / IndicatorRenderer (Phase 5) ─────────────────────────────────
    // runPineIndicators delegates to IndicatorRenderer which owns:
    //   - PineTSRuntime lifecycle
    //   - pineSeriesRef (per-indicator LWC series)
    //   - IndicatorEngine sync for tick-time debounced re-runs
    const userIndicators = useIndicatorStore(s => s.indicators);

    // ── Chart display settings (from ChartSettingsModal) ──────────────────
    const chartShowGrid      = useChartSettingsStore(s => s.showGrid);
    const chartBgColor       = useChartSettingsStore(s => s.backgroundColor);
    const chartBullColor     = useChartSettingsStore(s => s.bullColor);
    const chartBearColor     = useChartSettingsStore(s => s.bearColor);
    // Apply chart settings to chart + series whenever the store changes.
    // This is the live bridge from ChartSettingsModal → LWC chart options.
    useEffect(() => {
        if (!chartRef.current) return;

        const gridColor = theme === 'dark' ? '#2A2E39' : '#e0e3eb';
        const defaultBg = theme === 'dark' ? '#131722' : '#ffffff';

        chartRef.current.applyOptions({
            layout: {
                background: { color: chartBgColor ?? defaultBg },
            },
            grid: {
                vertLines: { color: gridColor, visible: chartShowGrid },
                horzLines: { color: gridColor, visible: chartShowGrid },
            },
        });

        if (mainSeriesRef.current) {
            applySeriesColors(mainSeriesRef.current, chartTypeRef.current, {
                bullColor: chartBullColor,
                bearColor: chartBearColor,
            });
        }
    }, [chartShowGrid, chartBgColor, chartBullColor, chartBearColor, theme]);


    const runPineIndicators = useCallback(async (data) => {
        const renderer = indicatorRendererRef.current;
        if (!renderer) return;
        // Keep the renderer's chart reference current
        if (chartRef.current) renderer.setChart(chartRef.current);
        // Keep main series reference current for marker/pool attachment
        if (mainSeriesRef.current) renderer.setMainSeries(mainSeriesRef.current);
        // Keep IndicatorEngine ref in sync for external callers (e.g. onHistoryLoaded)
        if (renderer._engine) indicatorEngineRef.current = renderer._engine;
        await renderer.run(data, symbolRef.current, intervalRef.current);
    }, []);

    const runPineIndicatorsRef = useLatestRef(runPineIndicators);

    useEffect(() => {
        runPineIndicators(dataRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userIndicators, symbol, interval, runPineIndicators]);

    // Handle Magnet Mode
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.applyOptions({
                crosshair: {
                    mode: magnetMode ? 3 : 0, // 3=MagnetOHLC snaps to open/high/low/close; 0=Normal
                },
            });
        }
    }, [magnetMode]);

    // OHLC Header Bar - Subscribe to crosshair move
    useEffect(() => {
        if (!chartRef.current || !mainSeriesRef.current) return;

        const handleCrosshairMove = (param) => {
            // Show last candle data when not hovering (mouse left chart or no data at position)
            const isNotHovering = !param || !param.point || !param.seriesData || param.seriesData.size === 0;

            if (isNotHovering || !mainSeriesRef.current) {
                // Show last candle data when not hovering
                if (dataRef.current && dataRef.current.length > 0) {
                    const lastData = dataRef.current[dataRef.current.length - 1];
                    const prevData = dataRef.current.length > 1 ? dataRef.current[dataRef.current.length - 2] : null;
                    const change = prevData ? lastData.close - prevData.close : 0;
                    const changePercent = prevData && prevData.close ? ((change / prevData.close) * 100) : 0;

                    setOhlcData({
                        open: lastData.open,
                        high: lastData.high,
                        low: lastData.low,
                        close: lastData.close,
                        change: change,
                        changePercent: changePercent,
                        isUp: lastData.close >= lastData.open
                    });
                }
                return;
            }

            const data = param.seriesData.get(mainSeriesRef.current);
            if (data && data.open !== undefined) {
                // Find previous candle for change calculation
                const currentIndex = timeIndexMapRef.current.get(data.time) ?? -1;
                const prevData = currentIndex > 0 ? dataRef.current[currentIndex - 1] : null;
                const change = prevData ? data.close - prevData.close : 0;
                const changePercent = prevData && prevData.close ? ((change / prevData.close) * 100) : 0;

                setOhlcData({
                    open: data.open,
                    high: data.high,
                    low: data.low,
                    close: data.close,
                    change: change,
                    changePercent: changePercent,
                    isUp: data.close >= data.open
                });
            }
        };

        chartRef.current.subscribeCrosshairMove(handleCrosshairMove);

        // Initialize with last candle data
        if (dataRef.current && dataRef.current.length > 0) {
            const lastData = dataRef.current[dataRef.current.length - 1];
            const prevData = dataRef.current.length > 1 ? dataRef.current[dataRef.current.length - 2] : null;
            const change = prevData ? lastData.close - prevData.close : 0;
            const changePercent = prevData && prevData.close ? ((change / prevData.close) * 100) : 0;

            setOhlcData({
                open: lastData.open,
                high: lastData.high,
                low: lastData.low,
                close: lastData.close,
                change: change,
                changePercent: changePercent,
                isUp: lastData.close >= lastData.open
            });
        }

        return () => {
            if (chartRef.current) {
                try {
                    chartRef.current.unsubscribeCrosshairMove(handleCrosshairMove);
                } catch {
                    // Ignore cleanup errors
                }
            }
        };
    }, [symbol, interval]); // Re-subscribe when symbol/interval changes



    // Handle Comparison Symbols
    useEffect(() => {
        if (!chartRef.current) return;

        const abortController = new AbortController();
        let cancelled = false;

        const currentSymbols = new Set(comparisonSymbols.map(s => s.symbol));
        const activeSeries = comparisonSeriesRefs.current;

        // Remove series that are no longer in comparisonSymbols
        activeSeries.forEach((series, sym) => {
            if (!currentSymbols.has(sym)) {
                try {
                    chartRef.current.removeSeries(series);
                } catch {
                    // Ignore removal errors
                }
                activeSeries.delete(sym);
            }
        });

        // Add new series with cancellation support
        const loadComparisonData = async (comp) => {
            if (activeSeries.has(comp.symbol)) return;

            const series = chartRef.current.addSeries(LineSeries, {
                color: comp.color,
                lineWidth: 2,
                priceScaleId: 'right',
                title: comp.symbol,
            });
            activeSeries.set(comp.symbol, series);

            try {
                const data = await activeFeed.loadHistory(comp.symbol, interval, 1000, abortController.signal);
                // Check if still valid before setting data
                if (cancelled || !activeSeries.has(comp.symbol)) return;
                if (data && data.length > 0) {
                    const transformedData = data.map(d => ({ time: d.time, value: d.close }));
                    series.setData(transformedData);
                }
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error(`Failed to load comparison data for ${comp.symbol}`, err);
                }
            }
        };

        comparisonSymbols.forEach(comp => loadComparisonData(comp));

        // Update Price Scale Mode
        // 0: Normal, 1: Log, 2: Percentage
        const mode = comparisonSymbols.length > 0 ? 2 : (isLogScale ? 1 : 0);

        chartRef.current.priceScale('right').applyOptions({
            mode: mode,
            autoScale: isAutoScale,
        });

        return () => {
            cancelled = true;
            abortController.abort();
        };
    }, [comparisonSymbols, interval, isLogScale, isAutoScale]);

    // Handle Theme Changes
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.applyOptions({
                layout: {
                    textColor: theme === 'dark' ? '#D1D4DC' : '#131722',
                    background: { color: theme === 'dark' ? '#131722' : '#ffffff' },
                },
                grid: {
                    vertLines: { color: theme === 'dark' ? '#2A2E39' : '#e0e3eb' },
                    horzLines: { color: theme === 'dark' ? '#2A2E39' : '#e0e3eb' },
                },
                crosshair: {
                    vertLine: {
                        color: theme === 'dark' ? '#758696' : '#9598a1',
                        labelBackgroundColor: theme === 'dark' ? '#758696' : '#9598a1',
                    },
                    horzLine: {
                        color: theme === 'dark' ? '#758696' : '#9598a1',
                        labelBackgroundColor: theme === 'dark' ? '#758696' : '#9598a1',
                    },
                },
                timeScale: {
                    borderColor: theme === 'dark' ? '#2A2E39' : '#e0e3eb',
                },
                rightPriceScale: {
                    borderColor: theme === 'dark' ? '#2A2E39' : '#e0e3eb',
                },
            });
        }
    }, [theme]);

    // Handle Time Range
    useEffect(() => {
        if (chartRef.current && timeRange && !isLoading) {
            const now = Math.floor(Date.now() / 1000);
            let from = now;
            const to = now;

            switch (timeRange) {
                case '1D': from = now - 86400; break;
                case '5D': from = now - 86400 * 5; break;
                case '1M': from = now - 86400 * 30; break;
                case '3M': from = now - 86400 * 90; break;
                case '6M': from = now - 86400 * 180; break;
                case 'YTD': {
                    const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
                    from = startOfYear;
                    break;
                }
                case '1Y': from = now - 86400 * 365; break;
                case '5Y': from = now - 86400 * 365 * 5; break;
                case 'All':
                    applyDefaultCandlePosition();
                    return;
                default: return;
            }

            if (from && to && !isNaN(from) && !isNaN(to)) {
                try {
                    chartRef.current.timeScale().setVisibleRange({ from, to });
                } catch (e) {
                    if (e.message !== 'Value is null') {
                        console.warn('Failed to set visible range:', e);
                    }
                }
            }
        }
    }, [timeRange, isLoading]);

    // Replay Logic — playback is now driven by SimulationClock (RAF-based, not setInterval)
    // eslint-disable-next-line no-unused-vars
    const stopReplay = () => {
        replayPause();
    };

    // Define updateReplayData first since other functions depend on it
    const updateReplayData = useCallback((index, hideFeature = true, preserveView = false) => {
        if (!mainSeriesRef.current || !fullDataRef.current || !chartRef.current) return;

        // Clamp index to valid range
        const clampedIndex = Math.max(0, Math.min(index, fullDataRef.current.length - 1));

        // Store current visible range if we need to preserve it
        let currentVisibleRange = null;
        if (preserveView && chartRef.current) {
            try {
                const timeScale = chartRef.current.timeScale();
                currentVisibleRange = timeScale.getVisibleLogicalRange();
            } catch {
                // Ignore errors
            }
        }

        const pastData = fullDataRef.current.slice(0, clampedIndex + 1);

        if (hideFeature) {
            // Hide future candles - show only past data
            dataRef.current = pastData;
            const transformedData = transformData(pastData, chartTypeRef.current);
            mainSeriesRef.current.setData(transformedData);
        } else {
            // Show all candles (for preview mode)
            dataRef.current = fullDataRef.current;
            const transformedData = transformData(fullDataRef.current, chartTypeRef.current);
            mainSeriesRef.current.setData(transformedData);
        }

        // Update indicators only with past data
        updateIndicators(pastData, indicators);
        updateAxisLabel();

        // Update timer with latest candle data from replay to ensure correct color
        if (priceScaleTimerRef.current && pastData.length > 0) {
            const lastCandle = pastData[pastData.length - 1];
            if (lastCandle && lastCandle.open !== undefined && lastCandle.close !== undefined) {
                priceScaleTimerRef.current.updateCandleData(lastCandle.open, lastCandle.close);
            }
        }

        // Update ref to keep in sync
        replayIndexRef.current = clampedIndex;

        // Restore visible range if we're preserving the view
        if (preserveView && currentVisibleRange && chartRef.current) {
            try {
                setTimeout(() => {
                    const timeScale = chartRef.current.timeScale();
                    timeScale.setVisibleLogicalRange(currentVisibleRange);
                }, 0);
            } catch {
                // Ignore errors
            }
        }
    }, []);

    // Store updateReplayData in ref so it can be accessed from useImperativeHandle
    useEffect(() => {
        updateReplayDataRef.current = updateReplayData;
    }, [updateReplayData]);

    /**
     * Phase 7: Lazily create (or reconfigure) the ReplayController for this chart.
     * Called from toggleReplay when entering replay mode.
     * The controller is given a callback that calls updateReplayData so it can
     * update the chart series without holding a React state reference itself.
     */
    const getOrCreateReplayController = useCallback(() => {
        if (!replayControllerRef.current) {
            replayControllerRef.current = new ReplayController({
                symbol,
                onIndexChange: (index, hideFuture, preserveView) => {
                    replayIndexRef.current = index;
                    updateReplayDataRef.current?.(index, hideFuture, preserveView);
                },
                onReset: () => {
                    // Called by ReplayController.exit() — restore full data display.
                    replayIndexRef.current = null;
                    if (mainSeriesRef.current && fullDataRef.current.length > 0) {
                        dataRef.current = fullDataRef.current;
                        const transformed = transformData(fullDataRef.current, chartTypeRef.current);
                        mainSeriesRef.current.setData(transformed);
                        updateIndicators(fullDataRef.current, indicators);
                    }
                },
            });
        } else {
            // Update symbol in case it changed.
            replayControllerRef.current.setSymbol(symbol);
        }
        return replayControllerRef.current;
    }, [symbol, indicators]); // eslint-disable-line react-hooks/exhaustive-deps
    // Keep the ref current so useChartImperativeHandle can call it without TDZ
    getOrCreateReplayControllerRef.current = getOrCreateReplayController;

    // Store transformData and updateIndicators in refs for use in imperative methods
    useEffect(() => {
        transformDataRef.current = transformData;
    }); // no dep array — always up to date
    useEffect(() => {
        updateIndicatorsRef.current = (data, cfg) => updateIndicators(data, cfg ?? indicators);
    }); // no dep array — always up to date

    const handleReplayPlayPause = () => {
        const ctrl = replayControllerRef.current;
        if (isPlaying) {
            ctrl ? ctrl.pause() : replayPause();
        } else {
            ctrl ? ctrl.play() : replayPlay();
        }
    };

    const handleReplayForward = () => {
        const ctrl = replayControllerRef.current;
        ctrl ? ctrl.step() : replayStep();
        // Chart update is driven by the resulting CANDLE event via the controller.
    };

    const handleReplayJumpTo = () => {
        setIsSelectingReplayPoint(true);
        replayPause();

        // Show ALL candles so user can see the full timeline and select a new point
        // But preserve the current zoom level and position
        if (mainSeriesRef.current && fullDataRef.current && fullDataRef.current.length > 0) {
            // Store current visible range to preserve zoom level
            let currentVisibleRange = null;
            if (chartRef.current) {
                try {
                    const timeScale = chartRef.current.timeScale();
                    currentVisibleRange = timeScale.getVisibleRange();
                } catch {
                    // Ignore errors
                }
            }

            // Store current replay index before showing all candles
            const currentReplayIndex = replayIndexRef.current;

            // Show all candles so user can see the full timeline
            dataRef.current = fullDataRef.current;
            const transformedData = transformData(fullDataRef.current, chartTypeRef.current);
            mainSeriesRef.current.setData(transformedData);
            updateIndicators(fullDataRef.current, indicators);

            // Restore the visible range to maintain zoom level
            // Use setTimeout to ensure data update has completed
            setTimeout(() => {
                if (chartRef.current && fullDataRef.current && fullDataRef.current.length > 0) {
                    try {
                        const timeScale = chartRef.current.timeScale();

                        // If we have a current visible range, restore it to maintain zoom
                        if (currentVisibleRange && currentVisibleRange.from && currentVisibleRange.to) {
                            // Restore the exact same range to maintain zoom level
                            timeScale.setVisibleRange(currentVisibleRange);
                        } else if (currentReplayIndex !== null && currentReplayIndex >= 0) {
                            // No current range, but we have a replay index - show around it
                            const currentIndex = currentReplayIndex;
                            const currentTime = fullDataRef.current[currentIndex]?.time;

                            if (currentTime) {
                                // Use a reasonable default window that matches typical zoom
                                const DEFAULT_VIEW_WINDOW = 200; // Larger window to avoid zooming in
                                const startIndex = Math.max(0, currentIndex - DEFAULT_VIEW_WINDOW / 2);
                                const endIndex = Math.min(fullDataRef.current.length - 1, currentIndex + DEFAULT_VIEW_WINDOW / 2);

                                const startTime = fullDataRef.current[startIndex]?.time;
                                const endTime = fullDataRef.current[endIndex]?.time;

                                if (startTime && endTime) {
                                    timeScale.setVisibleRange({ from: startTime, to: endTime });
                                }
                            }
                        } else {
                            // No current range or replay index - use fitContent to show all
                            try {
                                timeScale.fitContent();
                            } catch {
                                // Ignore
                            }
                        }
                    } catch (e) {
                        console.warn('Failed to restore visible range in Jump to Bar:', e);
                    }
                }
            }, 50);
        }

        // Change cursor to indicate selection
        if (chartContainerRef.current) {
            chartContainerRef.current.style.cursor = 'crosshair';
        }
    };

    // Phase 7: handleSliderChange delegates to ReplayController.seek().
    // The controller stops playback, rewinds ExecutionEngine if needed (Phase 8),
    // resets the feed cursor, and notifies the chart via onIndexChange callback.
    // Replay binding effects and handleSliderChange extracted to
    // src/hooks/useChartReplayBinding.js
    const { handleSliderChange } = useChartReplayBinding({
        isReplayMode,
        isSelectingReplayPoint,
        isPlaying,
        isPlayingRef,
        replayIndexRef,
        replayFeedRef,
        fullDataRef,
        chartRef,
        mainSeriesRef,
        chartContainerRef,
        replayControllerRef,
        replayPause,
        replaySeek,
        updateReplayData,
        setIsSelectingReplayPoint,
        symbol,
    });

useEffect(() => {
  return () => {
    // Clean up global trade marker/line storage on unmount
    if (import.meta.env.DEV) {
      window._tradeMarkers = {};
    }
  };
}, []);

    return (
        <div className={`${styles.chartWrapper} ${isToolbarVisible ? styles.toolbarVisible : ''}`}>
            <div
                id="container"
                ref={chartContainerRef}
                className={styles.chartContainer}
                style={{
                    position: 'relative',
                    touchAction: 'none'
                }}
            />
            {isLoading && isActuallyLoadingRef.current && <div className={styles.loadingOverlay}><div className={styles.spinner}></div><div>Loading...</div></div>}

            {/* OHLC Header Bar */}
            {ohlcData && (
                <div className={styles.ohlcHeader} style={{ left: isToolbarVisible ? '55px' : '10px' }}>
                    <span className={styles.ohlcSymbol}>{symbol} · {interval.toUpperCase()}</span>
                    <span className={`${styles.ohlcDot} ${ohlcData.isUp ? '' : styles.down}`}></span>
                    <div className={styles.ohlcValues}>
                        <span className={styles.ohlcItem}>
                            <span className={styles.ohlcLabel}>O</span>
                            <span className={styles.ohlcValue}>{ohlcData.open?.toFixed(2)}</span>
                        </span>
                        <span className={styles.ohlcItem}>
                            <span className={styles.ohlcLabel}>H</span>
                            <span className={styles.ohlcValue}>{ohlcData.high?.toFixed(2)}</span>
                        </span>
                        <span className={styles.ohlcItem}>
                            <span className={styles.ohlcLabel}>L</span>
                            <span className={styles.ohlcValue}>{ohlcData.low?.toFixed(2)}</span>
                        </span>
                        <span className={styles.ohlcItem}>
                            <span className={styles.ohlcLabel}>C</span>
                            <span className={`${styles.ohlcValue} ${ohlcData.isUp ? styles.up : styles.down}`}>{ohlcData.close?.toFixed(2)}</span>
                        </span>
                        <span className={styles.ohlcChange}>
                            <span className={`${styles.ohlcChangeValue} ${ohlcData.change >= 0 ? styles.up : styles.down}`}>
                                {ohlcData.change >= 0 ? '+' : ''}{ohlcData.change?.toFixed(2)} ({ohlcData.changePercent >= 0 ? '+' : ''}{ohlcData.changePercent?.toFixed(2)}%)
                            </span>
                        </span>
                    </div>
                </div>
            )}



            {/* Replay Controls */}
            {isReplayMode && (
                <ReplayControls
                    isPlaying={isPlaying}
                    speed={replaySpeed}
                    onPlayPause={handleReplayPlayPause}
                    onForward={handleReplayForward}
                    onJumpTo={handleReplayJumpTo}
                    onSpeedChange={(s) => {
                        const ctrl = replayControllerRef.current;
                        ctrl ? ctrl.setSpeed(s) : replaySetSpeed(s);
                    }}
                    onClose={() => {
                        // Phase 7: delegate full exit to controller (handles engine rewind).
                        const ctrl = replayControllerRef.current;
                        if (ctrl) {
                            ctrl.exit();
                        } else {
                            replayStop();
                            if (mainSeriesRef.current && fullDataRef.current.length > 0) {
                                dataRef.current = fullDataRef.current;
                                mainSeriesRef.current.setData(transformData(fullDataRef.current, chartTypeRef.current));
                                updateIndicators(fullDataRef.current, indicators);
                            }
                        }
                        setIsReplayMode(false);
                        if (onReplayModeChange) onReplayModeChange(false);
                    }}
                />
            )}

            {/* Replay Slider */}
            {isReplayMode && (
                <ReplaySlider
                    chartRef={chartRef}
                    isReplayMode={isReplayMode}
                    replayIndex={replayIndex}
                    fullData={fullDataRef.current}
                    onSliderChange={handleSliderChange}
                    containerRef={chartContainerRef}
                    isSelectingReplayPoint={isSelectingReplayPoint}
                    isPlaying={isPlaying}
                />
            )}

            {/* Trade Setup Tool overlay */}
            <TradeSetupTool
                containerRef={chartContainerRef}
                chartApi={chartRef.current}
                seriesApi={mainSeriesRef.current}
                active={activeTool === 'trade_setup'}
                dataRef={dataRef}
                magnetMode={magnetMode}
                zones={committedTradeZones}
                onZonesChange={setCommittedTradeZones}
                onDone={() => {
                    // Switch back to cursor after second click
                    if (onToolUsed) onToolUsed();
                }}
                onCancel={() => {
                    if (onToolUsed) onToolUsed();
                }}
            />

            {/* Pine table.new() overlay — positioned absolutely in chart corners */}
            <PineTableOverlay tables={pineTables} />

        </div>
    );
});

export default ChartComponent;
