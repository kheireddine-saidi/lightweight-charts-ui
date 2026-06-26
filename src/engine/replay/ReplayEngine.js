/**
 * ReplayEngine — drift-corrected, frame-accurate replay clock.
 * Uses requestAnimationFrame + performance.now() instead of setInterval
 * to prevent timer drift at high playback speeds.
 */
export class ReplayEngine {
  constructor({ onTick, onEnd, onIndexChange } = {}) {
    this._onTick = onTick; this._onEnd = onEnd; this._onIndexChange = onIndexChange;
    this._data = []; this._index = 0; this._speed = 1; this._isPlaying = false;
    this._targetTime = 0; this._msPerCandle = 1000; this._rafId = null;
  }
  load(data) { this.stop(); this._data = data; this._index = 0; this._notifyIndex(); }
  seek(index) { const clamped = Math.max(0, Math.min(index, this._data.length - 1)); this._index = clamped; this._notifyIndex(); if (this._onTick) this._onTick(this._data[clamped], clamped); }
  setSpeed(speed) { this._speed = speed; this._msPerCandle = 1000 / speed; }
  play() { if (this._isPlaying) return; if (this._index >= this._data.length - 1) return; this._isPlaying = true; this._targetTime = performance.now(); this._rafId = requestAnimationFrame(this._tick); }
  pause() { this._isPlaying = false; if (this._rafId != null) { cancelAnimationFrame(this._rafId); this._rafId = null; } }
  stop() { this.pause(); this._index = 0; this._notifyIndex(); }
  get isPlaying() { return this._isPlaying; } get index() { return this._index; } get length() { return this._data.length; }
  _tick = (now) => { if (!this._isPlaying) return; while (now >= this._targetTime && this._index < this._data.length - 1) { this._index++; this._notifyIndex(); if (this._onTick) this._onTick(this._data[this._index], this._index); this._targetTime += this._msPerCandle; } if (this._index >= this._data.length - 1) { this._isPlaying = false; if (this._onEnd) this._onEnd(); return; } this._rafId = requestAnimationFrame(this._tick); };
  _notifyIndex() { if (this._onIndexChange) this._onIndexChange(this._index); }
}
