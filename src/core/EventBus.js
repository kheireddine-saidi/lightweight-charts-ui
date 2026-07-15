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

  /**
   * A timestamp tick from the replay clock.
   * payload: { timestamp: number }  (unix seconds)
   * Each chart's ReplayFeed listens and resolves its own nearest candle.
   */
  REPLAY_TICK: 'REPLAY_TICK',

  /** Alert triggered. payload: { alert } */
  ALERT_TRIGGERED: 'ALERT_TRIGGERED',

  /** Session snapshot saved. payload: { snapshot } */
  SNAPSHOT_SAVED: 'SNAPSHOT_SAVED',

  /** Session snapshot restored. payload: { snapshot } */
  SNAPSHOT_RESTORED: 'SNAPSHOT_RESTORED',

  /**
   * An indicator result was updated (built-in or Pine).
   * payload: { id: string, result: object, chartId?: string }
   */
  INDICATOR_UPDATED: 'INDICATOR_UPDATED',

  /**
   * A position's fields changed (SL/TP edit accepted by engine).
   * payload: { position } or { positionId, stopLoss, takeProfit }
   */
  POSITION_UPDATED: 'POSITION_UPDATED',

  /** User finished drawing a trade setup. payload: { setup } */
  TRADE_SETUP_DRAWN: 'TRADE_SETUP_DRAWN',

  /** A trade zone should be linked to a position. payload: { zoneId, positionId, status } */
  TRADE_ZONE_LINKED: 'TRADE_ZONE_LINKED',

  /** Execution settings (risk/slippage/fees/funding) changed. payload: { settings } */
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',

  /**
   * Global replay mode activated. All charts should enter replay.
   * payload: { masterChartId, startIndex }
   */
  REPLAY_ENTER: 'REPLAY_ENTER',

  /**
   * Global replay mode deactivated. All charts should exit replay.
   * payload: {}
   */
  REPLAY_EXIT: 'REPLAY_EXIT',

  /**
   * Crosshair position — emitted by whichever chart the mouse is currently over.
   * Every other chart moves its crosshair to match.
   *
   * payload (normal move):
   *   { time, priceFraction, isSelecting, sourceChartId }
   *   priceFraction — normalised 0–1 position within the emitting chart's visible
   *                   price range; receivers map it onto their own range.
   *
   * payload (mouse left chart):
   *   { clear: true, sourceChartId }
   */
  CROSSHAIR_SYNC: 'CROSSHAIR_SYNC',

  /**
   * Drawing created/moved/deleted — broadcast to other charts with same symbol.
   * payload: { symbol, action: 'add'|'update'|'delete', syncId, toolType,
   *            points: [{time,price}], options, sourceManagerId }
   */
  DRAWING_SYNC: 'DRAWING_SYNC',
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
    const set = this._listeners.get(event);

    // Dev-mode guard: warn when a single event accumulates many listeners —
    // a common symptom of missing useEffect cleanup returning EventBus.off().
    // import.meta.env.DEV is stripped to false by Vite in production builds.
    if (import.meta.env.DEV && set.size >= 20) {
      console.warn(
        `[EventBus] "${event}" now has ${set.size + 1} listeners. ` +
        'Possible missing EventBus.off() in a useEffect cleanup.',
      );
    }

    set.add(handler);
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
