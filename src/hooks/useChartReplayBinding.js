import { useEffect, useCallback } from 'react';

/**
 * useChartReplayBinding
 *
 * Encapsulates the three replay-specific wiring effects that were previously
 * inline in ChartComponent:
 *   1. Safety-net subscription cleanup when isReplayMode turns off.
 *   2. Replay-click handler — click a candle to seek there.
 *   3. "Jump to Bar" click handler — used while isSelectingReplayPoint is active.
 *
 * Also owns handleSliderChange (the ReplaySlider onChange callback) since it
 * depends on the same replay-only refs.
 *
 * Returns { handleSliderChange } so ChartComponent can pass it to <ReplaySlider>.
 */
export function useChartReplayBinding({
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
}) {
    const handleSliderChange = useCallback((index, hideFuture = true) => {
        if (index >= 0 && index < fullDataRef.current.length) {
            const ctrl = replayControllerRef.current;
            if (ctrl) {
                ctrl.seek(index, hideFuture);
            } else {
                // Fallback: legacy inline path (should not normally be reached).
                if (isPlayingRef.current) replayPause();
                if (replayFeedRef.current) replayFeedRef.current.reset();
                replaySeek(index);
                updateReplayData(index, hideFuture);
            }
        }
    // fullDataRef, replayControllerRef, isPlayingRef, replayFeedRef are stable refs — excluded intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [updateReplayData, replayPause, replaySeek]);

    // Phase 7: Playback subscriptions are now owned by ReplayController.
    // This effect ensures the controller's subscriptions are active while in
    // replay mode, and released when exiting. The controller was already
    // started in toggleReplay → getOrCreateReplayController() → controller.enter(),
    // so here we just need to clean up on exit or when deps change.
    useEffect(() => {
        if (!isReplayMode) {
            // If the controller is active but replay mode was turned off externally,
            // make sure we don't leave dangling subscriptions.
            // (Normal exit path goes through toggleReplay → controller.exit() which
            //  calls _unsubscribe() directly, so this is a safety net only.)
            return;
        }
        // Controller was already started by toggleReplay; nothing to do on enter.
        // Return cleanup in case isReplayMode flips to false while the effect is live.
        return () => {
            // Subscriptions are cleaned up by the controller itself when exit() is called.
        };
    }, [isReplayMode, symbol]);

    // Click Handler for "Jump to Bar" - TradingView style
    // NOTE: There is intentionally NO general "click to seek" handler here.
    // The replay position is only changed by:
    //   1. Initial entry into replay mode (set to the last loaded bar).
    //   2. The "Jump to" scissors button (isSelectingReplayPoint path below).
    //   3. The replay slider.
    // Any other click (drawing tools, etc.) must NOT seek the replay position.
    useEffect(() => {
        if (!chartRef.current || !isSelectingReplayPoint) return;
        if (!mainSeriesRef.current) return;

        // Chart click handler - param.time gives us the exact time at the clicked position
        const handleChartClick = (param) => {
            if (!param || !isSelectingReplayPoint) return;
            if (!fullDataRef.current || fullDataRef.current.length === 0) return;

            try {
                let clickedTime = null;

                // First try to use param.time (most accurate - exact time at click position)
                if (param.time) {
                    clickedTime = param.time;
                } else if (param.point) {
                    // Fallback: use coordinate to get time
                    const timeScale = chartRef.current.timeScale();
                    const x = param.point.x;
                    clickedTime = timeScale.coordinateToTime(x);
                }

                if (!clickedTime) return;

                // Find exact time match first (most accurate)
                let clickedIndex = fullDataRef.current.findIndex(d => d.time === clickedTime);

                // If no exact match, find the closest candle by time
                if (clickedIndex === -1) {
                    let minDiff = Infinity;
                    fullDataRef.current.forEach((d, i) => {
                        const diff = Math.abs(d.time - clickedTime);
                        if (diff < minDiff) {
                            minDiff = diff;
                            clickedIndex = i;
                        }
                    });
                }

                // Clamp to valid range
                clickedIndex = Math.max(0, Math.min(clickedIndex, fullDataRef.current.length - 1));

                if (clickedIndex >= 0 && clickedIndex < fullDataRef.current.length) {
                    // Store the selected index before updating
                    const selectedIndex = clickedIndex;

                    // Get current visible range BEFORE updating data to preserve zoom level
                    let currentVisibleRange = null;
                    try {
                        const timeScale = chartRef.current.timeScale();
                        currentVisibleRange = timeScale.getVisibleRange();
                    } catch {
                        // Ignore
                    }

                    // Calculate the range width in time units to maintain zoom
                    let rangeWidth = null;
                    if (currentVisibleRange && currentVisibleRange.from && currentVisibleRange.to) {
                        rangeWidth = currentVisibleRange.to - currentVisibleRange.from;
                    }

                    // Enter or seek the ReplayController at the selected index.
                    // On initial entry toggleReplay did not start the controller
                    // (it waited for the user to pick a start time here), so we
                    // call enter() if the controller hasn't started yet, otherwise seek().
                    const ctrl = replayControllerRef.current;
                    if (ctrl && ctrl._active) {
                        // Controller already running (e.g. "Jump to" after playback started)
                        ctrl.seek(selectedIndex, true);
                    } else if (ctrl) {
                        // First selection — start the controller at the chosen bar
                        ctrl.enter(fullDataRef.current, selectedIndex);
                    } else {
                        replaySeek(selectedIndex);
                        replayIndexRef.current = selectedIndex;
                    }

                    // Calculate target visible range BEFORE updating data
                    const selectedTime = fullDataRef.current[selectedIndex]?.time;
                    let targetRange = null;

                    if (selectedTime && rangeWidth && rangeWidth > 0) {
                        // Calculate target range to maintain zoom
                        const newFrom = selectedTime - rangeWidth / 2;
                        const newTo = selectedTime + rangeWidth / 2;

                        const firstTime = fullDataRef.current[0]?.time;
                        const lastAvailableTime = fullDataRef.current[selectedIndex]?.time;

                        if (firstTime && lastAvailableTime) {
                            let adjustedFrom = Math.max(firstTime, newFrom);
                            let adjustedTo = Math.min(lastAvailableTime, newTo);

                            // Adjust boundaries while maintaining width
                            if (adjustedFrom === firstTime && adjustedTo < newTo) {
                                adjustedTo = Math.min(lastAvailableTime, adjustedFrom + rangeWidth);
                            } else if (adjustedTo === lastAvailableTime && adjustedFrom > newFrom) {
                                adjustedFrom = Math.max(firstTime, adjustedTo - rangeWidth);
                            }

                            if (adjustedTo > adjustedFrom && (adjustedTo - adjustedFrom) >= rangeWidth * 0.3) {
                                targetRange = { from: adjustedFrom, to: adjustedTo };
                            }
                        }
                    }

                    // If no target range calculated, use a default that doesn't zoom in
                    if (!targetRange && selectedTime) {
                        const VIEW_WINDOW = 300;
                        const startIndex = Math.max(0, selectedIndex - VIEW_WINDOW / 2);
                        const endIndex = selectedIndex;
                        const startTime = fullDataRef.current[startIndex]?.time;
                        const endTime = fullDataRef.current[endIndex]?.time;
                        if (startTime && endTime) {
                            targetRange = { from: startTime, to: endTime };
                        }
                    }

                    // Update chart series display (controller.seek already notified
                    // onIndexChange, but we call again with preserveView=false to
                    // let the range-restore logic below handle zoom).
                    updateReplayData(selectedIndex, true, false);

                    setIsSelectingReplayPoint(false);
                    if (chartContainerRef.current) {
                        chartContainerRef.current.style.cursor = 'default';
                    }

                    // Immediately set visible range to prevent auto-zoom
                    // Set multiple times to ensure it sticks
                    if (targetRange && chartRef.current) {
                        try {
                            const timeScale = chartRef.current.timeScale();
                            // Set immediately
                            timeScale.setVisibleRange(targetRange);

                            // Set again after a short delay to override any auto-zoom
                            setTimeout(() => {
                                if (chartRef.current) {
                                    try {
                                        chartRef.current.timeScale().setVisibleRange(targetRange);
                                    } catch {
                                        // Ignore
                                    }
                                }
                            }, 10);

                            // Set one more time after data update completes
                            setTimeout(() => {
                                if (chartRef.current) {
                                    try {
                                        chartRef.current.timeScale().setVisibleRange(targetRange);
                                    } catch {
                                        // Ignore
                                    }
                                }
                            }, 100);
                        } catch (e) {
                            console.warn('Failed to set visible range after selection:', e);
                        }
                    }
                }
            } catch (e) {
                console.warn('Error handling chart click in Jump to Bar:', e);
            }
        };

        // Subscribe to chart clicks only (series don't have subscribeClick method)
        chartRef.current.subscribeClick(handleChartClick);

        return () => {
            if (chartRef.current) {
                chartRef.current.unsubscribeClick(handleChartClick);
            }
        };
    }, [isSelectingReplayPoint, updateReplayData]);

    return { handleSliderChange };
}
