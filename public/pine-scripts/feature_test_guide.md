# Pine Script Feature Test — `feature_test.pine`

Paste the contents of `feature_test.pine` into the indicator editor to exercise every
rendering primitive the PineTS integration supports. Below is a section-by-section
breakdown of what to look for on the chart.

---

## Inputs

| Input | Default | What it controls |
|---|---|---|
| Show Lines | ✅ | `line.new()` swing high/low trendlines |
| Show Boxes | ✅ | `box.new()` Bollinger Band range box + squeeze box |
| Show Labels | ✅ | `label.new()` on crosses + live price label |
| Show Fills | ✅ | `fill()` between BB bands and between RSI hlines |
| Show HLines | ✅ | `hline()` at RSI 70 / 50 / 30 |
| Show Shapes | ✅ | `plotshape()` triangles on EMA crosses, squares/circles on RSI extremes |
| Show Chars | ✅ | `plotchar()` ★ on bull cross, ↓ on bear cross |
| Show Arrows | ✅ | `plotarrow()` driven by RSI deviation from 50 |
| Show Bar Overlay | ❌ | `plotbar()` shifted up by 2×ATR |
| Show Candle Overlay | ❌ | `plotcandle()` shifted down by 2×ATR |
| Show Table | ✅ | `table.new()` live dashboard top-right |
| Show Linefill | ✅ | `linefill.new()` between EMA 8 and EMA 21 each bar |
| MA Length | 20 | Bollinger Band / SMA period |
| BB StdDev | 2.0 | Bollinger Band multiplier |

---

## What to verify on the chart

### 1. `plot()` — line / stepline / histogram / circles / area
- **White semi-transparent line** — BB middle (SMA 20), `style_line`
- **Teal lines** — BB upper and lower, `style_line`
- **Yellow stepped line** — EMA 8, `style_stepline`
- **Orange line** — EMA 21, `style_line`
- **Green/red histogram bars** — RSI−50, `style_histogram` (bars above zero = RSI>50)
- **Silver dots** — close price circles, `style_circles`

### 2. `hline()` — constant horizontal levels
Three dashed/dotted lines at **70** (red), **50** (gray), **30** (green). Rendered as
`series.createPriceLine()` on the first indicator series.

### 3. `fill()` — shaded areas
- **Teal/purple tint** between BB upper and lower — colour flips based on `close > basis`
- **Gray tint** between RSI hlines 30 and 70 — very faint, confirms hline-to-hline fill works
  *(Note: fill is rendered on the price axis, not the RSI axis, so the shading spans a large
  price range. This is correct — the hline values 30/70 are treated as raw prices in `fill()`
  when there's no pane separation.)*

### 4. `plotshape()` — triangle markers
- **Green ▲ below bar** — EMA 8 crosses above EMA 21 (with "X" text)
- **Red ▼ above bar** — EMA 8 crosses below EMA 21 (with "X" text)
- **Orange squares above bar** — RSI > 70 (overbought)
- **Cyan circles below bar** — RSI < 30 (oversold)

### 5. `plotchar()` — character markers
- **Yellow ★ below bar** — same bar as bull cross (offset −1)
- **Fuchsia ↓ above bar** — same bar as bear cross (offset −1)

### 6. `plotarrow()` — directional arrows
Appear only when RSI is overbought (downward) or oversold (upward). Arrow height
proportional to RSI deviation from 50, capped between 5 and 15 pixels.

### 7. `plotbar()` / `plotcandle()` (disabled by default)
Enable via inputs. Bars rendered 2×ATR **above** current price; candles 2×ATR **below**,
so they don't overlap the main series. Confirms `BarSeries` / `CandlestickSeries` dispatch.

### 8. `line.new()` — dynamic trendlines
- **Yellow solid line** extending right — connects last two swing highs (5-bar pivot)
- **Cyan dashed line** extending right — connects last two swing lows
- **Short lime/red vertical stubs** — appear on bull/bear cross bars

Up to 100 live line objects (controlled by `max_lines_count=100`). The pool diffs on every
bar so only new/changed lines are reattached.

### 9. `box.new()` — rectangle overlays
- **Large teal semi-transparent box** — spans the last `ma_length` bars between BB upper/lower;
  redrawn every bar (old box deleted before new one created)
- **Small red boxes** — appear during BB squeeze (band width < 2% of price) with "Squeeze" text

### 10. `label.new()` — text annotations
- **Green label below bar** — "▲ BULL" + EMA 8 value on each bull cross
- **Red label above bar** — "▼ BEAR" + EMA 8 value on each bear cross
- **Navy label on last bar** — live close price + RSI reading, updated each tick

### 11. `linefill.new()` — fills between two lines
Shaded area between EMA 8 and EMA 21, colour-coded:
- **Green tint** when EMA 8 > EMA 21 (uptrend)
- **Red tint** when EMA 8 < EMA 21 (downtrend)

60 linefill objects (one per bar). The `PineLinefillRenderer` batches them by colour into
one primitive per colour group.

### 12. `table.new()` — live dashboard
Top-right corner overlay with 7 rows:

| Column 0 | Column 1 |
|---|---|
| Indicator | Value |
| Close | current price (green/red) |
| BB Upper | teal |
| BB Lower | teal |
| RSI | red if >70, green if <30, yellow otherwise |
| EMA 8/21 | ▲ Bull / ▼ Bear |
| Trend | OB Zone / OS Zone / In Band |

Updates on every closed bar (driven by `barstate.islast`). Updates on live ticks too
since the tick path now calls `_onTables` when table count is nonzero.

---

## Cap test

To confirm the 500-object cap:

```pine
//@version=5
indicator("Cap Test", overlay=true, max_lines_count=500)
for i = 0 to 599
    line.new(bar_index - i, close + i * 0.01,
             bar_index - i + 1, close + i * 0.01 + 0.005,
             color=color.blue, xloc=xloc.bar_index)
```

Expected result: exactly 500 lines visible, one `[PineObjectPool]` warning in the browser
console, no second warning on subsequent bars.

---

## Known limitations

| Feature | Status | Notes |
|---|---|---|
| `polyline.new()` | ⚠️ Empty | `chart.point.from_index()` not supported in this pinets version. Pool handles `[]` gracefully — no crash. |
| `fill()` hline-to-hline | ✅ | Renders as flat polygon across visible time range. Redraws on pan/zoom via `updateAllViews()`. |
| `plotchar()` char rendering | ⚠️ Approximate | LWC's `createSeriesMarkers` doesn't support arbitrary Unicode characters — chars render as `circle` shape. The character text is passed in the `text` field for future use. |
| Bar/candle overlays | ✅ | Disabled by default to avoid visual clutter; enable via inputs. |
| Tick-time updates | ✅ | Series `.update()`, marker `setMarkers()`, pool `.sync()`, and table `_onTables` all fire on each debounced tick result. |
