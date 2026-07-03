import { useImperativeHandle } from 'react';
import {
    LineSeries,
    createSeriesMarkers,
} from 'lightweight-charts';

/**
 * useChartImperativeHandle
 *
 * Moves the useImperativeHandle body out of ChartComponent to reduce its size.
 * All refs and helpers the exposed methods need are passed in as a deps object.
 */
export function useChartImperativeHandle(ref, {
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
}) {
    useImperativeHandle(ref, () => ({
    undo: () => {
        if (lineToolManagerRef.current) lineToolManagerRef.current.undo();
    },
    redo: () => {
        if (lineToolManagerRef.current) lineToolManagerRef.current.redo();
    },
    // Scroll chart so the candle at `time` (unix seconds) is centered in viewport.
    scrollToTime: (time) => {
        if (!chartRef.current) return;
        try {
            const ts = chartRef.current.timeScale();
            // Get current visible range width to keep context around the target candle
            const vr = ts.getVisibleRange();
            const halfSpan = vr ? Math.round((vr.to - vr.from) / 2) : 50 * 60;
            ts.setVisibleRange({ from: time - halfSpan, to: time + halfSpan });
        } catch (e) {
            console.warn('[scrollToTime]', e);
        }
    },
    getLineToolManager: () => lineToolManagerRef.current,
    clearTools: () => {
        if (lineToolManagerRef.current) lineToolManagerRef.current.clearTools();
    },
    addPriceAlert: (alert) => {
        try {
            const manager = lineToolManagerRef.current;
            const userAlerts = manager && manager._userPriceAlerts;
            if (!userAlerts || !alert || alert.price == null) return;
            if (typeof userAlerts.setSymbolName === 'function') {
                userAlerts.setSymbolName(symbol);
            }
            const priceNum = Number(alert.price);
            if (!Number.isFinite(priceNum)) return;
            if (typeof userAlerts.addAlertWithCondition === 'function') {
                userAlerts.addAlertWithCondition(priceNum, 'crossing');
            } else if (typeof userAlerts.openEditDialog === 'function') {
                userAlerts.openEditDialog(alert.id, {
                    price: priceNum,
                    condition: 'crossing',
                });
            }
        } catch (err) {
            console.warn('Failed to add price alert to chart', err);
        }
    },
    removePriceAlert: (externalId) => {
        try {
            const manager = lineToolManagerRef.current;
            const userAlerts = manager && manager._userPriceAlerts;
            if (!userAlerts || !externalId) return;
            if (typeof userAlerts.removeAlert === 'function') {
                userAlerts.removeAlert(externalId);
            }
        } catch (err) {
            console.warn('Failed to remove price alert from chart', err);
        }
    },
    restartPriceAlert: (price, condition = 'crossing') => {
        try {
            const manager = lineToolManagerRef.current;
            const userAlerts = manager && manager._userPriceAlerts;
            if (!userAlerts || price == null) return;
            const priceNum = Number(price);
            if (!Number.isFinite(priceNum)) return;
            if (typeof userAlerts.addAlertWithCondition === 'function') {
                userAlerts.addAlertWithCondition(priceNum, condition === 'crossing' ? 'crossing' : condition);
            }
        } catch (err) {
            console.warn('Failed to restart price alert on chart', err);
        }
    },
    resetZoom: () => {
        applyDefaultCandlePosition(dataRef.current.length);
    },
    getChartContainer: () => chartContainerRef.current,
    getCurrentPrice: () => {
        if (dataRef.current && dataRef.current.length > 0) {
            const lastData = dataRef.current[dataRef.current.length - 1];
            return lastData.close ?? lastData.value;
        }
        return null;
    },
    getCurrentOHLC: () => {
        if (dataRef.current && dataRef.current.length > 0) {
            const lastData = dataRef.current[dataRef.current.length - 1];
            return {
                open: lastData.open,
                high: lastData.high,
                low: lastData.low,
                close: lastData.close ?? lastData.value,
                time: lastData.time,
            };
        }
        return null;
    },
    // --- NEW METHODS for trading markers ---
  getCurrentTime: () => {
    if (dataRef.current && dataRef.current.length > 0) {
      return dataRef.current[dataRef.current.length - 1].time;
    }
    return Math.floor(Date.now() / 1000);
  },

  /**
   * Add a trade marker pinned to a specific candle bar.
   * Uses createSeriesMarkers (v5 API) attached to the main series so the
   * marker is always positioned exactly at the correct bar, with an arrow
   * shape and a B/S label.
   *
   * @param {number}  time    – Unix timestamp (seconds) of the fill candle
   * @param {number}  price   – fill price (used to decide above/below bar)
   * @param {string}  text    – label shown on the marker (e.g. "B", "S", "✕ +12.50")
   * @param {string}  color   – hex colour
   * @param {'buy'|'sell'|'close'} [kind='buy'] – controls arrow direction
   */
  addMarker: (time, price, text, color, kind) => {
    if (!mainSeriesRef.current) return null;
    try {
      // Snap the requested time to the nearest bar that actually exists in the series.
      // This is required because createSeriesMarkers positions markers by matching
      // the time against the series time-scale index. If the time doesn't match an
      // existing bar exactly, lightweight-charts v5 uses NearestLeft which may end up
      // on the wrong bar. By snapping here we guarantee exact placement.
      const data = dataRef.current;
      let snappedTime = time;
      if (data && data.length > 0) {
        // Binary search for the bar whose time is closest to (and <= ) the requested time
        let lo = 0, hi = data.length - 1, bestIdx = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (data[mid].time <= time) { bestIdx = mid; lo = mid + 1; }
          else { hi = mid - 1; }
        }
        snappedTime = data[bestIdx].time;
      }

      // Lazy-create the markers primitive once per chart instance
      if (!tradeMarkersPrimitiveRef.current) {
        tradeMarkersPrimitiveRef.current = createSeriesMarkers(mainSeriesRef.current, []);
      }

      const id = 'tm_' + Date.now() + '_' + Math.random().toString(36).slice(2);

      // Determine shape & position from kind/text
      const isSell = kind === 'sell' || text === 'S';
      const isClose = kind === 'close' || (typeof text === 'string' && text.startsWith('✕'));

      let shape, position;
      if (isClose) {
        shape = 'circle';
        // Exit: close long → marker above the exit bar; close short → below
        position = isSell ? 'belowBar' : 'aboveBar';
      } else if (isSell) {
        shape = 'arrowDown';
        position = 'aboveBar';
      } else {
        shape = 'arrowUp';
        position = 'belowBar';
      }

      const entry = { id, time: snappedTime, price, text: text ?? '', color: color || '#2962FF', shape, position };
      tradeMarkerListRef.current = [...tradeMarkerListRef.current, entry];

      // Build the marker list sorted by time (required by lightweight-charts)
      const sorted = [...tradeMarkerListRef.current].sort((a, b) => a.time - b.time);
      tradeMarkersPrimitiveRef.current.setMarkers(
        sorted.map(m => ({
          time: m.time,
          position: m.position,
          shape: m.shape,
          color: m.color,
          text: m.text,
          size: 1,
        }))
      );

      return id;
    } catch (e) {
      console.warn('Failed to add marker:', e);
      return null;
    }
  },

  addHorizontalLine: (price, color, label) => {
    if (!chartRef.current) return null;
    try {
      // lightweight-charts v5: use addSeries(SeriesDefinition, options)
      const series = chartRef.current.addSeries(LineSeries, {
        color: color || '#2962FF',
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceLineVisible: false,
        lastValueVisible: true,
        title: label || '',
        crosshairMarkerVisible: false,
      });
      const data = dataRef.current;
      const startTime = data && data.length > 0 ? data[0].time : Math.floor(Date.now() / 1000) - 86400;
      // Extend far into the future so line stays visible during replay
      const endTime = startTime + 60 * 60 * 24 * 365 * 10;
      series.setData([
        { time: startTime, value: price },
        { time: endTime, value: price },
      ]);
      const id = 'tl_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      tradeLinesRef.current.set(id, { series, chart: chartRef.current });
      return id;
    } catch (e) {
      console.warn('Failed to add horizontal line:', e);
      return null;
    }
  },

  removeObject: (id, type) => {
    if (!id) return;
    if (id.startsWith('tm_') || type === 'marker') {
      // Remove from the in-memory marker list and refresh the primitive
      tradeMarkerListRef.current = tradeMarkerListRef.current.filter(m => m.id !== id);
      if (tradeMarkersPrimitiveRef.current) {
        const sorted = [...tradeMarkerListRef.current].sort((a, b) => a.time - b.time);
        try {
          tradeMarkersPrimitiveRef.current.setMarkers(
            sorted.map(m => ({
              time: m.time,
              position: m.position,
              shape: m.shape,
              color: m.color,
              text: m.text,
              size: 1,
            }))
          );
        } catch (e) { /* ignore */ }
      }
    }
    if (id.startsWith('tl_') || type === 'line') {
      const lineInfo = tradeLinesRef.current.get(id);
      if (lineInfo) {
        const { series, chart } = lineInfo;
        try { chart.removeSeries(series); } catch (e) { /* ignore */ }
        tradeLinesRef.current.delete(id);
      }
    }
    // Fallback: try both if no prefix match
    if (!id.startsWith('tm_') && !id.startsWith('tl_') && type === undefined) {
      const lineInfo = tradeLinesRef.current.get(id);
      if (lineInfo) {
        const { series, chart } = lineInfo;
        try { chart.removeSeries(series); } catch (e) { /* ignore */ }
        tradeLinesRef.current.delete(id);
      }
    }
  },
    // --- END NEW METHODS ---
    // ── Trade Setup zone management ──────────────────────────────────────
    updateTradeZone: (zoneId, fields, positionId, newStatus) => {
      setCommittedTradeZones(prev =>
        prev.map(z => {
          // Match by zone id (exact)
          if (zoneId && z.id === zoneId) return { ...z, ...(fields ?? {}) };
          // Match by linked position id — merge both extra fields and new status
          if (positionId && z.positionId === positionId) {
            return {
              ...z,
              ...(fields ?? {}),
              ...(newStatus ? { status: newStatus } : {}),
            };
          }
          return z;
        })
      );
    },
    removeTradeZone: (zoneId) => {
      setCommittedTradeZones(prev => prev.filter(z => z.id !== zoneId));
    },
    removeZoneByPositionId: (positionId) => {
      setCommittedTradeZones(prev => prev.filter(z => z.positionId !== positionId));
    },
    toggleTimer: () => {
        if (priceScaleTimerRef.current) {
            const isVisible = priceScaleTimerRef.current.isVisible();
            priceScaleTimerRef.current.setVisible(!isVisible);
            if (mainSeriesRef.current) {
                mainSeriesRef.current.applyOptions({
                    lastValueVisible: isVisible
                });
            }
            return !isVisible;
        }
        return false;
    },
    toggleReplay: () => {
        setIsReplayMode(prev => {
            const newMode = !prev;
            if (!prev) {
                // ── Entering replay ─────────────────────────────────────────
                fullDataRef.current = [...dataRef.current];
                const startIndex = Math.max(0, dataRef.current.length - 1);
                replayIndexRef.current = startIndex;

                // Phase 7: Also initialise the legacy replayFeedRef so that
                // syncToTimestamp / getReplayBars / exitFollowerReplay (which
                // access replayFeedRef directly) continue to work unchanged.
                if (!replayFeedRef.current) {
                    replayFeedRef.current = new ReplayFeed(fullDataRef.current, symbol);
                } else {
                    replayFeedRef.current.setData(fullDataRef.current, symbol);
                    replayFeedRef.current.reset();
                }

                // Phase 7: Start the ReplayController — it owns the REPLAY_TICK
                // and CANDLE subscriptions from this point on.
                const ctrl = getOrCreateReplayController();
                ctrl.enter(fullDataRef.current, startIndex);

                // Initial chart update: show data up to startIndex.
                setTimeout(() => {
                    updateReplayDataRef.current?.(startIndex, true);
                }, 0);
            } else {
                // ── Exiting replay ──────────────────────────────────────────
                // Phase 7: Delegate cleanup to ReplayController (also calls onReset
                // callback which restores full data on the chart series).
                const ctrl = replayControllerRef.current;
                if (ctrl) {
                    ctrl.exit();
                } else {
                    // Fallback: inline cleanup (legacy path, should not be reached).
                    replayStop();
                    replayIndexRef.current = null;
                    if (mainSeriesRef.current && fullDataRef.current.length > 0) {
                        dataRef.current = fullDataRef.current;
                        mainSeriesRef.current.setData(transformData(fullDataRef.current, chartTypeRef.current));
                        updateIndicators(fullDataRef.current, indicators);
                    }
                }

                setIsSelectingReplayPoint(false);
                if (fadedSeriesRef.current && chartRef.current) {
                    try { chartRef.current.removeSeries(fadedSeriesRef.current); } catch (e) { /* ignore */ }
                    fadedSeriesRef.current = null;
                }
            }
            if (onReplayModeChange) {
                setTimeout(() => onReplayModeChange(newMode), 0);
            }
            return newMode;
        });
    },
    /**
     * Sync this chart to a given master Unix timestamp (seconds).
     * Called every ~100 ms by the App replay-sync loop from the master (active) chart.
     *
     * For charts on a LOWER timeframe than the master: straightforward slice.
     * For charts on a HIGHER timeframe: we must reconstruct the currently-forming
     * HTF bar dynamically from the LTF bars that fall within it, so the candle's
     * high/low/close updates tick-by-tick exactly as it would in live trading.
     *
     * Algorithm:
     *  1. Take all HTF historical bars whose open_time < current HTF bar open_time
     *     → these are complete, display as-is.
     *  2. Identify the current HTF bar: the last historical bar whose open_time
     *     <= masterTimestamp (but may not yet be "closed" relative to the master clock).
     *  3. Aggregate all LTF bars within [htfBarOpenTime, masterTimestamp] into a
     *     single OHLC candle and append it instead of the stored historical bar.
     *     This gives a live-updating candle identical to what a live feed would produce.
     *  4. When the master clock moves past the HTF bar's close time, the next HTF bar
     *     starts and we commit the previous dynamic bar via the historical snapshot
     *     (which avoids drift from accumulated floating-point rounding).
     */
    syncToTimestamp: (masterTimestamp, ltfBarsAtMaster) => {
        if (!mainSeriesRef.current) return;

        // ── 1. Initialise follower snapshot once ──────────────────────────────
        if (!followerFullDataRef.current || followerFullDataRef.current.length === 0) {
            followerFullDataRef.current = dataRef.current ? [...dataRef.current] : [];
        }
        const full = followerFullDataRef.current; // HTF historical bars
        if (full.length === 0) return;

        // Derive this chart's timeframe in seconds from the interval prop
        const myIntervalSec = intervalToSeconds(interval);

        // ── 2. Find which HTF bar is "current" (open_time <= masterTimestamp) ─
        let lo = 0, hi = full.length - 1, htfBarIdx = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (full[mid].time <= masterTimestamp) { htfBarIdx = mid; lo = mid + 1; }
            else { hi = mid - 1; }
        }

        if (htfBarIdx < 0) {
            // Master clock is before even the first bar — show nothing
            if (transformDataRef.current) mainSeriesRef.current.setData([]);
            if (updateIndicatorsRef.current) updateIndicatorsRef.current([]);
            return;
        }

        const currentHTFBar = full[htfBarIdx];
        const htfBarCloseTime = currentHTFBar.time + myIntervalSec; // exclusive close

        // ── 3. Build the live (dynamic) current HTF candle ───────────────────
        // Use the LTF bars that the master chart has played through so far.
        // `ltfBarsAtMaster` is an array of raw OHLC candles from the master
        // (active) chart — passed in by the App sync loop.
        let liveBar = null;
        if (ltfBarsAtMaster && ltfBarsAtMaster.length > 0) {
            // Filter LTF bars that fall within the current HTF bar's open range
            const barsInHTF = ltfBarsAtMaster.filter(
                b => b.time >= currentHTFBar.time && b.time < htfBarCloseTime
            );
            if (barsInHTF.length > 0) {
                liveBar = {
                    time: currentHTFBar.time, // HTF bar opens at this time
                    open: barsInHTF[0].open,
                    high: barsInHTF.reduce((m, b) => b.high > m ? b.high : m, -Infinity),
                    low:  barsInHTF.reduce((m, b) => b.low < m ? b.low : m, Infinity),
                    close: barsInHTF[barsInHTF.length - 1].close,
                };
            }
        }

        // Fall back to the stored historical bar if we have no LTF data to build from
        if (!liveBar) {
            liveBar = { ...currentHTFBar };
        }

        // ── 4. Compose the final dataset: past HTF bars + live current bar ───
        const pastBars = full.slice(0, htfBarIdx); // completed bars before current
        const displayData = [...pastBars, liveBar];

        if (transformDataRef.current) {
            mainSeriesRef.current.setData(transformDataRef.current(displayData, chartTypeRef.current));
        }
        if (updateIndicatorsRef.current) {
            updateIndicatorsRef.current(displayData);
        }
    },
    /**
     * Exit follower replay mode and restore full data.
     */
    exitFollowerReplay: () => {
        const full = followerFullDataRef.current;
        if (mainSeriesRef.current && full && full.length > 0) {
            dataRef.current = [...full];
            if (transformDataRef.current) {
                mainSeriesRef.current.setData(transformDataRef.current(full, chartTypeRef.current));
            }
            if (updateIndicatorsRef.current) {
                updateIndicatorsRef.current(full);
            }
        }
        followerFullDataRef.current = [];
    },
    /** Expose current replay timestamp (seconds) so App can broadcast it */
    getReplayTimestamp: () => {
        if (replayIndexRef.current !== null && fullDataRef.current && fullDataRef.current.length > 0) {
            const idx = Math.min(replayIndexRef.current, fullDataRef.current.length - 1);
            return fullDataRef.current[idx]?.time ?? null;
        }
        return null;
    },
    /**
     * Return all raw OHLC bars from this chart's replay dataset up to and
     * including the current replay index. Used by follower charts to build
     * their live HTF candle dynamically.
     */
    getReplayBars: () => {
        if (replayIndexRef.current === null || !fullDataRef.current || fullDataRef.current.length === 0) {
            return [];
        }
        const idx = Math.min(replayIndexRef.current, fullDataRef.current.length - 1);
        return fullDataRef.current.slice(0, idx + 1);
    },
    getIsReplayMode: () => isReplayModeRef.current,
    }));
}
