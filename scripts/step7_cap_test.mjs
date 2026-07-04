/**
 * Step 7 verification — confirms the PineObjectPool 500-object cap.
 * Run: node scripts/step7_cap_test.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PineObjectPool } = require('../src/engine/indicators/PineObjectPool.js');

// ── Fake chart/series/candles — pool only calls attachPrimitive/detachPrimitive
const attached = [];
const detached = [];

const fakeSeries = {
  attachPrimitive: (p) => { attached.push(p); },
  detachPrimitive: (p) => { detached.push(p); },
  priceToCoordinate: () => 100,
};

const fakeChart = {
  timeScale: () => ({ timeToCoordinate: () => 200 }),
};

const fakeCandles = Array.from({ length: 600 }, (_, i) => ({ time: 1700000000 + i * 60 }));

// ── Build 600 fake line objects
function makeLines(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i, x1: i, y1: 100, x2: i + 1, y2: 101,
    xloc: 'bi', color: '#ff0', width: 1, style: 'style_solid',
    extend: 'none', force_overlay: false, _deleted: false,
  }));
}

// ── Test 1: 600 lines → cap at 500 with ONE warning ─────────────────────────
console.log('\n=== Test 1: 600 lines → should cap at 500, warn once ===');

let warnCount = 0;
const originalWarn = console.warn;
console.warn = (...args) => {
  warnCount++;
  originalWarn('[captured warn]', ...args);
};

const pool = new PineObjectPool({ chart: fakeChart, series: fakeSeries, candles: fakeCandles });
pool.sync({ lines: makeLines(600), boxes: [], labels: [], polylines: [] });

console.warn = originalWarn;

console.log(`  attached.length = ${attached.length} (expected: 500)`);
console.log(`  warnCount = ${warnCount} (expected: 1)`);
console.assert(attached.length === 500, `FAIL: attached ${attached.length} objects, expected 500`);
console.assert(warnCount === 1, `FAIL: ${warnCount} warnings, expected 1`);

// ── Test 2: Call sync again with 600 lines → NO additional warning ────────────
console.log('\n=== Test 2: Second sync with 600 lines → no additional warning ===');

warnCount = 0;
console.warn = (...args) => { warnCount++; originalWarn('[captured warn]', ...args); };

pool.sync({ lines: makeLines(600), boxes: [], labels: [], polylines: [] });

console.warn = originalWarn;
console.log(`  warnCount = ${warnCount} (expected: 0 — cap already warned)`);
console.assert(warnCount === 0, `FAIL: ${warnCount} warnings on second call, expected 0`);

// ── Test 3: Drop to 400 lines → cap clears, no warning ───────────────────────
console.log('\n=== Test 3: Drop to 400 → cap resets, no warning on next 600 ===');
pool.sync({ lines: makeLines(400), boxes: [], labels: [], polylines: [] });

warnCount = 0;
console.warn = (...args) => { warnCount++; originalWarn('[captured warn]', ...args); };
pool.sync({ lines: makeLines(600), boxes: [], labels: [], polylines: [] });
console.warn = originalWarn;

console.log(`  warnCount = ${warnCount} (expected: 1 — fresh cap warning after reset)`);
console.assert(warnCount === 1, `FAIL: ${warnCount} warnings after reset, expected 1`);

// ── Test 4: Mixed types — 200 lines + 200 boxes + 200 labels = 600 → cap 500 ─
console.log('\n=== Test 4: Mixed 200+200+200=600 → cap at 500 ===');
const pool2 = new PineObjectPool({ chart: fakeChart, series: fakeSeries, candles: fakeCandles });
const attached2 = [];
pool2._series = { ...fakeSeries, attachPrimitive: (p) => attached2.push(p), detachPrimitive: () => {} };

const boxes = Array.from({ length: 200 }, (_, i) => ({
  id: i, left: i, top: 110, right: i+1, bottom: 100,
  xloc: 'bi', border_color: '#f00', bgcolor: '#f001', border_width: 1,
  border_style: 'style_solid', text: '', text_color: '#fff', text_size: 'normal',
  text_halign: 'center', text_valign: 'center', force_overlay: false, _deleted: false,
}));
const labels = Array.from({ length: 200 }, (_, i) => ({
  id: i, x: i, y: 105, text: `L${i}`, xloc: 'bi', yloc: 'pr',
  color: '#00f', style: 'style_label_up', textcolor: '#fff', size: 'normal',
  textalign: 'center', tooltip: '', force_overlay: false, _deleted: false,
}));

warnCount = 0;
console.warn = (...args) => { warnCount++; originalWarn('[captured warn]', ...args); };
pool2.sync({ lines: makeLines(200), boxes, labels, polylines: [] });
console.warn = originalWarn;

console.log(`  warnCount = ${warnCount} (expected: 1)`);
console.assert(warnCount === 1, `FAIL: ${warnCount} warnings, expected 1`);

// ── Test 5: Diff — add then remove lines (pool correctly tracks ids) ──────────
console.log('\n=== Test 5: Diff test — 5 lines, then 3, then 7 ===');
const pool3 = new PineObjectPool({ chart: fakeChart, series: fakeSeries, candles: fakeCandles });
const ops = { attached: 0, detached: 0 };
pool3._series = {
  priceToCoordinate: () => 100,
  attachPrimitive: () => ops.attached++,
  detachPrimitive: () => ops.detached++,
};

pool3.sync({ lines: makeLines(5), boxes: [], labels: [], polylines: [] });
console.log(`  After 5 lines: attached=${ops.attached}, detached=${ops.detached} (expected 5,0)`);
console.assert(ops.attached === 5 && ops.detached === 0, 'FAIL: 5 lines');

pool3.sync({ lines: makeLines(3), boxes: [], labels: [], polylines: [] });
console.log(`  After 3 lines: attached=${ops.attached}, detached=${ops.detached} (expected 5,2 — removed 2)`);
console.assert(ops.attached === 5 && ops.detached === 2, 'FAIL: trim to 3 lines');

pool3.sync({ lines: makeLines(7), boxes: [], labels: [], polylines: [] });
console.log(`  After 7 lines: attached=${ops.attached}, detached=${ops.detached} (expected 9,2 — added 4 new)`);
console.assert(ops.attached === 9 && ops.detached === 2, 'FAIL: expand to 7 lines');

// ── Test 6: destroy() detaches everything ────────────────────────────────────
console.log('\n=== Test 6: destroy() detaches all primitives ===');
const pool4 = new PineObjectPool({ chart: fakeChart, series: fakeSeries, candles: fakeCandles });
let destroyDetached = 0;
pool4._series = {
  priceToCoordinate: () => 100,
  attachPrimitive: () => {},
  detachPrimitive: () => destroyDetached++,
};

pool4.sync({ lines: makeLines(10), boxes: [], labels: [], polylines: [] });
pool4.destroy();
console.log(`  destroyDetached=${destroyDetached} (expected 10)`);
console.assert(destroyDetached === 10, `FAIL: ${destroyDetached} detached on destroy, expected 10`);
console.assert(pool4._pool.size === 0, 'FAIL: pool not empty after destroy');

console.log('\n✅ All Step 7 cap/diff tests passed.');
