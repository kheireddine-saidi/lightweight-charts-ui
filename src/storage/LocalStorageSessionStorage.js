/**
 * LocalStorageSessionStorage — browser localStorage implementation of ISessionStorage.
 *
 * This is the working concrete implementation for the web client.
 * No backend required.
 *
 * Replace with a REST-backed implementation when PostgreSQL is available.
 */
import { ISessionStorage } from './StorageInterfaces';
import { SessionSnapshot } from '../engine/session/SessionSnapshot';

export class LocalStorageSessionStorage extends ISessionStorage {
  /**
   * @param {string} [prefix='lc_snapshot_']  key namespace in localStorage
   */
  constructor(prefix = 'lc_snapshot_') {
    super();
    this._prefix = prefix;
  }

  /**
   * Save a snapshot and return its localStorage key.
   * @param {import('../engine/session/SessionSnapshot').Snapshot} snapshot
   * @returns {Promise<string>}
   */
  async saveSnapshot(snapshot) {
    const key = `${this._prefix}${snapshot.symbol}_${snapshot.timeframe}_${Date.now()}`;
    try {
      localStorage.setItem(key, SessionSnapshot.serialize(snapshot));
    } catch (err) {
      if (err.name === 'QuotaExceededError') {
        throw new Error('LocalStorage quota exceeded. Clear old snapshots or use a backend store.');
      }
      throw err;
    }
    return key;
  }

  /**
   * Load a snapshot by key. Returns null if key not found.
   * @param {string} key
   * @returns {Promise<import('../engine/session/SessionSnapshot').Snapshot | null>}
   */
  async loadSnapshot(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return SessionSnapshot.deserialize(raw);
  }

  /**
   * Delete a snapshot by key.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async deleteSnapshot(key) {
    localStorage.removeItem(key);
  }

  /**
   * List all saved snapshots, newest first.
   * @returns {Promise<{ key: string, symbol: string, timeframe: string, createdAt: string, candleIndex: number }[]>}
   */
  async listSnapshots() {
    const results = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(this._prefix)) continue;
      try {
        const raw = localStorage.getItem(key);
        const snap = JSON.parse(raw);
        results.push({
          key,
          symbol:      snap.symbol,
          timeframe:   snap.timeframe,
          createdAt:   snap.createdAt,
          candleIndex: snap.candleIndex,
        });
      } catch {
        // Skip corrupted entries
      }
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Export a snapshot as a downloadable JSON file.
   * @param {string} key
   */
  async exportToFile(key) {
    const snap = await this.loadSnapshot(key);
    if (!snap) throw new Error(`Snapshot "${key}" not found.`);
    const blob = new Blob([SessionSnapshot.serialize(snap)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `snapshot_${snap.symbol}_${snap.timeframe}_${snap.candleIndex}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Import a snapshot from a JSON file (File object from <input type="file">).
   * @param {File} file
   * @returns {Promise<string>}  saved key
   */
  async importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const snap = SessionSnapshot.deserialize(e.target.result);
          const key  = await this.saveSnapshot(snap);
          resolve(key);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read snapshot file.'));
      reader.readAsText(file);
    });
  }
}

/** Ready-to-use singleton. */
export const localSessionStorage = new LocalStorageSessionStorage();
