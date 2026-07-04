/**
 * PineTableOverlay — renders Pine table.new() output as HTML/CSS grids
 * absolutely positioned over the chart container.
 *
 * Driven by a ref/state update from IndicatorRenderer via the onTables callback;
 * no chart primitive or canvas coordinate conversion needed — tables are
 * corner-anchored, not price/time-axis-relative.
 *
 * Usage in ChartComponent:
 *   const [pineTables, setPineTables] = useState({});   // indicatorId → tables[]
 *   // in IndicatorRenderer constructor: onTables: (id, tables) => setPineTables(prev => ({...prev, [id]: tables}))
 *   // in JSX: <PineTableOverlay tables={pineTables} />
 */

import React from 'react';

// ── Position → CSS corner mapping ────────────────────────────────────────────
// Pine: position.top_right, position.top_left, position.top_center,
//       position.middle_right, position.middle_left, position.middle_center (rare),
//       position.bottom_right, position.bottom_left, position.bottom_center

function positionToCSS(position) {
  switch (position) {
    case 'top_right':      return { top: 8,  right: 8,  left: 'auto',  bottom: 'auto', transform: 'none' };
    case 'top_left':       return { top: 8,  left: 8,   right: 'auto', bottom: 'auto', transform: 'none' };
    case 'top_center':     return { top: 8,  left: '50%', right: 'auto', bottom: 'auto', transform: 'translateX(-50%)' };
    case 'middle_right':   return { top: '50%', right: 8, left: 'auto', bottom: 'auto', transform: 'translateY(-50%)' };
    case 'middle_left':    return { top: '50%', left: 8, right: 'auto', bottom: 'auto', transform: 'translateY(-50%)' };
    case 'middle_center':  return { top: '50%', left: '50%', right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' };
    case 'bottom_right':   return { bottom: 8, right: 8,  top: 'auto', left: 'auto', transform: 'none' };
    case 'bottom_left':    return { bottom: 8, left: 8,   top: 'auto', right: 'auto', transform: 'none' };
    case 'bottom_center':  return { bottom: 8, left: '50%', top: 'auto', right: 'auto', transform: 'translateX(-50%)' };
    default:               return { top: 8,  right: 8,  left: 'auto', bottom: 'auto', transform: 'none' };
  }
}

// ── Text size → font-size px ─────────────────────────────────────────────────
function textSizePx(size) {
  switch (size) {
    case 'tiny':   return 9;
    case 'small':  return 11;
    case 'normal': return 13;
    case 'large':  return 15;
    case 'huge':   return 20;
    case 'auto':   return 12;
    default:       return 12;
  }
}

// ── Text align → CSS ─────────────────────────────────────────────────────────
function halignCSS(h) {
  if (h === 'right') return 'right';
  if (h === 'left')  return 'left';
  return 'center';
}

function valignCSS(v) {
  if (v === 'top')    return 'flex-start';
  if (v === 'bottom') return 'flex-end';
  return 'center';
}

// ── Single table render ───────────────────────────────────────────────────────

function PineTable({ table }) {
  const { columns, rows, bgcolor, border_width, border_color, cells = [], position } = table;
  const posCSS = positionToCSS(position);

  // cells[col][row] — outer index is column, inner is row
  const grid = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const cell = cells[col]?.[row];
      if (!cell) continue;
      const fontSize = textSizePx(cell.text_size);
      grid.push(
        <div
          key={`${col}-${row}`}
          style={{
            gridColumn: col + 1,
            gridRow:    row + 1,
            background: cell.bgcolor || 'transparent',
            color:      cell.text_color || '#fff',
            fontSize:   fontSize,
            textAlign:  halignCSS(cell.text_halign),
            display:    'flex',
            alignItems: valignCSS(cell.text_valign),
            justifyContent: halignCSS(cell.text_halign) === 'center' ? 'center' :
                            halignCSS(cell.text_halign) === 'right'  ? 'flex-end' : 'flex-start',
            padding:    '3px 6px',
            whiteSpace: 'nowrap',
            lineHeight: 1.4,
            borderRight:  (border_width > 0 && col < columns - 1)
              ? `${border_width}px solid ${border_color || 'rgba(255,255,255,0.15)'}` : 'none',
            borderBottom: (border_width > 0 && row < rows - 1)
              ? `${border_width}px solid ${border_color || 'rgba(255,255,255,0.15)'}` : 'none',
          }}
        >
          {cell.text}
        </div>
      );
    }
  }

  return (
    <div
      style={{
        position:            'absolute',
        zIndex:              20,
        pointerEvents:       'none',
        ...posCSS,
        background:          bgcolor || 'rgba(0,0,0,0.6)',
        display:             'grid',
        gridTemplateColumns: `repeat(${columns}, auto)`,
        gridTemplateRows:    `repeat(${rows}, auto)`,
        borderRadius:        3,
        overflow:            'hidden',
        boxShadow:           '0 2px 8px rgba(0,0,0,0.4)',
        fontFamily:          'monospace, sans-serif',
      }}
    >
      {grid}
    </div>
  );
}

// ── Overlay: renders all tables from all indicators ───────────────────────────

/**
 * PineTableOverlay
 *
 * @param {{ tables: Record<string, object[]> }} props
 *   tables — map of indicatorId → PineTableObject[]
 *   (PineTableObject shape confirmed in Step 0 verification)
 */
export function PineTableOverlay({ tables }) {
  // Flatten all tables from all indicators into a single render list
  const allTables = [];
  for (const [indicatorId, tablelist] of Object.entries(tables ?? {})) {
    for (let i = 0; i < (tablelist?.length ?? 0); i++) {
      allTables.push({ key: `${indicatorId}_${i}`, table: tablelist[i] });
    }
  }

  if (!allTables.length) return null;

  return (
    <>
      {allTables.map(({ key, table }) => (
        <PineTable key={key} table={table} />
      ))}
    </>
  );
}
