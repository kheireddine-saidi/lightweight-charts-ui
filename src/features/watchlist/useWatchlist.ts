import { useState, useEffect, useRef } from 'react';
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

  // Persist watchlist
  useEffect(() => {
    localStorage.setItem('tv_watchlist', JSON.stringify(watchlistSymbols));
  }, [watchlistSymbols]);

  // Fetch watchlist data
  useEffect(() => {
    let ws: WebSocket | null = null;
    let mounted = true;
    let initialDataLoaded = false;
    const abortController = new AbortController();

    const hydrateWatchlist = async () => {
      try {
        const promises = watchlistSymbols.map(async (sym) => {
          const data = await getTickerPrice(sym, abortController.signal);
          if (data && mounted) {
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
        if (mounted) {
          setWatchlistData(results.filter((r) => r !== null));
          initialDataLoaded = true;
        }
      } catch (error) {
        console.error('Error fetching watchlist data:', error);
        if (mounted) {
          onShowToast('Failed to load watchlist data', 'error');
          initialDataLoaded = true;
        }
      }

      if (!mounted || watchlistSymbols.length === 0) {
        if (mounted && watchlistSymbols.length === 0) {
          setWatchlistData([]);
          initialDataLoaded = true;
        }
        return;
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      ws = subscribeToMultiTicker(watchlistSymbols, (ticker: any) => {
        if (!mounted || !initialDataLoaded) return;
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

  const handleWatchlistReorder = (newSymbols: string[]) => {
    setWatchlistSymbols(newSymbols);
    setWatchlistData((prev) => {
      const dataMap = new Map(prev.map((item) => [item.symbol, item]));
      return newSymbols.map((sym) => dataMap.get(sym)).filter(Boolean);
    });
  };

  const handleRemoveFromWatchlist = (symbol: string) => {
    setWatchlistSymbols((prev) => prev.filter((s) => s !== symbol));
  };

  const handleWatchlistSymbolSelect = (
    symbol: string,
    setCharts: Function,
    activeChartId: number
  ) => {
    setCharts((prev: any[]) =>
      prev.map((chart) => (chart.id === activeChartId ? { ...chart, symbol } : chart))
    );
  };

  const handleAddClick = (
    setSearchMode: (mode: string) => void,
    setIsSearchOpen: (open: boolean) => void
  ) => {
    setSearchMode('add');
    setIsSearchOpen(true);
  };

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
