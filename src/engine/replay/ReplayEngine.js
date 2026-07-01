/**
 * ReplayEngine — thin adapter between SimulationClock and EventBus.
 *
 * CHANGED (Phase 3):
 *  - load() now accepts (data, symbol, timeline) where timeline is number[].
 *  - Clock emits REPLAY_TICK (timestamp) instead of CANDLE.
 *  - Each chart's ReplayFeed listens to REPLAY_TICK and resolves its own candle.
 *
 * No React imports. No chart imports. No global variables.
 */
import { SimulationClock } from './SimulationClock';
import { EventBus, Events } from '../../core/EventBus';

export class ReplayEngine {
  constructor() {
    this.clock = new SimulationClock();
    this._activeSymbol = null;
    /** @type {object[]} full OHLC data for the primary chart */
    this._data = [];

    this.clock.onTick = (timestamp) => {
      EventBus.emit(Events.REPLAY_TICK, { timestamp });
    };

    this.clock.onEnd = () => {
      EventBus.emit(Events.REPLAY_STATE, this.clock.state);
    };

    this.clock.onStateChange = (state) => {
      EventBus.emit(Events.REPLAY_STATE, state);
    };
  }

  // ─── Delegate to SimulationClock ────────────────────────────────────────

  /**
   * @param {object[]} data      Full OHLC array (kept for callers that need it)
   * @param {string}   symbol    Active trading symbol
   * @param {number[]} [timeline] Array of timestamps. Defaults to data.map(c=>c.time).
   */
  load(data, symbol, timeline) {
    this._activeSymbol = symbol ?? null;
    this._data = Array.isArray(data) ? data : [];
    const tl = Array.isArray(timeline) && timeline.length > 0
      ? timeline
      : this._data.map(c => c.time);
    this.clock.load(tl);
  }

  play()           { this.clock.play(); }
  pause()          { this.clock.pause(); }
  stop()           { this.clock.stop(); }
  step()           { this.clock.step(); }
  seek(index)      { this.clock.seek(index); }
  setSpeed(speed)  { this.clock.setSpeed(speed); }
  /** @deprecated Use REPLAY_TICK events. Kept for legacy callers. */
  getCurrentCandle() {
    const ts = this.clock.getCurrentTimestamp();
    if (ts === null) return null;
    return this._data.find(c => c.time === ts) ?? null;
  }

  get isPlaying()  { return this.clock.isPlaying; }
  get index()      { return this.clock.index; }
  get length()     { return this.clock.length; }
  get state()      { return this.clock.state; }
}

/** Application-wide singleton replay engine. */
export const replayEngine = new ReplayEngine();
