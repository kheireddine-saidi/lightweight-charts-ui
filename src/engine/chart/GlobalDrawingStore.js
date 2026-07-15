/**
 * GlobalDrawingStore — symbol-keyed registry of drawing definitions.
 * Re-entrancy guard: notifications are suppressed while _applying is true,
 * preventing the infinite loop where applying a drawing triggers a save
 * which triggers another apply.
 */

const _store     = new Map();   // symbol → Map<syncId, drawingDef>
const _listeners = new Set();
let   _applying  = false;       // re-entrancy guard

function _getOrCreate(symbol) {
  if (!_store.has(symbol)) _store.set(symbol, new Map());
  return _store.get(symbol);
}

function _notify() {
  if (_applying) return;  // prevent re-entrant notification loops
  _applying = true;
  try {
    _listeners.forEach(fn => { try { fn(); } catch { /**/ } });
  } finally {
    _applying = false;
  }
}

export const GlobalDrawingStore = {
  set(symbol, def) {
    _getOrCreate(symbol).set(def.syncId, def);
    _notify();
  },

  delete(symbol, syncId) {
    const map = _store.get(symbol);
    if (map) { map.delete(syncId); _notify(); }
  },

  getAll(symbol) {
    return Array.from(_store.get(symbol)?.values() ?? []);
  },

  get(symbol, syncId) {
    return _store.get(symbol)?.get(syncId) ?? null;
  },

  subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};
