import { useEffect } from 'react';

export function useReplaySync(
  isReplayMode: boolean,
  activeChartId: number,
  chartRefs: React.MutableRefObject<Record<number, any>>
) {
  useEffect(() => {
    if (!isReplayMode) {
      // Replay ended on the active chart → restore all follower charts
      Object.entries(chartRefs.current).forEach(([id, ref]) => {
        if (Number(id) !== activeChartId && ref && typeof ref.exitFollowerReplay === 'function') {
          ref.exitFollowerReplay();
        }
      });
      return;
    }

    const syncInterval = setInterval(() => {
      const masterRef = chartRefs.current[activeChartId];
      if (!masterRef || typeof masterRef.getReplayTimestamp !== 'function') return;
      const masterTs = masterRef.getReplayTimestamp();
      if (masterTs === null) return;

      const ltfBars =
        typeof masterRef.getReplayBars === 'function' ? masterRef.getReplayBars() : [];

      Object.entries(chartRefs.current).forEach(([id, ref]) => {
        if (
          Number(id) !== activeChartId &&
          ref &&
          typeof ref.syncToTimestamp === 'function'
        ) {
          ref.syncToTimestamp(masterTs, ltfBars);
        }
      });
    }, 100);

    return () => clearInterval(syncInterval);
  }, [isReplayMode, activeChartId, chartRefs]);
}
