/**
 * useReplayEngine — React hook wrapping the singleton ReplayEngine.
 *
 * Subscribes to EventBus REPLAY_STATE events so the component tree
 * re-renders only when the clock state changes (not on every candle).
 * The underlying SimulationClock is never recreated across renders.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { replayEngine } from './ReplayEngine';
import { EventBus, Events } from '../../core/EventBus';

export function useReplayEngine() {
  const [clockState, setClockState] = useState(() => replayEngine.state);

  // Keep clock state in sync via EventBus (no polling, no stale closure)
  useEffect(() => {
    const unsub = EventBus.on(Events.REPLAY_STATE, setClockState);
    return unsub;
  }, []);

  const load = useCallback((data) => replayEngine.load(data), []);
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
