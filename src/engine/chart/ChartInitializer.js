/**
 * ChartInitializer — owns chart construction, ResizeObserver, pagination,
 * context-menu handler, and magnet-crosshair tracking.
 *
 * Phase 10: Extracted from the monolithic `useEffect(() => {}, [])` block
 * in ChartComponent.jsx (~240 lines → one reusable class).
 *
 * Design rules:
 *   - No React imports.
 *   - No Zustand imports.
 *   - Receives all external refs/callbacks via the constructor options object.
 *   - Returns a cleanup function from attach() — ChartComponent calls it in
 *     its useEffect cleanup (return).
 */

import { createChart } from 'lightweight-charts';

export class ChartInitializer {
  /**
   * @param {object} opts
   * @param {HTMLElement}  opts.container            Chart DOM container.
   * @param {string}       opts.theme                'dark' | 'light'.
   * @param {boolean}      opts.magnetMode           Whether magnet snap is on.
   * @param {string}       opts.symbol               Active symbol (used by pagination).
   * @param {string}       opts.interval             Active interval (used by pagination).
   * @param {object}       opts.refs                 Bag of mutable refs from ChartComponent.
   *   refs.chartRef                  Set to the new chart instance.
   *   refs.mainSeriesRef             Read-only — needed by pagination fallback.
   *   refs.dataRef                   Read-only — current candle array.
   *   refs.priceScaleTimerRef        Updated on logical-range change.
   *   refs.magnetLastLogicalRef      Written on every crosshair move.
   *   refs.isReplayModeRef           Prevents pagination in replay mode.
   *   refs.activeToolRef             Read by context-menu handler.
   *   refs.chartDataManagerRef       Used for prependHistory in pagination.
   *   refs.timeIndexMapRef           Fallback pagination update.
   *   refs.activeFeedRef             Feed for loadHistoryBefore.
   *   refs.tradeLinesRef             Cleaned up on chart destroy.
   *   refs.chartTypeRef              Used by pagination fallback transformData.
   *   refs.runPineIndicatorsRef      Used by pagination fallback.
   * @param {Function}     opts.transformData        (data, chartType) → series data.
   * @param {Function}     opts.onToolUsed           Callback when right-click cancels tool.
   */
  constructor(opts) {
    this._opts = opts;
    this._cleanup = null;
  }

  /**
   * Create the chart, wire up all observers and subscriptions.
   * @returns {() => void}  Cleanup function — call this in useEffect return.
   */
  attach() {
    const {
      container, theme, magnetMode, symbol, interval,
      refs, transformData, onToolUsed,
    } = this._opts;

    if (!container) return () => {};

    // ── 1. Create chart ──────────────────────────────────────────────────
    const isDark = theme === 'dark';
    const lineColor = isDark ? '#758696' : '#9598a1';

    const chart = createChart(container, {
      layout: {
        textColor: isDark ? '#D1D4DC' : '#131722',
        background: { color: isDark ? '#131722' : '#ffffff' },
      },
      grid: {
        vertLines: { color: isDark ? '#2A2E39' : '#e0e3eb' },
        horzLines: { color: isDark ? '#2A2E39' : '#e0e3eb' },
      },
      crosshair: {
        mode: magnetMode ? 3 : 0,
        vertLine: { width: 1, color: lineColor, style: 3, labelBackgroundColor: lineColor },
        horzLine: { width: 1, color: lineColor, style: 3, labelBackgroundColor: lineColor },
      },
      timeScale: {
        borderColor: isDark ? '#2A2E39' : '#e0e3eb',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: isDark ? '#2A2E39' : '#e0e3eb',
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { mouseWheel: true, pinch: true },
    });

    refs.chartRef.current = chart;

    // ── 2. ResizeObserver ────────────────────────────────────────────────
    const handleResize = () => {
      if (container) {
        chart.applyOptions({
          width:  container.clientWidth,
          height: container.clientHeight,
        });
      }
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // ── 3. Visible-range → price-scale timer update ──────────────────────
    const handleVisibleTimeRangeChange = () => {
      if (!refs.mainSeriesRef.current || !refs.dataRef.current?.length) return;
      const logicalRange = chart.timeScale().getVisibleLogicalRange();
      if (!logicalRange) return;
      const lastIndex = Math.min(
        Math.round(logicalRange.to),
        refs.dataRef.current.length - 1,
      );
      if (lastIndex >= 0) {
        const candle = refs.dataRef.current[lastIndex];
        if (candle?.open !== undefined && candle?.close !== undefined) {
          refs.priceScaleTimerRef.current?.updateCandleData(candle.open, candle.close);
        }
      }
    };

    // ── 4. Pagination ────────────────────────────────────────────────────
    let isLoadingMore  = false;
    let noMoreHistory  = false;
    let dinoMarkerId   = null;
    const paginationAbortController = new AbortController();

    const loadMoreHistory = async (logicalFrom) => {
      if (isLoadingMore || noMoreHistory || refs.isReplayModeRef.current) return;
      if (!refs.dataRef.current?.length) return;
      if (logicalFrom > 50) return;

      isLoadingMore = true;
      const oldestCandle = refs.dataRef.current[0];
      const endTimeMs    = oldestCandle.time * 1000;

      try {
        const feed = refs.activeFeedRef.current;
        if (!feed || typeof feed.loadHistoryBefore !== 'function') return;

        const olderCandles = await feed.loadHistoryBefore(
          symbol, interval, endTimeMs, 500, paginationAbortController.signal,
        );

        if (!olderCandles?.length) {
          noMoreHistory = true;
          if (refs.mainSeriesRef.current && !dinoMarkerId) {
            dinoMarkerId = 'dino_marker';
            refs.mainSeriesRef.current.setMarkers([{
              time:     oldestCandle.time,
              position: 'belowBar',
              color:    '#787b86',
              shape:    'text',
              text:     '🦕 No earlier data',
              id:       dinoMarkerId,
              size:     1,
            }]);
          }
          return;
        }

        const existingTimes = new Set(refs.dataRef.current.map(c => c.time));
        const fresh = olderCandles.filter(c => !existingTimes.has(c.time));
        if (!fresh.length) { noMoreHistory = true; return; }

        if (refs.chartDataManagerRef.current) {
          refs.chartDataManagerRef.current.prependHistory(fresh);
        } else {
          // Fallback — manager not yet ready.
          const newData = [...fresh, ...refs.dataRef.current];
          refs.dataRef.current           = newData;
          refs.timeIndexMapRef.current   = new Map(newData.map((d, i) => [d.time, i]));
          refs.mainSeriesRef.current?.setData(
            transformData(newData, refs.chartTypeRef.current),
          );
          refs.runPineIndicatorsRef.current?.(newData);
        }

        if (dinoMarkerId) {
          refs.mainSeriesRef.current?.setMarkers([]);
          dinoMarkerId   = null;
          noMoreHistory  = false;
        }
      } catch (err) {
        if (err?.name !== 'AbortError') console.warn('[ChartInitializer.loadMoreHistory]', err);
      } finally {
        isLoadingMore = false;
      }
    };

    const handleVisibleWithPagination = () => {
      handleVisibleTimeRangeChange();
      const logRange = chart.timeScale().getVisibleLogicalRange();
      if (logRange) loadMoreHistory(logRange.from);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleWithPagination);

    // ── 5. Magnet-crosshair tracking ─────────────────────────────────────
    const handleCrosshairForMagnet = (param) => {
      if (param?.point?.x != null) {
        try {
          refs.magnetLastLogicalRef.current =
            chart.timeScale().coordinateToLogical(param.point.x);
        } catch { /* noop */ }
      }
    };
    chart.subscribeCrosshairMove(handleCrosshairForMagnet);

    // ── 6. Right-click context menu ──────────────────────────────────────
    const handleContextMenu = (event) => {
      event.preventDefault();
      if (refs.activeToolRef.current && refs.activeToolRef.current !== 'cursor') {
        onToolUsed?.();
      }
    };
    container.addEventListener('contextmenu', handleContextMenu, true);

    // ── Cleanup ──────────────────────────────────────────────────────────
    return () => {
      paginationAbortController.abort();

      try { chart.unsubscribeCrosshairMove(handleCrosshairForMagnet); } catch {}

      if (import.meta.env.DEV) {
        window.lineToolManager  = null;
        window.chartInstance    = null;
        window.seriesInstance   = null;
      }

      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleWithPagination);
      } catch (e) {
        console.warn('[ChartInitializer] unsubscribeVisibleLogicalRangeChange', e);
      }

      try {
        container.removeEventListener('contextmenu', handleContextMenu, true);
      } catch (e) {
        console.warn('[ChartInitializer] removeEventListener contextmenu', e);
      }

      try { resizeObserver.disconnect(); } catch {}

      refs.tradeLinesRef.current?.forEach(({ series, chart: c }) => {
        try { c.removeSeries(series); } catch {}
      });
      refs.tradeLinesRef.current?.clear();

      try { chart.remove(); } catch (e) {
        console.warn('[ChartInitializer] chart.remove()', e);
      } finally {
        refs.chartRef.current = null;
      }
    };
  }
}
