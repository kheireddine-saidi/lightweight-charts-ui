/**
 * ReplayController — owns the replay state machine for a single chart instance.
 *
 * Phase 7: Extracted from ChartComponent.jsx.
 * Phase 8: Backward seek checkpoint/restore.
 * Phase 10:
 *   - Backward seek now replays the ExecutionEngine FORWARD from the origin
 *     snapshot through all candles up to the target index, so positions/orders
 *     reflect actual trade history at that point in time.
 *   - Owns the follower-sync ReplayFeed (previously a separate replayFeedRef
 *     in ChartComponent) so ChartComponent no longer needs it.
 *   - Exposes getFeed() for imperative methods (syncToTimestamp, getReplayBars)
 *     that still need feed access.
 *
 * Design rules:
 *   - NO React imports.
 *   - NO lightweight-charts imports.
 *   - NO Zustand imports.
 *   - Communicates with chart via injected callbacks.
 *   - Idempotent _subscribe() / _unsubscribe().
 */

import { EventBus, Events } from '../../core/EventBus';
import { ReplayFeed } from '../../feeds/ReplayFeed';
import { replayEngine } from './ReplayEngine';
import { executionEngine } from '../trading/ExecutionEngine';

export class ReplayController {
  /**
   * @param {object} opts
   * @param {string}   opts.symbol          Trading symbol for this chart.
   * @param {Function} opts.onIndexChange    Called with (index, hideFuture, preserveView).
   * @param {Function} [opts.onReset]        Called on exit so the chart restores full data.
   */
  constructor({ symbol, onIndexChange, onReset } = {}) {
    /** @type {string} */
    this._symbol = symbol;

    /** @type {Function} */
    this._onIndexChange = onIndexChange ?? (() => {});

    /** @type {Function} */
    this._onReset = onReset ?? (() => {});

    /**
     * Per-chart ReplayFeed — owned here (Phase 10 consolidation).
     * Previously duplicated as replayFeedRef in ChartComponent.
     * @type {ReplayFeed|null}
     */
    this._feed = null;

    /** @type {object[]|null} Full OHLC dataset for this chart. */
    this._fullData = null;

    /** @type {number|null} Current replay candle index. */
    this._index = null;

    /** @type {boolean} */
    this._active = false;

    /** @type {Function|null} */
    this._unsubTick = null;

    /** @type {Function|null} */
    this._unsubCandle = null;

    /**
     * ExecutionEngine snapshot captured when entering replay.
     * Used as the rewind origin for backward seeks.
     * @type {object|null}
     */
    this._engineOriginSnapshot = null;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Enter replay mode.
   * @param {object[]} fullData   Full OHLC array.
   * @param {number}   startIndex Starting candle index.
   */
  enter(fullData, startIndex) {
    if (!Array.isArray(fullData) || fullData.length === 0) return;

    this._fullData = fullData;
    const timeline = fullData.map(c => c.time);

    // Init or refresh the per-chart feed (Phase 10: single owner).
    if (!this._feed) {
      this._feed = new ReplayFeed(fullData, this._symbol);
    } else {
      this._feed.setData(fullData, this._symbol);
      this._feed.reset();
    }

    // Capture engine state at entry — used as backward-seek origin.
    this._engineOriginSnapshot = executionEngine.getSnapshot();

    replayEngine.load(fullData, this._symbol, timeline);
    replayEngine.seek(startIndex);

    this._index = startIndex;
    this._subscribe();
  }

  /** Exit replay mode: stop clock, release subscriptions, notify chart. */
  exit() {
    replayEngine.stop();
    this._unsubscribe();
    this._index = null;
    this._fullData = null;
    this._engineOriginSnapshot = null;
    this._onReset();
  }

  play()  { replayEngine.play();  }
  pause() { replayEngine.pause(); }

  /** Advance one candle; chart update arrives via the resulting CANDLE event. */
  step()  { replayEngine.step();  }

  /**
   * Seek to a specific candle index.
   *
   * Phase 10 — backward seek now replays the engine forward:
   *   1. Restore ExecutionEngine to the origin (empty) snapshot.
   *   2. Synchronously process every candle from 0 → targetIndex through
   *      executionEngine._onCandle() — this rebuilds positions/orders exactly
   *      as they would be at that point in history.
   *   3. Reset the feed cursor so REPLAY_TICK events re-emit from the new index.
   *
   * @param {number}  index
   * @param {boolean} [hideFuture=true]
   */
  seek(index, hideFuture = true) {
    if (!this._feed || !this._fullData) return;

    const currentIndex  = this._index ?? 0;
    const isBackwardSeek = index < currentIndex;

    if (replayEngine.isPlaying) {
      replayEngine.pause();
    }

    if (isBackwardSeek && this._engineOriginSnapshot) {
      // 1. Rewind engine to blank-slate origin.
      executionEngine.restoreSnapshot(this._engineOriginSnapshot);

      // 2. Replay forward through each candle silently up to target index.
      //    We suppress the EQUITY_TICK storm during the fast-forward loop by
      //    running _onCandle directly (it already does not emit REPLAY_TICK).
      const target = Math.min(index, this._fullData.length - 1);
      for (let i = 0; i <= target; i++) {
        executionEngine._onCandle(this._symbol, this._fullData[i]);
      }
    }

    // Reset the feed cursor so any subsequent REPLAY_TICK re-emits from here.
    this._feed.reset();

    // Advance the shared clock to the target index.
    replayEngine.seek(index);

    this._index = index;

    // Notify chart to update its series display.
    this._onIndexChange(index, hideFuture, false);
  }

  /** @param {number} speed */
  setSpeed(speed) { replayEngine.setSpeed(speed); }

  /** @param {string} symbol */
  setSymbol(symbol) {
    this._symbol = symbol;
    if (this._feed) this._feed._symbol = symbol;
  }

  /**
   * Expose the internal ReplayFeed so ChartComponent's imperative methods
   * (syncToTimestamp, getReplayBars, exitFollowerReplay) can access it.
   * @returns {ReplayFeed|null}
   */
  getFeed() {
    return this._feed;
  }

  /** @returns {number|null} */
  get index() { return this._index; }

  // ─── Private ─────────────────────────────────────────────────────────────

  /** Idempotent — second call is a no-op. */
  _subscribe() {
    if (this._active) return;
    this._active = true;

    // REPLAY_TICK → feed binary-searches nearest candle → emits CANDLE.
    // ExecutionEngine is subscribed first (via main.jsx ordering).
    this._unsubTick = EventBus.on(Events.REPLAY_TICK, ({ timestamp }) => {
      if (!this._active || !this._feed) return;
      this._feed.advanceTo(timestamp);
    });

    // CANDLE → notify chart to update its series.
    this._unsubCandle = EventBus.on(Events.CANDLE, ({ index, symbol: candleSymbol }) => {
      if (!this._active) return;
      if (candleSymbol && this._symbol && candleSymbol !== this._symbol) return;
      this._index = index;
      this._onIndexChange(index, true, false);
    });
  }

  /** Idempotent — safe to call multiple times. */
  _unsubscribe() {
    if (!this._active) return;
    this._active = false;
    this._unsubTick?.();
    this._unsubCandle?.();
    this._unsubTick  = null;
    this._unsubCandle = null;
  }
}
