/**
 * LocalStorageSettingsStorage — browser localStorage implementation of ISettingsStorage.
 *
 * Stores all execution settings as a single JSON blob under one key.
 * No backend required.
 */
import { ISettingsStorage } from './StorageInterfaces';

const STORAGE_KEY = 'tv_execution_settings';

export class LocalStorageSettingsStorage extends ISettingsStorage {
  /**
   * Load persisted settings. Returns null if nothing is stored yet.
   * @returns {Promise<object | null>}
   */
  async loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Persist settings as a single JSON blob.
   * @param {object} settings
   * @returns {Promise<void>}
   */
  async saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      if (err.name === 'QuotaExceededError') {
        console.warn('[LocalStorageSettingsStorage] localStorage quota exceeded.');
      }
      // Non-fatal — settings will revert to defaults on next load, but don't crash.
    }
  }
}

/** Ready-to-use singleton. */
export const localStorageSettingsStorage = new LocalStorageSettingsStorage();
