// hooks/useReplay.ts
import { useEffect, useRef } from 'react';
import { createReplayController } from '@getcandlekit/charts';

export const useReplay = (chart: any, data: any[]) => {
  const replayRef = useRef(null);

  useEffect(() => {
    if (!chart) return;
    
    const replay = createReplayController();
    replay.onBar((bar) => {
      chart.updateBar(bar);
    });
    
    replay.load({
      id: 'simulation',
      series: [{ symbol: 'EURUSD', interval: '1m' }],
      start: data[0]?.time,
      end: data[data.length - 1]?.time,
    });
    
    replayRef.current = replay;
    
    return () => replay.destroy();
  }, [chart, data]);

  return replayRef.current;
};