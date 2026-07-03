/**
 * useCrosshairOHLC — subscribes to crosshair move events and maintains
 * the OHLC header state.
 *
 * Phase 10: Extracted from the inline useEffect in ChartComponent.jsx
 * (~75 lines → one reusable hook).
 *
 * @param {object} opts
 * @param {React.RefObject} opts.chartRef
 * @param {React.RefObject} opts.mainSeriesRef
 * @param {React.RefObject} opts.dataRef
 * @param {React.RefObject} opts.timeIndexMapRef
 * @param {string} opts.symbol   Re-subscribes when symbol changes.
 * @param {string} opts.interval Re-subscribes when interval changes.
 * @returns {{ ohlcData: object|null }}
 */

import { useEffect, useState } from 'react';

export function useCrosshairOHLC({ chartRef, mainSeriesRef, dataRef, timeIndexMapRef, symbol, interval }) {
  const [ohlcData, setOhlcData] = useState(null);

  useEffect(() => {
    if (!chartRef.current || !mainSeriesRef.current) return;

    const buildOHLC = (candle, prevCandle) => {
      const change        = prevCandle ? candle.close - prevCandle.close : 0;
      const changePercent = prevCandle?.close ? (change / prevCandle.close) * 100 : 0;
      return {
        open: candle.open, high: candle.high, low: candle.low, close: candle.close,
        change, changePercent,
        isUp: candle.close >= candle.open,
      };
    };

    const showLastCandle = () => {
      const data = dataRef.current;
      if (!data?.length) return;
      const last = data[data.length - 1];
      const prev = data.length > 1 ? data[data.length - 2] : null;
      setOhlcData(buildOHLC(last, prev));
    };

    const handleCrosshairMove = (param) => {
      const notHovering =
        !param || !param.point || !param.seriesData || param.seriesData.size === 0;

      if (notHovering || !mainSeriesRef.current) {
        showLastCandle();
        return;
      }

      const bar = param.seriesData.get(mainSeriesRef.current);
      if (bar?.open !== undefined) {
        const idx  = timeIndexMapRef.current?.get(bar.time) ?? -1;
        const prev = idx > 0 ? dataRef.current[idx - 1] : null;
        setOhlcData(buildOHLC(bar, prev));
      }
    };

    chartRef.current.subscribeCrosshairMove(handleCrosshairMove);
    showLastCandle(); // initialise with the last candle

    return () => {
      try {
        chartRef.current?.unsubscribeCrosshairMove(handleCrosshairMove);
      } catch {}
    };
  }, [symbol, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ohlcData };
}
