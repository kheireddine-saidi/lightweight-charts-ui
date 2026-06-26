import { useRef, useState, useCallback } from 'react';
import { ReplayEngine } from './ReplayEngine';
export function useReplayEngine({ onTick, onEnd } = {}) {
  const engineRef = useRef(null); const [isPlaying, setIsPlaying] = useState(false);
  const [index, setIndex] = useState(0); const [speed, setSpeedState] = useState(1);
  const getEngine = useCallback(() => { if (!engineRef.current) { engineRef.current = new ReplayEngine({ onTick, onEnd: () => { setIsPlaying(false); if (onEnd) onEnd(); }, onIndexChange: setIndex }); } return engineRef.current; }, [onTick, onEnd]);
  const load = useCallback((data) => { getEngine().load(data); setIndex(0); setIsPlaying(false); }, [getEngine]);
  const play = useCallback(() => { getEngine().play(); setIsPlaying(true); }, [getEngine]);
  const pause = useCallback(() => { getEngine().pause(); setIsPlaying(false); }, [getEngine]);
  const seek = useCallback((i) => { getEngine().seek(i); }, [getEngine]);
  const setSpeed = useCallback((s) => { getEngine().setSpeed(s); setSpeedState(s); }, [getEngine]);
  const stop = useCallback(() => { getEngine().stop(); setIsPlaying(false); setIndex(0); }, [getEngine]);
  return { isPlaying, index, speed, load, play, pause, seek, setSpeed, stop };
}
