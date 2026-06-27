/**
 * useReplaySync — synchronises follower charts to the master chart during replay.
 *
 * Replaces the previous 100 ms polling interval with a direct EventBus
 * CANDLE subscription so follower charts update immediately on every
 * candle emission regardless of playback speed.
 */
import { useEffect } from 'react';
import { EventBus, Events } from '../../core/EventBus';

export function useReplaySync(
  isReplayMode: boolean,
  activeChartId: number,
  chartRefs: React.MutableRefObject<Record<number, any>>
) {
  useEffect(() => {
    if (!isReplayMode) {
      // Replay ended — restore all follower charts to live data
      Object.entries(chartRefs.current).forEach(([id, ref]) => {
        if (Number(id) !== activeChartId && ref && typeof ref.exitFollowerReplay === 'function') {
          ref.exitFollowerReplay();
        }
      });
      return;
    }

    // Subscribe to every candle emitted by the master replay clock.
    // Followers receive the timestamp immediately — no polling lag.
    const unsub = EventBus.on(Events.CANDLE, () => {
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
    });

    return unsub;
  }, [isReplayMode, activeChartId, chartRefs]);
}
