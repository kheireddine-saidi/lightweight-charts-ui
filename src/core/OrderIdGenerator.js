/**
 * OrderIdGenerator — generates sequential human-readable order IDs.
 *
 * IDs are incremental and persist across page reloads via localStorage.
 * Format: ORD-1, ORD-2, ..., ORD-N
 */

const STORAGE_KEY = 'tv_order_id_counter';

class OrderIdGeneratorClass {
  constructor() {
    const saved = parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10);
    this._counter = Number.isFinite(saved) && saved > 0 ? saved : 0;
  }

  /**
   * Generate the next unique order ID.
   * @returns {string}  e.g. "ORD-1", "ORD-2"
   */
  next() {
    this._counter += 1;
    try {
      localStorage.setItem(STORAGE_KEY, String(this._counter));
    } catch (_) { /* ignore storage errors */ }
    return `ORD-${this._counter}`;
  }

  /** Current counter value (read-only). */
  get current() {
    return this._counter;
  }

  /** Reset counter — call only in tests or on user request. */
  reset() {
    this._counter = 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
  }
}

export const orderIdGenerator = new OrderIdGeneratorClass();
