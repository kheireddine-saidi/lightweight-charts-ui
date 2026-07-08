/**
 * GlobalReplayControls — single replay control box, rendered once at ChartGrid level.
 *
 * All replay actions are delegated to the MASTER chart (the one that initiated replay),
 * not the currently active chart. This means clicking a different chart during replay
 * doesn't break playback.
 */
import React, { useEffect, useCallback, useRef } from 'react';
import ReplayControls from './ReplayControls';
import { useReplayEngine } from '../../engine/replay/useReplayEngine';
import { EventBus, Events } from '../../core/EventBus';

const GlobalReplayControls = ({
  isReplayMode,
  masterChartIdRef,   // ref tracking the chart that initiated replay
  chartRefs,
}) => {
  const {
    isPlaying,
    speed: replaySpeed,
    play: replayPlay,
    pause: replayPause,
    step: replayStep,
    setSpeed: replaySetSpeed,
    stop: replayStop,
  } = useReplayEngine();

  // Local ref so callbacks always read the latest value without re-creating
  const isReplayModeRef = useRef(isReplayMode);
  useEffect(() => { isReplayModeRef.current = isReplayMode; }, [isReplayMode]);

  /** Always target the master chart, not the currently active one. */
  const getMasterRef = useCallback(() => {
    const id = masterChartIdRef?.current;
    if (id == null) return null;
    return chartRefs.current?.[id] ?? null;
  }, [masterChartIdRef, chartRefs]);

  // Sync follower charts on every CANDLE event during replay
  useEffect(() => {
    if (!isReplayMode) return;

    const unsub = EventBus.on(Events.CANDLE, () => {
      const masterId = masterChartIdRef?.current;
      const masterRef = masterId != null ? chartRefs.current?.[masterId] : null;
      if (!masterRef || typeof masterRef.getReplayTimestamp !== 'function') return;

      const masterTs = masterRef.getReplayTimestamp();
      if (masterTs === null) return;

      const ltfBars = typeof masterRef.getReplayBars === 'function'
        ? masterRef.getReplayBars()
        : [];

      Object.entries(chartRefs.current).forEach(([id, ref]) => {
        if (Number(id) !== masterId && ref && typeof ref.syncToTimestamp === 'function') {
          ref.syncToTimestamp(masterTs, ltfBars);
        }
      });
    });

    return unsub;
  }, [isReplayMode, masterChartIdRef, chartRefs]);

  // ── Action handlers — all target the MASTER chart ──────────────────────

  const handlePlayPause = useCallback(() => {
    const masterRef = getMasterRef();
    if (!masterRef) return;
    if (isPlaying) {
      if (typeof masterRef.stepReplay === 'function') {
        // use the controller's pause via stepReplay's peer
        const ctrl = masterRef.replayController;
        ctrl ? ctrl.pause() : replayPause();
      } else {
        replayPause();
      }
    } else {
      const ctrl = masterRef.replayController;
      ctrl ? ctrl.play() : replayPlay();
    }
  }, [isPlaying, getMasterRef, replayPlay, replayPause]);

  const handleForward = useCallback(() => {
    const masterRef = getMasterRef();
    if (masterRef && typeof masterRef.stepReplay === 'function') {
      masterRef.stepReplay();
    } else {
      replayStep();
    }
  }, [getMasterRef, replayStep]);

  const handleJumpTo = useCallback(() => {
    // Enter "Jump to timestamp" selection mode on the master chart
    const masterRef = getMasterRef();
    if (masterRef && typeof masterRef.startJumpTo === 'function') {
      masterRef.startJumpTo();
    }
    // Also tell all follower charts to show full data so the time range is visible
    const masterId = masterChartIdRef?.current;
    Object.entries(chartRefs.current ?? {}).forEach(([id, ref]) => {
      if (Number(id) !== masterId && ref && typeof ref.startFollowerJumpTo === 'function') {
        ref.startFollowerJumpTo();
      }
    });
  }, [getMasterRef, masterChartIdRef, chartRefs]);

  const handleSpeedChange = useCallback((s) => {
    const masterRef = getMasterRef();
    if (masterRef && typeof masterRef.setReplaySpeed === 'function') {
      masterRef.setReplaySpeed(s);
    } else {
      replaySetSpeed(s);
    }
  }, [getMasterRef, replaySetSpeed]);

  const handleClose = useCallback(() => {
    const masterRef = getMasterRef();
    if (masterRef && typeof masterRef.toggleReplay === 'function') {
      masterRef.toggleReplay();
    } else {
      replayStop();
    }
    // REPLAY_EXIT broadcast is emitted by handleReplayClick in useWorkspaceState
  }, [getMasterRef, replayStop]);

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
