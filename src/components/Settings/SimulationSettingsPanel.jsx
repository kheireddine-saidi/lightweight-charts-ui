import React from 'react';
import styles from './SimulationSettingsPanel.module.css';
import { useExecutionSettingsStore } from '../../stores/executionSettingsStore';

const SimulationSettingsPanel = () => {
  const {
    riskPerTradePercent,
    slippage,
    fees,
    funding,
    updateSettings,
  } = useExecutionSettingsStore();

  const handleRiskChange = (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0 && val <= 100) {
      updateSettings({ riskPerTradePercent: val });
    }
  };

  const handleSlippageChange = (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0) {
      updateSettings({ slippage: { ...slippage, value: val } });
    }
  };

  const handleMakerFeeChange = (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0) {
      updateSettings({ fees: { ...fees, makerPercent: val } });
    }
  };

  const handleTakerFeeChange = (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0) {
      updateSettings({ fees: { ...fees, takerPercent: val } });
    }
  };

  const handleFundingRateChange = (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      updateSettings({ funding: { ...funding, ratePercent: val } });
    }
  };

  const handleFundingIntervalChange = (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      updateSettings({ funding: { ...funding, intervalHours: val } });
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Simulation Settings</span>
      </div>

      {/* ── Active: Risk per trade ── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Risk Management</div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="riskPerTrade">
            Risk per trade
          </label>
          <div className={styles.inputRow}>
            <input
              id="riskPerTrade"
              className={styles.input}
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={riskPerTradePercent}
              onChange={handleRiskChange}
            />
            <span className={styles.suffix}>%</span>
          </div>
          <span className={styles.hint}>
            Position size is auto-calculated so loss at SL = this % of balance.
          </span>
        </div>
      </div>

      {/* ── Placeholders: Execution simulation ── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Execution simulation
          <span className={styles.comingSoon}>coming soon</span>
        </div>
        <p className={styles.placeholderNote}>
          These values are saved and will be applied to simulated fills in a future update.
          They currently have <strong>no effect</strong> on fill prices, PnL, or equity.
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="slippage">
            Slippage
          </label>
          <div className={styles.inputRow}>
            <input
              id="slippage"
              className={styles.input}
              type="number"
              min="0"
              step="0.01"
              value={slippage?.value ?? 0}
              onChange={handleSlippageChange}
            />
            <span className={styles.suffix}>%</span>
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="makerFee">
              Maker fee
            </label>
            <div className={styles.inputRow}>
              <input
                id="makerFee"
                className={styles.input}
                type="number"
                min="0"
                step="0.001"
                value={fees?.makerPercent ?? 0}
                onChange={handleMakerFeeChange}
              />
              <span className={styles.suffix}>%</span>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="takerFee">
              Taker fee
            </label>
            <div className={styles.inputRow}>
              <input
                id="takerFee"
                className={styles.input}
                type="number"
                min="0"
                step="0.001"
                value={fees?.takerPercent ?? 0}
                onChange={handleTakerFeeChange}
              />
              <span className={styles.suffix}>%</span>
            </div>
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="fundingRate">
              Funding rate
            </label>
            <div className={styles.inputRow}>
              <input
                id="fundingRate"
                className={styles.input}
                type="number"
                step="0.001"
                value={funding?.ratePercent ?? 0}
                onChange={handleFundingRateChange}
              />
              <span className={styles.suffix}>%</span>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="fundingInterval">
              Interval
            </label>
            <div className={styles.inputRow}>
              <input
                id="fundingInterval"
                className={styles.input}
                type="number"
                min="1"
                step="1"
                value={funding?.intervalHours ?? 8}
                onChange={handleFundingIntervalChange}
              />
              <span className={styles.suffix}>h</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimulationSettingsPanel;
