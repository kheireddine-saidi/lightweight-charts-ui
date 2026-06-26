import { getKlines, subscribeToTicker } from '../services/binance';
export class BinanceLiveFeed {
  async loadHistory(symbol, interval, limit = 1000, signal) { return getKlines(symbol, interval, limit, signal); }
  subscribe(symbol, interval, onCandle) { const ws = subscribeToTicker(symbol.toLowerCase(), interval, onCandle); return () => ws.close(); }
}
export const binanceLiveFeed = new BinanceLiveFeed();
