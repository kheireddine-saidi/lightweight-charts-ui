/**
 * GlobalReplayControls — single replay control box rendered once at the ChartGrid level.
 *
 * Issue 3 fix: previously ReplayControls was rendered inside each ChartComponent,
 * producing one control box per chart. Now a single instance lives at the top of the
 * grid and delegates all replay actions to the active chart's imperative handle.
 *
 * "Jump to timestamp" is synchronised across ALL visible charts: when the user
 * selects a new replay point on any chart, every other chart in the grid jumps to
 * the same timestamp via its syncToTimestamp() imperative method.
 */
import React, { useEffect, useCallback } from 'react';
import ReplayControls from './ReplayControls';
import { useReplayEngine } from '../../engine/replay/useReplayEngine';
import { EventBus, Events } from '../../core/EventBus';

/**
 * @param {{
 *   isReplayMode: boolean;
 *   activeChartId: string | number;
 *   chartRefs: React.MutableRefObject<Record<string|number, any>>;
 * }} props
 */
const GlobalReplayControls = ({ isReplayMode, activeChartId, chartRefs }) => {
  const {
    isPlaying,
    speed: replaySpeed,
    play: replayPlay,
    pause: replayPause,
    step: replayStep,
    setSpeed: replaySetSpeed,
    stop: replayStop,
  } = useReplayEngine();

  /** Get the imperative handle for the active (master) chart. */
  const getActiveRef = useCallback(() => {
    return chartRefs.current?.[activeChartId] ?? null;
  }, [chartRefs, activeChartId]);

  /**
   * Synchronise a timestamp change to ALL charts.
   * Called after the user selects a new replay point so that every visible
   * chart jumps to the same position.
   */
  const syncAllChartsToTimestamp = useCallback((timestamp) => {
    if (!chartRefs.current) return;
    Object.entries(chartRefs.current).forEach(([id, ref]) => {
      if (!ref) return;
      const numId = Number(id);
      if (numId === activeChartId) return; // master already handled by its own handler
      if (typeof ref.syncToTimestamp === 'function') {
        const masterRef = getActiveRef();
        const ltfBars = masterRef && typeof masterRef.getReplayBars === 'function'
          ? masterRef.getReplayBars()
          : [];
        ref.syncToTimestamp(timestamp, ltfBars);
      }
    });
  }, [chartRefs, activeChartId, getActiveRef]);

  // Listen for CANDLE events so follower charts stay in sync during playback.
  // (This mirrors the logic in useReplaySync but is now co-located here.)
  useEffect(() => {
    if (!isReplayMode) return;

    const unsub = EventBus.on(Events.CANDLE, () => {
      const masterRef = getActiveRef();
      if (!masterRef) return;
      const masterTs = typeof masterRef.getReplayTimestamp === 'function'
        ? masterRef.getReplayTimestamp()
        : null;
      if (masterTs === null) return;
      syncAllChartsToTimestamp(masterTs);
    });

    return unsub;
  }, [isReplayMode, getActiveRef, syncAllChartsToTimestamp]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handlePlayPause = useCallback(() => {
    const ctrl = getActiveRef()?.replayController;
    if (isPlaying) {
      ctrl ? ctrl.pause() : replayPause();
    } else {
      ctrl ? ctrl.play() : replayPlay();
    }
  }, [isPlaying, getActiveRef, replayPlay, replayPause]);

  const handleForward = useCallback(() => {
    // Delegate step to the active chart's controller
    const activeRef = getActiveRef();
    if (activeRef && typeof activeRef.stepReplay === 'function') {
      activeRef.stepReplay();
    } else {
      replayStep();
    }
  }, [getActiveRef, replayStep]);

  const handleJumpTo = useCallback(() => {
    // Tell the active chart to enter "selecting replay point" mode.
    // After the user clicks a bar, the chart calls back which triggers
    // syncAllChartsToTimestamp via the CANDLE event.
    const activeRef = getActiveRef();
    if (activeRef && typeof activeRef.startJumpTo === 'function') {
      activeRef.startJumpTo();
    }
  }, [getActiveRef]);

  const handleSpeedChange = useCallback((s) => {
    const activeRef = getActiveRef();
    if (activeRef && typeof activeRef.setReplaySpeed === 'function') {
      activeRef.setReplaySpeed(s);
    } else {
      replaySetSpeed(s);
    }
  }, [getActiveRef, replaySetSpeed]);

  const handleClose = useCallback(() => {
    // Exit replay on the active chart
    const activeRef = getActiveRef();
    if (activeRef && typeof activeRef.toggleReplay === 'function') {
      activeRef.toggleReplay();
    } else {
      replayStop();
    }

    // Exit follower replay on all other charts
    if (chartRefs.current) {
      Object.entries(chartRefs.current).forEach(([id, ref]) => {
        if (Number(id) !== activeChartId && ref && typeof ref.exitFollowerReplay === 'function') {
          ref.exitFollowerReplay();
        }
      });
    }
  }, [getActiveRef, replayStop, chartRefs, activeChartId]);

  if (!isReplayMode) return null;

  return (
    <ReplayControls
      isPlaying={isPlaying}
      speed={replaySpeed}
      onPlayPause={handlePlayPause}
      onForward={handleForward}
      onJumpTo={handleJumpTo}
      onSpeedChange={handleSpeedChange}
      onClose={handleClose}
    />
  );
};

export default GlobalReplayControls;
