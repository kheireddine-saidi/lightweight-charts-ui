// stores/executionSettingsStore.ts
//
// Read-only Zustand mirror of ExecutionSettings.
// Subscribes to EventBus SETTINGS_CHANGED so React components re-render
// when settings change, without polling or prop-drilling.
//
// Write path:  UI → executionSettingsStore.updateSettings(partial)
//                       → executionSettings.update(partial)
//                       → EventBus.emit(SETTINGS_CHANGED)
//                       → this store syncs itself
// Read path:   Components → useExecutionSettingsStore (Zustand selectors)

import { create } from 'zustand';
import { EventBus, Events } from '../core/EventBus';
import { executionSettings } from '../engine/trading/ExecutionSettings';

// Module-level guard: prevents duplicate EventBus subscriptions on HMR reloads.
let _settingsBusSubscribed = false;

interface SettingsState {
  riskPerTradePercent: number;
  slippage: { model: string; value: number };
  fees: { makerPercent: number; takerPercent: number };
  funding: { ratePercent: number; intervalHours: number };

  // Write method — delegates to executionSettings singleton
  updateSettings: (partial: Partial<ReturnType<typeof executionSettings.getAll>>) => void;
}

export const useExecutionSettingsStore = create<SettingsState>((set) => {
  if (!_settingsBusSubscribed) {
    _settingsBusSubscribed = true;
    EventBus.on(Events.SETTINGS_CHANGED, ({ settings }: { settings: ReturnType<typeof executionSettings.getAll> }) => {
      set({
        riskPerTradePercent: settings.riskPerTradePercent,
        slippage:            settings.slippage,
        fees:                settings.fees,
        funding:             settings.funding,
      });
    });
  }

  const initial = executionSettings.getAll();

  return {
    riskPerTradePercent: initial.riskPerTradePercent,
    slippage:            initial.slippage,
    fees:                initial.fees,
    funding:             initial.funding,

    updateSettings: (partial) => {
      executionSettings.update(partial);
      // The SETTINGS_CHANGED event emitted by executionSettings.update() will
      // drive the set() call above — no need to set() here directly.
    },
  };
});
