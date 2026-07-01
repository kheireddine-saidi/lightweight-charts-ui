/**
 * EventBus — lightweight pub/sub event system.
 *
 * Replaces direct imports between Chart, TradingStore, and Analytics.
 *
 * Flow:
 *   SimulationClock / LiveFeed
 *         │
 *         ▼
 *      EventBus
 *     ┌────┴────┐────────────┐
 *     ▼         ▼            ▼
 *  Chart   TradingEngine  Analytics
 *
 * No React imports.
 */

/**
 * @readonly
 * @enum {string}
 */
export const Events = Object.freeze({
  /** Emitted for every new candle (replay or live). payload: { candle, index, symbol } */
  CANDLE: 'CANDLE',

  /** A new order has been submitted. payload: { order } */
  ORDER_CREATED: 'ORDER_CREATED',

  /** A pending order has been filled. payload: { order, fillPrice, fillTime } */
  ORDER_FILLED: 'ORDER_FILLED',

  /** A position was opened (market order filled). payload: { position } */
  POSITION_OPENED: 'POSITION_OPENED',

  /** A position was closed. payload: { position, closePrice, closeTime, pnl } */
  POSITION_CLOSED: 'POSITION_CLOSED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  SCROLL_TO_TIME:  'SCROLL_TO_TIME',
  PRICE_TICK:      'PRICE_TICK',
  EQUITY_TICK:     'EQUITY_TICK',
  TPSL_REJECTED:   'TPSL_REJECTED',

  /** Account balance changed. payload: { balance, equity, change } */
  BALANCE_CHANGED: 'BALANCE_CHANGED',

  /** Backtest metrics recalculated. payload: { metrics } */
  BACKTEST_UPDATED: 'BACKTEST_UPDATED',

  /** Replay clock state changed. payload: SimulationClock.state */
  REPLAY_STATE: 'REPLAY_STATE',

  /** Alert triggered. payload: { alert } */
  ALERT_TRIGGERED: 'ALERT_TRIGGERED',

  /** Session snapshot saved. payload: { snapshot } */
  SNAPSHOT_SAVED: 'SNAPSHOT_SAVED',

  /** Session snapshot restored. payload: { snapshot } */
  SNAPSHOT_RESTORED: 'SNAPSHOT_RESTORED',

  /** User finished drawing a trade setup. payload: { setup } */
  TRADE_SETUP_DRAWN: 'TRADE_SETUP_DRAWN',

  /** A trade zone should be linked to a position. payload: { zoneId, positionId, status } */
  TRADE_ZONE_LINKED: 'TRADE_ZONE_LINKED',

  /** Execution settings (risk/slippage/fees/funding) changed. payload: { settings } */
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
});

class EventBusClass {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event  Use Events constants
   * @param {Function} handler
   * @returns {() => void}  Unsubscribe function
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event once; auto-unsubscribes after first call.
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void}
   */
  once(event, handler) {
    const wrapper = (payload) => {
      handler(payload);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe a handler.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    const handlers = this._listeners.get(event);
    if (!handlers || handlers.size === 0) return;
    // Snapshot to avoid mutation during iteration
    for (const h of Array.from(handlers)) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    }
  }

  /**
   * Remove all listeners for an event (or all events if omitted).
   * @param {string} [event]
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /**
   * Debug helper — list active event names and listener counts.
   */
  debug() {
    const info = {};
    for (const [ev, handlers] of this._listeners) {
      info[ev] = handlers.size;
    }
    return info;
  }
}

/** Application-wide singleton event bus. */
export const EventBus = new EventBusClass();
