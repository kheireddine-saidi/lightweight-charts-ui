/**
 * SimulationClock — deterministic, drift-corrected replay engine.
 *
 * Uses requestAnimationFrame + performance.now() as the playback driver.
 * Simulation state is decoupled from browser FPS: if the browser drops
 * frames we catch up by emitting multiple candles per frame.
 *
 * No React imports. No chart imports.
 */
export class SimulationClock {
  /** @type {Array<{time:number,open:number,high:number,low:number,close:number,volume?:number}>} */
  _data = [];
  _index = 0;
  _speed = 1;           // candles per second
  _isPlaying = false;
  _rafId = null;
  _targetTime = 0;      // next scheduled emit time (performance.now ms)
  _msPerCandle = 1000;  // wall-clock ms between candle emissions at current speed

  // Callbacks
  /** @type {((candle:object, index:number) => void) | null} */
  onCandle = null;
  /** @type {(() => void) | null} */
  onEnd = null;
  /** @type {((index:number) => void) | null} */
  onIndexChange = null;
  /** @type {((state:object) => void) | null} */
  onStateChange = null;

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Load a candle array and reset to beginning.
   * @param {object[]} data
   */
  load(data) {
    this.stop();
    this._data = Array.isArray(data) ? data : [];
    this._index = 0;
    this._emitIndexChange();
    this._emitStateChange();
  }

  /** Start or resume playback. */
  play() {
    if (this._isPlaying) return;
    if (this._data.length === 0) return;
    if (this._index >= this._data.length - 1) return;

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

  /** Advance by exactly one candle (works while paused). */
  step() {
    if (this._index >= this._data.length - 1) return;
    this._index++;
    this._emitIndexChange();
    const candle = this._data[this._index];
    if (candle && this.onCandle) this.onCandle(candle, this._index);
    this._emitStateChange();
  }

  /**
   * Jump to a specific candle index.
   * @param {number} index
   */
  seek(index) {
    const clamped = Math.max(0, Math.min(index, this._data.length - 1));
    this._index = clamped;
    this._emitIndexChange();
    const candle = this._data[clamped];
    if (candle && this.onCandle) this.onCandle(candle, clamped);
    this._emitStateChange();
  }

  /**
   * Set playback speed in candles-per-second.
   * @param {number} speed  e.g. 1 = 1 candle/s, 10 = 10 candles/s
   */
  setSpeed(speed) {
    this._speed = Math.max(0.01, speed);
    this._msPerCandle = 1000 / this._speed;
    this._emitStateChange();
  }

  /** @returns {object|null} current candle or null */
  getCurrentCandle() {
    return this._data[this._index] ?? null;
  }

  // ─── Getters ─────────────────────────────────────────────────────────────

  get index() { return this._index; }
  get speed() { return this._speed; }
  get isPlaying() { return this._isPlaying; }
  get length() { return this._data.length; }
  get timestamp() { return this._data[this._index]?.time ?? null; }

  /** Read-only snapshot of simulation state (useful for serialisation). */
  get state() {
    return {
      index: this._index,
      timestamp: this.timestamp,
      speed: this._speed,
      isPlaying: this._isPlaying,
      length: this._data.length,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * RAF callback — drift-corrected tick loop.
   * Emits as many candles as needed to stay on schedule, so the simulation
   * remains deterministic regardless of browser frame rate.
   */
  _tick = (now) => {
    if (!this._isPlaying) return;

    // Emit every candle that is "due" since last frame
    while (now >= this._targetTime && this._index < this._data.length - 1) {
      this._index++;
      this._emitIndexChange();
      const candle = this._data[this._index];
      if (candle && this.onCandle) this.onCandle(candle, this._index);
      this._targetTime += this._msPerCandle;
    }

    if (this._index >= this._data.length - 1) {
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
