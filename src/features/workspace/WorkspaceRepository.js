/**
 * WorkspaceRepository — persists workspace layout and interval preferences.
 *
 * Owns all localStorage keys for the workspace feature. WorkspaceStore calls
 * this instead of touching localStorage directly, so the persistence layer is
 * swappable (backend API, IndexedDB, etc.) without changing store logic.
 *
 * Mirrors the pattern established by TradeJournalRepository.ts.
 */

// ── Storage keys (all in one place for easy auditing) ─────────────────────

const KEYS = {
  savedLayout:        'tv_saved_layout',
  interval:           'tv_interval',
  favIntervals:       'tv_fav_intervals_v2',
  customIntervals:    'tv_custom_intervals',
  lastNonFavInterval: 'tv_last_nonfav_interval',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.warn(`[WorkspaceRepository] localStorage write failed for key: ${key}`);
  }
}

function loadString(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveString(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    console.warn(`[WorkspaceRepository] localStorage write failed for key: ${key}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export const WorkspaceRepository = {
  // ── Layout ──────────────────────────────────────────────────────────────

  /** Load the persisted layout snapshot ({layout, charts}), or null if none. */
  loadSavedLayout() {
    return loadJSON(KEYS.savedLayout, null);
  },

  /** Persist the current layout + charts snapshot. */
  saveLayout(layout, charts) {
    saveJSON(KEYS.savedLayout, { layout, charts });
  },

  // ── Interval ────────────────────────────────────────────────────────────

  /** Load the last active interval (e.g. '1d'). */
  loadInterval(fallback = '1d') {
    return loadString(KEYS.interval, fallback);
  },

  /** Persist the active interval string. */
  saveInterval(interval) {
    saveString(KEYS.interval, interval);
  },

  /** Load the last non-favourite interval (used for toggle-back behaviour). */
  loadLastNonFavInterval() {
    return loadString(KEYS.lastNonFavInterval, null);
  },

  /** Persist the last non-favourite interval. */
  saveLastNonFavInterval(interval) {
    saveString(KEYS.lastNonFavInterval, interval);
  },

  // ── Favourite intervals ─────────────────────────────────────────────────

  /** Load the array of favourite interval strings. */
  loadFavouriteIntervals(fallback = null) {
    return loadJSON(KEYS.favIntervals, fallback);
  },

  /** Persist the favourite intervals array. */
  saveFavouriteIntervals(intervals) {
    saveJSON(KEYS.favIntervals, intervals);
  },

  // ── Custom intervals ────────────────────────────────────────────────────

  /** Load the array of custom interval objects. */
  loadCustomIntervals(fallback = []) {
    return loadJSON(KEYS.customIntervals, fallback);
  },

  /** Persist the custom intervals array. */
  saveCustomIntervals(intervals) {
    saveJSON(KEYS.customIntervals, intervals);
  },
};
