/**
 * FeedManager — manages per-chart feed subscriptions with full isolation.
 *
 * Fixes the critical bug where subscribing one chart would unsubscribe others.
 *
 * Each chart registers with a unique subscriptionId. Multiple charts can
 * subscribe to the same symbol+timeframe — the manager multiplexes one
 * underlying WebSocket stream and fans out to all registered callbacks.
 *
 * Architecture:
 *   FeedManager
 *     ├── subscriptions: Map<id, { symbol, timeframe, callback }>
 *     └── streams: Map<streamKey, { unsub, callbacks: Set<id> }>
 *
 * Usage:
 *   const unsub = feedManager.subscribe({
 *     id: 'chart-1',
 *     symbol: 'BTCUSDT',
 *     timeframe: '1m',
 *     callback: (candle) => { ... }
 *   });
 *   unsub(); // removes only chart-1, leaves chart-2 alive
 */

import { subscribeToTicker } from '../services/binance';

class FeedManagerClass {
  constructor() {
    /**
     * Per-subscription registry.
     * @type {Map<string, { symbol: string, timeframe: string, callback: Function }>}
     */
    this._subscriptions = new Map();

    /**
     * Per-stream registry (shared WebSocket connections).
     * @type {Map<string, { unsub: Function, subscriberIds: Set<string> }>}
     */
    this._streams = new Map();
  }

  /**
   * Subscribe a chart (or any consumer) to a symbol+timeframe stream.
   *
   * @param {{ id: string, symbol: string, timeframe: string, callback: Function }} opts
   * @returns {() => void} unsubscribe function — removes ONLY this subscription
   */
  subscribe({ id, symbol, timeframe, callback }) {
    if (!id || !symbol || !timeframe || typeof callback !== 'function') {
      console.error('[FeedManager] subscribe() requires { id, symbol, timeframe, callback }');
      return () => {};
    }

    // Remove any previous subscription with the same id (e.g. symbol change)
    this._removeSubscription(id);

    // Register the subscription
    this._subscriptions.set(id, { symbol, timeframe, callback });

    // Find or create the underlying stream
    const streamKey = `${symbol.toUpperCase()}:${timeframe}`;
    if (!this._streams.has(streamKey)) {
      const subscriberIds = new Set([id]);
      const ws = subscribeToTicker(symbol.toLowerCase(), timeframe, (candle) => {
        this._dispatch(streamKey, candle);
      });
      this._streams.set(streamKey, {
        unsub: () => ws.close(),
        subscriberIds,
      });
    } else {
      this._streams.get(streamKey).subscriberIds.add(id);
    }

    return () => this._removeSubscription(id);
  }

  /**
   * Explicitly unsubscribe by id.
   * @param {string} id
   */
  unsubscribe(id) {
    this._removeSubscription(id);
  }

  /**
   * Unsubscribe all and close all streams.
   */
  destroy() {
    this._subscriptions.clear();
    for (const { unsub } of this._streams.values()) {
      try { unsub(); } catch (_) { /* ignore */ }
    }
    this._streams.clear();
  }

  /** Debug helper */
  debug() {
    return {
      subscriptions: [...this._subscriptions.entries()].map(([id, s]) => ({
        id, symbol: s.symbol, timeframe: s.timeframe,
      })),
      streams: [...this._streams.entries()].map(([key, s]) => ({
        key, subscribers: [...s.subscriberIds],
      })),
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────

  _dispatch(streamKey, candle) {
    const stream = this._streams.get(streamKey);
    if (!stream) return;
    for (const id of stream.subscriberIds) {
      const sub = this._subscriptions.get(id);
      if (sub) {
        try { sub.callback(candle); } catch (err) {
          console.error(`[FeedManager] callback error for subscription "${id}":`, err);
        }
      }
    }
  }

  _removeSubscription(id) {
    const sub = this._subscriptions.get(id);
    if (!sub) return;

    this._subscriptions.delete(id);

    const streamKey = `${sub.symbol.toUpperCase()}:${sub.timeframe}`;
    const stream = this._streams.get(streamKey);
    if (!stream) return;

    stream.subscriberIds.delete(id);

    // Close the underlying WebSocket only when the last subscriber is gone
    if (stream.subscriberIds.size === 0) {
      try { stream.unsub(); } catch (_) { /* ignore */ }
      this._streams.delete(streamKey);
    }
  }
}

/** Application-wide singleton feed manager. */
export const feedManager = new FeedManagerClass();
