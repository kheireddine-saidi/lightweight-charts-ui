/**
 * Step 0 verification — node scripts/step0_verify.mjs
 * Exercises every Pine primitive, dumps raw ctx.plots shape.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PineTS, Indicator } = require('../node_modules/pinets/dist/pinets.min.cjs');

// 20 bars of synthetic OHLCV
const BASE = 1700000000;
const candles = Array.from({ length: 20 }, (_, i) => ({
  openTime:  BASE + i * 60,
  closeTime: BASE + i * 60 + 59,
  open:   100 + i * 0.5,
  high:   102 + i * 0.5,
  low:     98 + i * 0.5,
  close:  101 + i * 0.5,
  volume: 1000 + i * 10,
}));

// Pine script exercising every primitive
const SOURCE = `//@version=5
indicator("Step0 Verify", overlay=true)

// plot() with different styles
p1 = plot(close, "P-line",      color=color.blue,   style=plot.style_line)
p2 = plot(close - 2, "P-histo", color=color.red,    style=plot.style_histogram)
p3 = plot(close + 2, "P-circ",  color=color.green,  style=plot.style_circles)
p4 = plot(close + 4, "P-step",  color=color.orange, style=plot.style_stepline)
p5 = plot(close + 6, "P-area",  color=color.purple, style=plot.style_area)
p6 = plot(close + 8, "P-col",   color=color.yellow, style=plot.style_columns)

// hline()
h1 = hline(115, "Resistance", color=color.red,   linestyle=hline.style_dashed, linewidth=2)
h2 = hline(90,  "Support",    color=color.green, linestyle=hline.style_solid,  linewidth=1)

// fill() between two plots
fill(p1, p3, color=color.new(color.blue, 80), title="Fill plots")

// fill() between two hlines
fill(h1, h2, color=color.new(color.gray, 90), title="Fill hlines")

// plotshape()
shcond = bar_index % 4 == 0
plotshape(shcond, title="MyShape",  style=shape.triangleup,   location=location.belowbar, color=color.lime,    size=size.small)

// plotchar()
plotchar(shcond, title="MyChar",   char="★",                  location=location.abovebar, color=color.fuchsia, size=size.tiny)

// plotarrow()
plotarrow(shcond ? 1 : 0, title="MyArrow", colorup=color.teal, colordown=color.maroon)

// plotbar()
plotbar(open, high, low, close, title="Bars", color=color.gray)

// plotcandle()
plotcandle(open, high, low, close, title="Candles", color=color.white, wickcolor=color.silver)

// line.new() — bar_index xloc
if bar_index == 10
    line.new(bar_index - 5, low - 1, bar_index, high + 1, color=color.yellow, width=2, xloc=xloc.bar_index)

// box.new() — bar_index xloc
if bar_index == 10
    box.new(bar_index - 3, low - 0.5, bar_index, high + 0.5, border_color=color.red, bgcolor=color.new(color.red, 90), xloc=xloc.bar_index)

// label.new() — bar_index xloc
if bar_index == 10
    label.new(bar_index, high + 2, "HiLabel", color=color.blue, textcolor=color.white, style=label.style_label_down, xloc=xloc.bar_index)

// line.new() — bar_time xloc (different coordinate mode)
if bar_index == 15
    line.new(time - 4 * 60000, low - 2, time, high + 2, color=color.aqua, width=1, xloc=xloc.bar_time)

// linefill.new()
lf1 = line.new(bar_index - 1, low,  bar_index, low  + 0.5, color=color.gray, xloc=xloc.bar_index)
lf2 = line.new(bar_index - 1, high, bar_index, high - 0.5, color=color.gray, xloc=xloc.bar_index)
linefill.new(lf1, lf2, color=color.new(color.gray, 80))

// table.new() + table.cell()
if barstate.islast
    t = table.new(position.top_right, 2, 3, bgcolor=color.new(color.black, 70), border_width=1)
    table.cell(t, 0, 0, "Indicator",  text_color=color.white,  bgcolor=color.new(color.navy, 50))
    table.cell(t, 1, 0, "Step0",      text_color=color.yellow, bgcolor=color.new(color.navy, 50))
    table.cell(t, 0, 1, "Close",      text_color=color.white)
    table.cell(t, 1, 1, str.tostring(math.round(close, 2)), text_color=color.lime)
    table.cell(t, 0, 2, "Bar",        text_color=color.white)
    table.cell(t, 1, 2, str.tostring(bar_index), text_color=color.lime)
`;

async function main() {
  const pine = new PineTS(candles);
  const indicator = new Indicator(SOURCE, {});

  let ctx;
  try {
    ctx = await pine.run(indicator);
  } catch (err) {
    console.error('Run error:', err?.message ?? err);
    process.exit(1);
  }

  const plots = ctx.plots ?? {};

  // ── 1. All top-level keys ──────────────────────────────────────────────────
  console.log('\n=== ALL ctx.plots KEYS ===');
  console.log(Object.keys(plots));

  // ── 2. Quick summary table ─────────────────────────────────────────────────
  console.log('\n=== SUMMARY (key → style, data length) ===');
  for (const [k, v] of Object.entries(plots)) {
    const style   = v?.options?.style ?? '(no style)';
    const dataLen = Array.isArray(v?.data) ? v.data.length : typeof v;
    console.log(`  ${k.padEnd(30)} style=${String(style).padEnd(20)} dataLen=${dataLen}`);
  }

  // ── 3. Regular plots: first data point in full ─────────────────────────────
  const SPECIAL = new Set(['__lines__', '__boxes__', '__labels__', '__polylines__', '__linefills__', '__tables__']);
  console.log('\n=== REGULAR PLOTS — detailed ===');
  for (const [k, v] of Object.entries(plots)) {
    if (SPECIAL.has(k)) continue;
    console.log(`\n-- ${k} --`);
    console.log('  options:', JSON.stringify(v?.options));
    console.log('  title:', v?.title);
    if (v?.data?.length > 0) {
      console.log('  data[0] (full):', JSON.stringify(v.data[0], null, 2));
    }
  }

  // ── 4. Each special collection in full ─────────────────────────────────────
  for (const key of ['__lines__', '__boxes__', '__labels__', '__polylines__', '__linefills__', '__tables__']) {
    const val = plots[key];
    console.log(`\n${'='.repeat(60)}`);
    console.log(`=== ${key} ===`);
    if (val === undefined || val === null) {
      console.log('NOT PRESENT');
      continue;
    }
    console.log('typeof:', typeof val, '| isArray:', Array.isArray(val));
    console.log('top-level keys:', Object.keys(val));

    // pinets wraps collections in { data: [{value: <actual object>}] }
    if (val?.data) {
      console.log('data.length:', val.data.length);
      for (let i = 0; i < Math.min(val.data.length, 3); i++) {
        console.log(`  data[${i}]:`, JSON.stringify(val.data[i], null, 2));
      }
    } else {
      // Maybe it's a plain object with entries
      const entries = Object.entries(val);
      console.log('entries count:', entries.length);
      for (const [ek, ev] of entries.slice(0, 3)) {
        console.log(`  [${ek}]:`, JSON.stringify(ev, null, 2)?.slice(0, 800));
      }
    }
  }
}

main().catch(console.error);
