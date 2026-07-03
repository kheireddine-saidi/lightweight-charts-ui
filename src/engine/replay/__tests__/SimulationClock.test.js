import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SimulationClock } from '../SimulationClock';

// ── Fakes for browser APIs ─────────────────────────────────────────────────

let _now = 0;
let _pendingRafs = [];

function fakeRequestAnimationFrame(cb) {
  const id = _pendingRafs.length + 1;
  _pendingRafs.push({ id, cb });
  return id;
}

function fakeCancelAnimationFrame(id) {
  _pendingRafs = _pendingRafs.filter((r) => r.id !== id);
}

/** Flush all scheduled RAF callbacks at the given timestamp */
function flushRafs(now = _now) {
  const pending = [..._pendingRafs];
  _pendingRafs = [];
  for (const { cb } of pending) cb(now);
}

/** Advance fake time by `ms` and flush pending RAFs */
function advanceTime(ms) {
  _now += ms;
  flushRafs(_now);
}

// ── Test timeline ─────────────────────────────────────────────────────────

const TIMELINE = [1000, 1060, 1120, 1180, 1240, 1300]; // 6 timestamps

describe('SimulationClock', () => {
  let clock;

  beforeEach(() => {
    _now = 0;
    _pendingRafs = [];

    // Patch browser APIs
    vi.stubGlobal('performance', { now: () => _now });
    vi.stubGlobal('requestAnimationFrame', fakeRequestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', fakeCancelAnimationFrame);

    clock = new SimulationClock();
    clock.load(TIMELINE);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── load ───────────────────────────────────────────────────────────────────

  describe('load', () => {
    it('resets index to 0', () => {
      clock.seek(3);
      clock.load(TIMELINE);
      expect(clock.index).toBe(0);
    });

    it('updates length', () => {
      expect(clock.length).toBe(6);
    });

    it('fires onIndexChange with 0', () => {
      const spy = vi.fn();
      clock.onIndexChange = spy;
      clock.load(TIMELINE);
      expect(spy).toHaveBeenCalledWith(0);
    });

    it('fires onStateChange', () => {
      const spy = vi.fn();
      clock.onStateChange = spy;
      clock.load(TIMELINE);
      expect(spy).toHaveBeenCalled();
    });

    it('handles non-array input gracefully', () => {
      clock.load(null);
      expect(clock.length).toBe(0);
    });
  });

  // ── play / pause / stop ────────────────────────────────────────────────────

  describe('play', () => {
    it('sets isPlaying to true', () => {
      clock.play();
      expect(clock.isPlaying).toBe(true);
    });

    it('does nothing when already playing', () => {
      clock.play();
      const spy = vi.fn();
      clock.onStateChange = spy;
      clock.play(); // second call
      expect(spy).not.toHaveBeenCalled();
    });

    it('does nothing when timeline is empty', () => {
      clock.load([]);
      clock.play();
      expect(clock.isPlaying).toBe(false);
    });

    it('does nothing when already at last index', () => {
      clock.seek(TIMELINE.length - 1);
      clock.play();
      expect(clock.isPlaying).toBe(false);
    });
  });

  describe('pause', () => {
    it('sets isPlaying to false', () => {
      clock.play();
      clock.pause();
      expect(clock.isPlaying).toBe(false);
    });

    it('does nothing when already paused', () => {
      const spy = vi.fn();
      clock.onStateChange = spy;
      clock.pause(); // already paused after load
      expect(spy).not.toHaveBeenCalled();
    });

    it('preserves current index when paused mid-play', () => {
      clock.setSpeed(1);
      clock.play();
      // _targetTime=0 at play(); first tick fires immediately at now=0 → index=1
      // After 1000ms advance, a second tick fires (now=1000 >= _targetTime=1000) → index=2
      advanceTime(1000);
      clock.pause();
      expect(clock.index).toBe(2);
    });
  });

  describe('stop', () => {
    it('resets index to 0', () => {
      clock.seek(3);
      clock.stop();
      expect(clock.index).toBe(0);
    });

    it('sets isPlaying to false', () => {
      clock.play();
      clock.stop();
      expect(clock.isPlaying).toBe(false);
    });
  });

  // ── step ───────────────────────────────────────────────────────────────────

  describe('step', () => {
    it('increments index by 1', () => {
      clock.step();
      expect(clock.index).toBe(1);
    });

    it('fires onTick with the new timestamp', () => {
      const ticks = [];
      clock.onTick = (ts) => ticks.push(ts);
      clock.step();
      expect(ticks).toEqual([TIMELINE[1]]);
    });

    it('does not advance past the last index', () => {
      clock.seek(TIMELINE.length - 1);
      clock.step();
      expect(clock.index).toBe(TIMELINE.length - 1);
    });

    it('fires onIndexChange', () => {
      const spy = vi.fn();
      clock.onIndexChange = spy;
      clock.step();
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  // ── seek ───────────────────────────────────────────────────────────────────

  describe('seek', () => {
    it('jumps to the specified index', () => {
      clock.seek(4);
      expect(clock.index).toBe(4);
    });

    it('clamps to 0 when given a negative index', () => {
      clock.seek(-5);
      expect(clock.index).toBe(0);
    });

    it('clamps to last index when given an out-of-bounds index', () => {
      clock.seek(999);
      expect(clock.index).toBe(TIMELINE.length - 1);
    });

    it('fires onTick with the timestamp at new index', () => {
      const ticks = [];
      clock.onTick = (ts) => ticks.push(ts);
      clock.seek(3);
      expect(ticks).toEqual([TIMELINE[3]]);
    });

    it('fires onIndexChange', () => {
      const spy = vi.fn();
      clock.onIndexChange = spy;
      clock.seek(2);
      expect(spy).toHaveBeenCalledWith(2);
    });
  });

  // ── setSpeed ───────────────────────────────────────────────────────────────

  describe('setSpeed', () => {
    it('updates _speed and _msPerTick', () => {
      clock.setSpeed(2);
      expect(clock.speed).toBe(2);
      expect(clock._msPerTick).toBeCloseTo(500);
    });

    it('clamps speed to minimum 0.01', () => {
      clock.setSpeed(0);
      expect(clock.speed).toBe(0.01);
    });

    it('fires onStateChange', () => {
      const spy = vi.fn();
      clock.onStateChange = spy;
      clock.setSpeed(4);
      expect(spy).toHaveBeenCalled();
    });
  });

  // ── state getter ───────────────────────────────────────────────────────────

  describe('state', () => {
    it('returns correct snapshot', () => {
      const s = clock.state;
      expect(s).toMatchObject({
        index: 0,
        timestamp: TIMELINE[0],
        speed: 1,
        isPlaying: false,
        length: TIMELINE.length,
      });
    });
  });

  // ── getCurrentTimestamp ────────────────────────────────────────────────────

  describe('getCurrentTimestamp', () => {
    it('returns timestamp at current index', () => {
      clock.seek(2);
      expect(clock.getCurrentTimestamp()).toBe(TIMELINE[2]);
    });

    it('returns null for empty timeline', () => {
      clock.load([]);
      expect(clock.getCurrentTimestamp()).toBeNull();
    });
  });

  // ── _tick drift-correction catch-up ───────────────────────────────────────

  describe('_tick – drift-correction', () => {
    it('emits one tick per msPerTick interval', () => {
      const ticks = [];
      clock.onTick = (ts) => ticks.push(ts);
      clock.setSpeed(1); // 1 tick/s → 1000ms per tick

      // At play(), _targetTime = performance.now() = 0. The first RAF fires at now=0
      // so the while loop condition (0 >= 0) is true immediately → emits tick at index=1,
      // then _targetTime becomes 1000. Advancing to 1000 emits a second tick.
      // So at t=999 (before the second _targetTime) we should see exactly 1 tick.
      clock.play(); // _targetTime=0, RAF scheduled
      advanceTime(999); // now=999 < 1000 → first tick already fired at t=0, no second yet
      // Actually the first tick fires inside advanceTime(999) because now=999 >= _targetTime=0
      // Then _targetTime becomes 1000. 999 < 1000 → no second tick.
      expect(ticks.length).toBe(1);
      expect(clock.index).toBe(1);
    });

    it('catches up multiple ticks when a frame is late (drift correction)', () => {
      const ticks = [];
      clock.onTick = (ts) => ticks.push(ts);
      clock.setSpeed(1); // 1 tick/s → 1000ms per tick

      // At play(), _targetTime=0. The RAF fires at now=3000.
      // while(3000 >= _targetTime): fires at 0,1000,2000,3000 → 4 ticks
      clock.play();
      advanceTime(3000);
      expect(ticks.length).toBe(4);
      expect(clock.index).toBe(4);
    });

    it('stops playing and fires onEnd when timeline is exhausted', () => {
      const endSpy = vi.fn();
      clock.onEnd = endSpy;
      clock.setSpeed(1);

      clock.play();
      // 5 ticks needed to reach end (index 0→5, TIMELINE.length-1=5)
      advanceTime(10000); // way more than needed
      expect(clock.isPlaying).toBe(false);
      expect(endSpy).toHaveBeenCalledOnce();
    });

    it('does not emit more ticks than timeline length - 1', () => {
      const ticks = [];
      clock.onTick = (ts) => ticks.push(ts);
      clock.setSpeed(100); // very fast

      clock.play();
      advanceTime(10000);
      // Max ticks = TIMELINE.length - 1 = 5
      expect(ticks.length).toBe(5);
      expect(clock.index).toBe(TIMELINE.length - 1);
    });

    it('does not continue ticking when paused during playback', () => {
      const ticks = [];
      clock.onTick = (ts) => ticks.push(ts);
      clock.setSpeed(1);

      clock.play();
      advanceTime(1000); // 1 tick
      clock.pause();
      const countAfterPause = ticks.length;
      advanceTime(5000); // time passes but clock is paused
      expect(ticks.length).toBe(countAfterPause); // no new ticks
    });
  });

  // ── onEnd callback ─────────────────────────────────────────────────────────

  describe('onEnd', () => {
    it('fires when playback reaches the last index', () => {
      const spy = vi.fn();
      clock.onEnd = spy;
      clock.setSpeed(100);
      clock.play();
      advanceTime(10000);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('does not fire if stopped before end', () => {
      const spy = vi.fn();
      clock.onEnd = spy;
      clock.setSpeed(1);
      clock.play();
      advanceTime(1000);
      clock.stop();
      advanceTime(10000);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
