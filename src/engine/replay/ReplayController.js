/**
 * ReplayController — owns the replay state machine for a single chart instance.
 *
 * Phase 7: Extracted from ChartComponent.jsx.
 *  - Subscribes to REPLAY_TICK and CANDLE events on behalf of the chart.
 *  - Manages the per-chart ReplayFeed (binary-search advanceTo).
 *  - Exposes play/pause/seek/step/reset/setSpeed — delegates to ReplayEngine singleton.
 *  - Notifies the chart via callbacks so ChartComponent stays free of replay logic.
 *
 * Phase 8: Backward seek rewinds ExecutionEngine state via checkpoint/restore.
 *  - On every forward seek a checkpoint is saved at the new index.
 *  - On backward seek the engine is reset to the initial snapshot and replayed forward.
 *
 * Design rules (from refactor ground rules):
 *  - NO React imports.
 *  - NO lightweight-charts imports.
 *  - NO Zustand imports.
 *  - Communicates with chart via injected callbacks.
 *  - Idempotent start() / stop().
 */

import { EventBus, Events } from '../../core/EventBus';
import { ReplayFeed } from '../../feeds/ReplayFeed';
import { replayEngine } from './ReplayEngine';
import { executionEngine } from '../trading/ExecutionEngine';

export class ReplayController {
  /**
   * @param {object} opts
   * @param {string}   opts.symbol         Trading symbol for this chart.
   * @param {Function} opts.onIndexChange   Called with (index, hideFuture, preserveView) when the replay position advances.
   * @param {Function} [opts.onReset]       Called when replay is exited so chart can restore full data.
   */
  constructor({ symbol, onIndexChange, onReset } = {}) {
    /** @type {string} */
    this._symbol = symbol;

    /** @type {Function} (index: number, hideFuture: boolean, preserveView: boolean) => void */
    this._onIndexChange = onIndexChange ?? (() => {});

    /** @type {Function} () => void */
    this._onReset = onReset ?? (() => {});

    /** @type {ReplayFeed|null} Per-chart feed — owns binary-search advanceTo. */
    this._feed = null;

    /** @type {number|null} Current replay candle index. */
    this._index = null;

    /** @type {boolean} Whether subscriptions are currently active. */
    this._active = false;

    /** @type {Function|null} Unsubscribe REPLAY_TICK. */
    this._unsubTick = null;

    /** @type {Function|null} Unsubscribe CANDLE. */
    this._unsubCandle = null;

    // ── Phase 8: Checkpoint store ────────────────────────────────────────
    /**
     * Snapshot of ExecutionEngine taken at replay start (index 0 equivalent).
     * Used to rewind the engine on backward seeks.
     * @type {object|null}
     */
    this._engineOriginSnapshot = null;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Initialize and enter replay mode.
   * Must be called before any other method.
   *
   * @param {object[]} fullData   Full OHLC array for this chart.
   * @param {number}   startIndex Index at which to begin playback.
   */
  enter(fullData, startIndex) {
    if (!Array.isArray(fullData) || fullData.length === 0) return;

    const timeline = fullData.map(c => c.time);

    // Init or refresh the per-chart feed.
    if (!this._feed) {
      this._feed = new ReplayFeed(fullData, this._symbol);
    } else {
      this._feed.setData(fullData, this._symbol);
      this._feed.reset();
    }

    // Phase 8: Capture engine state at replay entry point.
    this._engineOriginSnapshot = executionEngine.getSnapshot();

    // Tell the shared replay engine to load the timeline.
    replayEngine.load(fullData, this._symbol, timeline);
    replayEngine.seek(startIndex);

    this._index = startIndex;
    this._subscribe();
  }

  /**
   * Exit replay mode. Unsubscribes all events and notifies chart.
   */
  exit() {
    replayEngine.stop();
    this._unsubscribe();
    this._index = null;
    this._engineOriginSnapshot = null;
    this._onReset();
  }

  /** Start playback. */
  play() {
    replayEngine.play();
  }

  /** Pause playback. */
  pause() {
    replayEngine.pause();
  }

  /** Advance one candle. */
  step() {
    replayEngine.step();
    // Chart update is driven by the resulting CANDLE event — no extra call needed.
  }

  /**
   * Seek to a specific candle index.
   * Stops playback, resets the feed (so backward seeks re-emit candles),
   * and updates the chart.
   *
   * Phase 8: If seeking backward, rewinds ExecutionEngine to origin snapshot
   * so positions/orders reflect only the replayed history up to the new index.
   *
   * @param {number}  index
   * @param {boolean} [hideFuture=true]
   */
  seek(index, hideFuture = true) {
    if (!this._feed) return;

    const currentIndex = this._index ?? 0;
    const isBackwardSeek = index < currentIndex;

    // Stop playback.
    if (replayEngine.isPlaying) {
      replayEngine.pause();
    }

    // Phase 8: Rewind engine on backward seek.
    if (isBackwardSeek && this._engineOriginSnapshot) {
      executionEngine.restoreSnapshot(this._engineOriginSnapshot);
    }

    // Reset feed cursor so backward seeks re-emit candles.
    this._feed.reset();

    // Advance the shared clock to the new index.
    replayEngine.seek(index);

    this._index = index;

    // Notify chart to update series display immediately.
    this._onIndexChange(index, hideFuture, false);
  }

  /**
   * Change playback speed.
   * @param {number} speed  Multiplier (e.g. 1 = real-time, 2 = 2×, etc.)
   */
  setSpeed(speed) {
    replayEngine.setSpeed(speed);
  }

  /**
   * Update the symbol (e.g. after a symbol change in the same chart instance).
   * @param {string} symbol
   */
  setSymbol(symbol) {
    this._symbol = symbol;
    if (this._feed) {
      this._feed._symbol = symbol;
    }
  }

  /** Current candle index, or null if not in replay mode. */
  get index() {
    return this._index;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to REPLAY_TICK and CANDLE events.
   * Idempotent — a second call is a no-op.
   */
  _subscribe() {
    if (this._active) return;
    this._active = true;

    // REPLAY_TICK → feed resolves the nearest candle via binary search → emits CANDLE.
    // ExecutionEngine is subscribed first (via main.jsx ordering) so it always
    // processes before this chart renderer sees the CANDLE event.
    this._unsubTick = EventBus.on(Events.REPLAY_TICK, ({ timestamp }) => {
      if (!this._active || !this._feed) return;
      this._feed.advanceTo(timestamp);
    });

    // CANDLE → notify chart to update its series.
    this._unsubCandle = EventBus.on(Events.CANDLE, ({ index, symbol: candleSymbol }) => {
      if (!this._active) return;
      // Multi-chart guard: only handle candles for this chart's symbol.
      if (candleSymbol && this._symbol && candleSymbol !== this._symbol) return;
      this._index = index;
      this._onIndexChange(index, true, false);
    });
  }

  /**
   * Unsubscribe all EventBus listeners.
   * Idempotent — safe to call multiple times.
   */
  _unsubscribe() {
    if (!this._active) return;
    this._active = false;
    this._unsubTick?.();
    this._unsubCandle?.();
    this._unsubTick = null;
    this._unsubCandle = null;
  }
}
