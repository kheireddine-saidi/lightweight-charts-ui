/**
 * SessionSnapshot — serialisable / restorable backtest session state.
 *
 * Allows the user to stop a replay at any point and continue later from
 * exactly the same candle, account state, and indicator state.
 *
 * Schema version must be bumped when the snapshot structure changes so
 * that incompatible snapshots are rejected gracefully.
 *
 * No React imports. No chart imports.
 */

/** Increment when the snapshot schema changes in a breaking way. */
export const SNAPSHOT_VERSION = 1;

/**
 * @typedef {{
 *   version: number,
 *   symbol: string,
 *   timeframe: string,
 *   candleIndex: number,
 *   timestamp: number,
 *   account: { balance: number, equity: number },
 *   positions: object[],
 *   pendingOrders: object[],
 *   closedTrades: object[],
 *   indicatorsState: IndicatorState[],
 *   replayState: { speed: number, isPlaying: boolean },
 *   createdAt: string,
 * }} Snapshot
 *
 * @typedef {{ id: string, state: object }} IndicatorState
 */

export class SessionSnapshot {
  /**
   * Create a snapshot from the current engine/clock state.
   *
   * @param {{
   *   symbol: string,
   *   timeframe: string,
   *   clock: import('../replay/SimulationClock').SimulationClock,
   *   execution: import('../trading/ExecutionEngine').ExecutionEngine,
   *   indicators?: import('../../indicators/base/Indicator').Indicator[],
   * }} params
   * @returns {Snapshot}
   */
  static create({ symbol, timeframe, clock, execution, indicators = [] }) {
    const execSnap = execution.getSnapshot();

    const indicatorsState = indicators.map((ind) => ({
      id: ind.id,
      state: SessionSnapshot._serializeIndicator(ind),
    }));

    return {
      version: SNAPSHOT_VERSION,
      symbol,
      timeframe,
      candleIndex: clock.index,
      timestamp: clock.timestamp ?? 0,
      account: {
        balance: execSnap.balance,
        equity: execSnap.equity,
      },
      positions: execSnap.positions,
      pendingOrders: execSnap.pendingOrders,
      closedTrades: execSnap.closedTrades,
      indicatorsState,
      replayState: {
        speed: clock.speed,
        isPlaying: false, // always save as paused
      },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Restore a snapshot into the given engine/clock instances.
   *
   * @param {Snapshot} snapshot
   * @param {{
   *   clock: import('../replay/SimulationClock').SimulationClock,
   *   execution: import('../trading/ExecutionEngine').ExecutionEngine,
   *   indicators?: import('../../indicators/base/Indicator').Indicator[],
   * }} targets
   */
  static restore(snapshot, { clock, execution, indicators = [] }) {
    SessionSnapshot.validate(snapshot); // throws on failure

    execution.restoreSnapshot({
      balance: snapshot.account.balance,
      equity: snapshot.account.equity,
      positions: snapshot.positions,
      pendingOrders: snapshot.pendingOrders,
      closedTrades: snapshot.closedTrades,
    });

    clock.setSpeed(snapshot.replayState.speed);
    clock.seek(snapshot.candleIndex);

    // Restore indicator state
    for (const savedInd of snapshot.indicatorsState) {
      const ind = indicators.find((i) => i.id === savedInd.id);
      if (ind) SessionSnapshot._restoreIndicator(ind, savedInd.state);
    }
  }

  /**
   * Serialise to a JSON string (for localStorage / file download).
   * @param {Snapshot} snapshot
   * @returns {string}
   */
  static serialize(snapshot) {
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Deserialise from a JSON string.
   * @param {string} json
   * @returns {Snapshot}
   */
  static deserialize(json) {
    try {
      const snap = JSON.parse(json);
      SessionSnapshot.validate(snap);
      return snap;
    } catch (err) {
      throw new Error(`SessionSnapshot.deserialize() failed: ${err.message}`);
    }
  }

  /**
   * Validate snapshot structure and version compatibility.
   * @param {unknown} snap
   * @throws {Error} if invalid or incompatible
   */
  static validate(snap) {
    if (!snap || typeof snap !== 'object') {
      throw new Error('Invalid snapshot: not an object.');
    }

    const required = [
      'version', 'symbol', 'timeframe', 'candleIndex',
      'account', 'positions', 'pendingOrders', 'closedTrades',
      'replayState', 'createdAt',
    ];
    for (const key of required) {
      if (!(key in snap)) {
        throw new Error(`Invalid snapshot: missing field "${key}".`);
      }
    }

    if (snap.version !== SNAPSHOT_VERSION) {
      throw new Error(
        `Snapshot version mismatch: expected ${SNAPSHOT_VERSION}, got ${snap.version}. ` +
        'The snapshot was created with an incompatible version of the application.'
      );
    }
  }

  // ─── Indicator serialisation helpers ─────────────────────────────────────

  static _serializeIndicator(ind) {
    // EMA stores _lastEMA and _seedBuffer; SMA stores _window and _sum.
    // Capture whatever enumerable own properties exist.
    const state = {};
    if ('_lastEMA' in ind)     state._lastEMA = ind._lastEMA;
    if ('_seedBuffer' in ind)  state._seedBuffer = [...(ind._seedBuffer ?? [])];
    if ('_window' in ind)      state._window = [...(ind._window ?? [])];
    if ('_sum' in ind)         state._sum = ind._sum;
    state.series = ind.series ? [...ind.series] : [];
    return state;
  }

  static _restoreIndicator(ind, state) {
    if ('_lastEMA' in state)    ind._lastEMA = state._lastEMA;
    if ('_seedBuffer' in state) ind._seedBuffer = state._seedBuffer;
    if ('_window' in state)     ind._window = state._window;
    if ('_sum' in state)        ind._sum = state._sum;
    if ('series' in state)      ind.series = state.series;
  }
}
