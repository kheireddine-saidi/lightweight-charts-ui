/**
 * EditablePrice — click-to-edit price cell used in PositionsPanel and
 * TradingPanel for entry/SL/TP fields. Shows a small warning bubble when
 * the entered value would be invalid per validateTPSL (e.g. a long TP
 * placed below current price, which would trigger an immediate market exit).
 *
 * On invalid input the edit is REJECTED — the field reverts to its previous
 * value and the bubble is shown briefly, per spec ("ignore the requested
 * modification").
 */
import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';

/* Reuses the --pp-* CSS variables injected by PositionsPanel's PanelThemeVars
 * (and TradingPanel's equivalent --tp-* set, aliased below) — EditablePrice
 * is rendered inside both panels' theme-scoped trees, so these custom
 * properties are always available via CSS inheritance regardless of which
 * panel renders it. Falls back to dark-theme hex if used standalone outside
 * either panel (shouldn't normally happen).
 */
const C = {
  surface: 'var(--pp-surface, var(--tp-surface, #1e222d))',
  elevated: 'var(--pp-border, var(--tp-elevated, #2a2e39))',
  border: 'var(--pp-border, var(--tp-border, #2a2e39))',
  text: 'var(--pp-text, var(--tp-text, #d1d4dc))',
  muted: 'var(--pp-text-muted, var(--tp-muted, #787b86))',
  red: 'var(--pp-red, var(--tp-red, #f23645))',
  green: 'var(--pp-green, var(--tp-green, #089981))',
  orange: 'var(--pp-orange, var(--tp-orange, #f0a500))',
};

const Wrap = styled.span`
  position: relative;
  display: inline-block;
`;

const Display = styled.span<{ $locked?: boolean; $color?: string }>`
  color: ${(p) => p.$color ?? C.text};
  cursor: ${(p) => (p.$locked ? 'default' : 'pointer')};
  border-bottom: ${(p) => (p.$locked ? 'none' : `1px dashed ${C.muted}66`)};
  padding: 1px 2px;
  border-radius: 2px;
  &:hover {
    background: ${(p) => (p.$locked ? 'transparent' : C.elevated)};
  }
`;

const EditInput = styled.input`
  width: 90px;
  background: ${C.elevated};
  border: 1px solid ${C.orange};
  border-radius: 3px;
  color: ${C.text};
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  padding: 2px 4px;
  outline: none;
`;

const Bubble = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: ${C.surface};
  border: 1px solid ${C.red};
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 11px;
  color: ${C.text};
  white-space: nowrap;
  max-width: 240px;
  white-space: normal;
  width: 220px;
  box-shadow: 0 6px 18px rgba(0,0,0,.5);
  z-index: 50;
  &::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: ${C.red};
  }
`;

interface EditablePriceProps {
  value: number | null | undefined;
  locked?: boolean;
  placeholder?: string;
  color?: string;
  formatDecimals?: number;
  /** Called with the new numeric value. Return true to accept, false to reject. */
  onValidate: (newValue: number) => { valid: boolean; message: string | null };
  onCommit: (newValue: number) => void;
}

const EditablePrice: React.FC<EditablePriceProps> = ({
  value, locked, placeholder = '—', color, formatDecimals = 5, onValidate, onCommit,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const warnTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value != null ? String(value) : '');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (warnTimeout.current) clearTimeout(warnTimeout.current); }, []);

  const showWarning = (msg: string) => {
    setWarning(msg);
    if (warnTimeout.current) clearTimeout(warnTimeout.current);
    warnTimeout.current = setTimeout(() => setWarning(null), 3500);
  };

  const commit = () => {
    const num = parseFloat(draft);
    if (!draft.trim() || isNaN(num)) {
      setEditing(false);
      return;
    }
    const result = onValidate(num);
    if (!result.valid) {
      // Reject the modification — revert to previous value, show bubble.
      showWarning(result.message ?? 'Invalid value.');
      setEditing(false);
      return;
    }
    onCommit(num);
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  };

  const displayText = value != null ? value.toFixed(formatDecimals) : placeholder;

  return (
    <Wrap>
      {warning && <Bubble>⚠ {warning}</Bubble>}
      {editing ? (
        <EditInput
          ref={inputRef}
          type="number"
          step="0.00001"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <Display
          $locked={locked}
          $color={color}
          onClick={() => { if (!locked) setEditing(true); }}
          title={locked ? 'Locked — entry price cannot be changed after fill' : 'Click to edit'}
        >
          {displayText}
        </Display>
      )}
    </Wrap>
  );
};

export default EditablePrice;
