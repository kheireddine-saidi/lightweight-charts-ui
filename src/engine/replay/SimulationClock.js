/**
 * SimulationClock — deterministic, drift-corrected replay engine.
 *
 * Uses requestAnimationFrame + performance.now() as the playback driver.
 * Simulation state is decoupled from browser FPS: if the browser drops
 * frames we catch up by emitting multiple ticks per frame.
 *
 * CHANGED (Phase 3): clock is now timestamp-driven.
 * It no longer holds OHLC data — it holds a timeline (array of timestamps).
 * Each tick emits a timestamp; each chart's ReplayFeed resolves its own candle.
 *
 * No React imports. No chart imports.
 */
export class SimulationClock {
  /** @type {number[]} sorted array of unix timestamps (seconds) */
  _timeline = [];
  _index = 0;
  _speed = 1;           // ticks per second
  _isPlaying = false;
  _rafId = null;
  _targetTime = 0;      // next scheduled emit time (performance.now ms)
  _msPerTick = 1000;    // wall-clock ms between tick emissions at current speed

  // Callbacks
  /** @type {((timestamp: number) => void) | null} */
  onTick = null;
  /** @type {(() => void) | null} */
  onEnd = null;
  /** @type {((index: number) => void) | null} */
  onIndexChange = null;
  /** @type {((state: object) => void) | null} */
  onStateChange = null;

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Load a timeline (array of timestamps) and reset to beginning.
   * @param {number[]} timeline  Array of unix timestamps in seconds.
   */
  load(timeline) {
    this.stop();
    this._timeline = Array.isArray(timeline) ? timeline : [];
    this._index = 0;
    this._emitIndexChange();
    this._emitStateChange();
  }

  /** Start or resume playback. */
  play() {
    if (this._isPlaying) return;
    if (this._timeline.length === 0) return;
    if (this._index >= this._timeline.length - 1) return;

    this._isPlaying = true;
    this._targetTime = performance.now();
    this._rafId = requestAnimationFrame(this._tick);
    this._emitStateChange();
  }

  /** Pause playback, preserving current index. */
  pause() {
    if (!this._isPlaying) return;
    this._isPlaying = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._emitStateChange();
  }

  /** Stop playback and rewind to beginning. */
  stop() {
    this.pause();
    this._index = 0;
    this._emitIndexChange();
    this._emitStateChange();
  }

  /** Advance by exactly one tick (works while paused). */
  step() {
    if (this._index >= this._timeline.length - 1) return;
    this._index++;
    this._emitIndexChange();
    const ts = this._timeline[this._index];
    if (ts !== undefined && this.onTick) this.onTick(ts);
    this._emitStateChange();
  }

  /**
   * Jump to a specific index in the timeline.
   * @param {number} index
   */
  seek(index) {
    const clamped = Math.max(0, Math.min(index, this._timeline.length - 1));
    this._index = clamped;
    this._emitIndexChange();
    const ts = this._timeline[clamped];
    if (ts !== undefined && this.onTick) this.onTick(ts);
    this._emitStateChange();
  }

  /**
   * Set playback speed in ticks-per-second.
   * @param {number} speed  e.g. 1 = 1 tick/s, 10 = 10 ticks/s
   */
  setSpeed(speed) {
    this._speed = Math.max(0.01, speed);
    this._msPerTick = 1000 / this._speed;
    this._emitStateChange();
  }

  /** @returns {number|null} current timestamp or null */
  getCurrentTimestamp() {
    return this._timeline[this._index] ?? null;
  }

  // ─── Getters ─────────────────────────────────────────────────────────────

  get index() { return this._index; }
  get speed() { return this._speed; }
  get isPlaying() { return this._isPlaying; }
  get length() { return this._timeline.length; }
  get timestamp() { return this._timeline[this._index] ?? null; }

  /** Read-only snapshot of simulation state. */
  get state() {
    return {
      index: this._index,
      timestamp: this.timestamp,
      speed: this._speed,
      isPlaying: this._isPlaying,
      length: this._timeline.length,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * RAF callback — drift-corrected tick loop.
   * Emits as many ticks as needed to stay on schedule, so the simulation
   * remains deterministic regardless of browser frame rate.
   */
  _tick = (now) => {
    if (!this._isPlaying) return;

    while (now >= this._targetTime && this._index < this._timeline.length - 1) {
      this._index++;
      this._emitIndexChange();
      const ts = this._timeline[this._index];
      if (ts !== undefined && this.onTick) this.onTick(ts);
      this._targetTime += this._msPerTick;
    }

    if (this._index >= this._timeline.length - 1) {
      this._isPlaying = false;
      this._rafId = null;
      this._emitStateChange();
      if (this.onEnd) this.onEnd();
      return;
    }

    this._rafId = requestAnimationFrame(this._tick);
  };

  _emitIndexChange() {
    if (this.onIndexChange) this.onIndexChange(this._index);
  }

  _emitStateChange() {
    if (this.onStateChange) this.onStateChange(this.state);
  }
}
