import { useState, useEffect, useRef, useCallback } from 'react';
import { getTickerPrice, subscribeToMultiTicker } from '../../services/binance';

const safeParseJSON = (value: string | null, fallback: any) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export function useWatchlist(onShowToast: (msg: string, type: string) => void) {
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>(() => {
    const saved = safeParseJSON(localStorage.getItem('tv_watchlist'), null);
    return Array.isArray(saved) && saved.length
      ? saved
      : ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'DOTUSDT'];
  });

  const [watchlistData, setWatchlistData] = useState<any[]>([]);

  // Keep the latest onShowToast without making it an effect dependency.
  // The fetch effect below only needs to key off watchlistSymbols; if a
  // caller ever passes a new onShowToast identity on every render (e.g. an
  // inline arrow function), including it in that effect's deps would
  // re-trigger the whole fetch+subscribe cycle on every render.
  const onShowToastRef = useRef(onShowToast);
  useEffect(() => {
    onShowToastRef.current = onShowToast;
  }, [onShowToast]);

  // Persist watchlist
  useEffect(() => {
    localStorage.setItem('tv_watchlist', JSON.stringify(watchlistSymbols));
  }, [watchlistSymbols]);

  // Guards against a stale, overlapping hydrateWatchlist run finishing after
  // a newer one has already started (e.g. two rapid reorder/remove actions).
  // Without this, an older run's late-arriving REST responses or its
  // websocket subscription could still win a race against the current one,
  // producing duplicate subscriptions and out-of-order writes even though
  // each individual run's own `mounted` guard looks correct in isolation.
  const hydrateGenerationRef = useRef(0);

  // Fetch watchlist data
  useEffect(() => {
    const myGeneration = ++hydrateGenerationRef.current;
    let ws: { close: () => void; readyState: number } | null = null;
    let mounted = true;
    let initialDataLoaded = false;
    const abortController = new AbortController();

    const isCurrent = () => mounted && hydrateGenerationRef.current === myGeneration;

    const hydrateWatchlist = async () => {
      try {
        const promises = watchlistSymbols.map(async (sym) => {
          const data = await getTickerPrice(sym, abortController.signal);
          if (data && isCurrent()) {
            return {
              symbol: sym,
              last: parseFloat(data.lastPrice).toFixed(2),
              chg: parseFloat(data.priceChange).toFixed(2),
              chgP: parseFloat(data.priceChangePercent).toFixed(2) + '%',
              up: parseFloat(data.priceChange) >= 0,
            };
          }
          return null;
        });

        const results = await Promise.all(promises);
        if (isCurrent()) {
          setWatchlistData(results.filter((r) => r !== null));
          initialDataLoaded = true;
        }
      } catch (error) {
        console.error('Error fetching watchlist data:', error);
        if (isCurrent()) {
          onShowToastRef.current('Failed to load watchlist data', 'error');
          initialDataLoaded = true;
        }
      }

      if (!isCurrent() || watchlistSymbols.length === 0) {
        if (isCurrent() && watchlistSymbols.length === 0) {
          setWatchlistData([]);
          initialDataLoaded = true;
        }
        return;
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      ws = subscribeToMultiTicker(watchlistSymbols, (ticker: any) => {
        if (!isCurrent() || !initialDataLoaded) return;
        setWatchlistData((prev) => {
          const index = prev.findIndex((item) => item.symbol === ticker.symbol);
          if (index !== -1) {
            const newData = [...prev];
            newData[index] = {
              ...newData[index],
              last: ticker.last.toFixed(2),
              chg: ticker.chg.toFixed(2),
              chgP: ticker.chgP.toFixed(2) + '%',
              up: ticker.chg >= 0,
            };
            return newData;
          }
          return prev;
        });
      });
    };

    hydrateWatchlist();

    return () => {
      mounted = false;
      abortController.abort();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [watchlistSymbols]);

  // These handlers are returned to consumers, who may reasonably put them
  // in their own useEffect/useMemo/useCallback dependency arrays. Without
  // useCallback here, every one of these was a brand-new function on every
  // render of this hook, so any consumer effect depending on one would
  // re-fire every render -- a very easy way to end up with the "loop"
  // DevTools traced back into this file's fetch effect.
  const handleWatchlistReorder = useCallback((newSymbols: string[]) => {
    setWatchlistSymbols(newSymbols);
    setWatchlistData((prev) => {
      const dataMap = new Map(prev.map((item) => [item.symbol, item]));
      return newSymbols.map((sym) => dataMap.get(sym)).filter(Boolean);
    });
  }, []);

  const handleRemoveFromWatchlist = useCallback((symbol: string) => {
    setWatchlistSymbols((prev) => prev.filter((s) => s !== symbol));
  }, []);

  const handleWatchlistSymbolSelect = useCallback((
    symbol: string,
    setCharts: (updater: (prev: any[]) => any[]) => void,
    activeChartId: number
  ) => {
    setCharts((prev: any[]) =>
      prev.map((chart) => (chart.id === activeChartId ? { ...chart, symbol } : chart))
    );
  }, []);

  const handleAddClick = useCallback((
    setSearchMode: (mode: string) => void,
    setIsSearchOpen: (open: boolean) => void
  ) => {
    setSearchMode('add');
    setIsSearchOpen(true);
  }, []);

  return {
    watchlistSymbols,
    setWatchlistSymbols,
    watchlistData,
    handleWatchlistReorder,
    handleRemoveFromWatchlist,
    handleWatchlistSymbolSelect,
    handleAddClick,
  };
}