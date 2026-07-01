/**
 * useReplayEngine — React hook wrapping the singleton ReplayEngine.
 *
 * Subscribes to EventBus REPLAY_STATE events so the component tree
 * re-renders only when the clock state changes (not on every tick).
 * The underlying SimulationClock is never recreated across renders.
 *
 * CHANGED (Phase 3): load() now accepts (data, symbol, timeline).
 */
import { useEffect, useState, useCallback } from 'react';
import { replayEngine } from './ReplayEngine';
import { EventBus, Events } from '../../core/EventBus';

export function useReplayEngine() {
  const [clockState, setClockState] = useState(() => replayEngine.state);

  // Keep clock state in sync via EventBus (no polling, no stale closure)
  useEffect(() => {
    const unsub = EventBus.on(Events.REPLAY_STATE, setClockState);
    return unsub;
  }, []);

  /**
   * @param {object[]} data
   * @param {string}   symbol
   * @param {number[]} [timeline]
   */
  const load = useCallback((data, symbol, timeline) => replayEngine.load(data, symbol, timeline), []);
  const play = useCallback(() => replayEngine.play(), []);
  const pause = useCallback(() => replayEngine.pause(), []);
  const stop = useCallback(() => replayEngine.stop(), []);
  const step = useCallback(() => replayEngine.step(), []);
  const seek = useCallback((i) => replayEngine.seek(i), []);
  const setSpeed = useCallback((s) => replayEngine.setSpeed(s), []);

  return {
    isPlaying: clockState.isPlaying,
    index: clockState.index,
    speed: clockState.speed,
    length: clockState.length,
    timestamp: clockState.timestamp,
    load,
    play,
    pause,
    stop,
    step,
    seek,
    setSpeed,
  };
}
