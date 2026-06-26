/**
 * ReplayEngine — thin adapter between SimulationClock and EventBus.
 *
 * Connects the SimulationClock's onCandle / onEnd callbacks to the
 * application-wide EventBus so all subscribers (Chart, ExecutionEngine,
 * Analytics) receive candles through a single channel.
 *
 * No React imports. No chart imports. No global variables.
 */
import { SimulationClock } from './SimulationClock';
import { EventBus, Events } from '../../core/EventBus';

export class ReplayEngine {
  constructor() {
    this.clock = new SimulationClock();

    this.clock.onCandle = (candle, index) => {
      EventBus.emit(Events.CANDLE, { candle, index });
    };

    this.clock.onEnd = () => {
      EventBus.emit(Events.REPLAY_STATE, this.clock.state);
    };

    this.clock.onStateChange = (state) => {
      EventBus.emit(Events.REPLAY_STATE, state);
    };
  }

  // ─── Delegate to SimulationClock ────────────────────────────────────────

  load(data)       { this.clock.load(data); }
  play()           { this.clock.play(); }
  pause()          { this.clock.pause(); }
  stop()           { this.clock.stop(); }
  step()           { this.clock.step(); }
  seek(index)      { this.clock.seek(index); }
  setSpeed(speed)  { this.clock.setSpeed(speed); }
  getCurrentCandle() { return this.clock.getCurrentCandle(); }

  get isPlaying()  { return this.clock.isPlaying; }
  get index()      { return this.clock.index; }
  get length()     { return this.clock.length; }
  get state()      { return this.clock.state; }
}

/** Application-wide singleton replay engine. */
export const replayEngine = new ReplayEngine();
