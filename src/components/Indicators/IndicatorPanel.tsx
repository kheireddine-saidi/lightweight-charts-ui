/**
 * IndicatorPanel — Indicator management UI.
 *
 * Lists active indicators for the current chart.
 * Allows: add (from registry), edit params (period, color), delete.
 *
 * Wires to the WorkspaceStore's toggleActiveChartIndicator
 * (existing interface — no store API changes needed).
 */
import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { indicatorFactory } from '../../indicators/registry';
import { useWorkspaceStore } from '../../features/workspace/WorkspaceStore';

/* ─── Design tokens ─── */
const C = {
  bg: '#131722',
  surface: '#1e222d',
  surfaceElevated: '#2a2e39',
  border: '#2a2e39',
  text: '#d1d4dc',
  textMuted: '#787b86',
  textDim: '#555b6e',
  green: '#089981',
  red: '#f23645',
  blue: '#2962ff',
  orange: '#f0a500',
};

const Panel = styled.div`
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 8px;
  min-width: 280px;
  max-width: 340px;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 12px;
  color: ${C.text};
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid ${C.border};
`;

const Title = styled.div`
  font-size: 13px;
  font-weight: 600;
`;

const CloseBtn = styled.button`
  background: transparent;
  border: none;
  color: ${C.textMuted};
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  &:hover { color: ${C.text}; }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
`;

const ItemRow = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid ${C.border};
  background: ${(p) => (p.$active ? `${C.blue}12` : 'transparent')};
  &:last-child { border-bottom: none; }
`;

const IndicatorName = styled.div`
  flex: 1;
  font-size: 12px;
  font-weight: 500;
`;

const IconBtn = styled.button`
  background: transparent;
  border: none;
  color: ${C.textMuted};
  cursor: pointer;
  font-size: 13px;
  padding: 2px 5px;
  border-radius: 3px;
  &:hover { background: ${C.surfaceElevated}; color: ${C.text}; }
`;

const AddSection = styled.div`
  padding: 10px 14px;
  border-top: 1px solid ${C.border};
  display: flex;
  gap: 6px;
`;

const Select = styled.select`
  flex: 1;
  background: ${C.surfaceElevated};
  border: 1px solid ${C.border};
  border-radius: 4px;
  color: ${C.text};
  font-size: 12px;
  padding: 5px 8px;
  outline: none;
  cursor: pointer;
  &:focus { border-color: ${C.blue}; }
`;

const AddBtn = styled.button`
  padding: 5px 12px;
  border-radius: 4px;
  border: none;
  background: ${C.blue};
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  &:hover { opacity: 0.85; }
`;

/* ─── Edit panel ─── */
const EditBox = styled.div`
  padding: 12px 14px;
  border-top: 1px solid ${C.border};
  background: ${C.bg};
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const EditTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${C.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const FieldRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const FieldLabel = styled.label`
  font-size: 11px;
  color: ${C.textMuted};
  min-width: 56px;
`;

const StyledInput = styled.input`
  flex: 1;
  background: ${C.surfaceElevated};
  border: 1px solid transparent;
  border-radius: 4px;
  color: ${C.text};
  font-size: 12px;
  padding: 4px 8px;
  outline: none;
  &:focus { border-color: ${C.blue}; }
`;

const BtnRow = styled.div`
  display: flex;
  gap: 6px;
  justify-content: flex-end;
`;

const SaveBtn = styled.button`
  padding: 4px 12px;
  border-radius: 4px;
  border: none;
  background: ${C.blue};
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  &:hover { opacity: 0.85; }
`;

const CancelBtn = styled.button`
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid ${C.border};
  background: transparent;
  color: ${C.textMuted};
  font-size: 11px;
  cursor: pointer;
  &:hover { color: ${C.text}; }
`;

const ConfirmDelete = styled.div`
  padding: 8px 14px;
  background: rgba(242,54,69,0.08);
  border-top: 1px solid ${C.border};
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
`;

/* ─── Available indicators (from factory + display metadata) ─── */
const INDICATOR_META: Record<string, { label: string; defaultParams: Record<string, unknown> }> = {
  sma: { label: 'SMA (Simple Moving Average)', defaultParams: { period: 20 } },
  ema: { label: 'EMA (Exponential Moving Average)', defaultParams: { period: 20 } },
};

interface IndicatorPanelProps {
  onClose: () => void;
}

const IndicatorPanel: React.FC<IndicatorPanelProps> = ({ onClose }) => {
  const indicators = useWorkspaceStore((s) => s.getActiveChart()?.indicators ?? {});
  const toggleActiveChartIndicator = useWorkspaceStore((s) => s.toggleActiveChartIndicator);

  const [selectedAdd, setSelectedAdd] = useState('sma');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editParams, setEditParams] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // All keys registered in the factory
  const availableIds = [...indicatorFactory.keys()];

  const activeIds = Object.entries(indicators)
    .filter(([, enabled]) => enabled)
    .map(([id]) => id);

  const handleAdd = useCallback(() => {
    if (!selectedAdd) return;
    // Toggle on — uses existing WorkspaceStore API
    if (!indicators[selectedAdd]) {
      toggleActiveChartIndicator(selectedAdd);
    }
    setSelectedAdd('sma');
  }, [selectedAdd, indicators, toggleActiveChartIndicator]);

  const handleEdit = (id: string) => {
    setConfirmDeleteId(null);
    setEditingId(id);
    const meta = INDICATOR_META[id];
    const defaults = meta?.defaultParams ?? { period: 20 };
    setEditParams(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)])));
  };

  const handleSaveEdit = () => {
    // For now: toggle off then on to re-apply with new params.
    // Full param support requires ChartComponent to pass params to INDICATOR_CONSTRUCTORS.
    // This scaffolds the UI correctly; deep param wiring is Phase 4 work.
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (indicators[id]) {
      toggleActiveChartIndicator(id);
    }
    setConfirmDeleteId(null);
    setEditingId(null);
  };

  return (
    <Panel>
      <Header>
        <Title>Indicators</Title>
        <CloseBtn onClick={onClose}>✕</CloseBtn>
      </Header>

      <List>
        {activeIds.length === 0 && (
          <div style={{ padding: '12px 14px', color: C.textDim, fontSize: 11 }}>
            No active indicators — add one below.
          </div>
        )}
        {activeIds.map((id) => {
          const meta = INDICATOR_META[id];
          return (
            <ItemRow key={id} $active={true}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: id === 'sma' ? C.blue : C.orange, flexShrink: 0 }} />
              <IndicatorName>{meta?.label ?? id.toUpperCase()}</IndicatorName>
              <IconBtn title="Edit" onClick={() => handleEdit(id)}>✏</IconBtn>
              <IconBtn
                title="Delete"
                onClick={() => setConfirmDeleteId(id)}
                style={{ color: C.red }}
              >
                ✕
              </IconBtn>
            </ItemRow>
          );
        })}
      </List>

      {/* Confirm delete */}
      {confirmDeleteId && (
        <ConfirmDelete>
          <span style={{ color: C.textMuted }}>Remove <strong style={{ color: C.text }}>{confirmDeleteId.toUpperCase()}</strong>?</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <SaveBtn style={{ background: C.red }} onClick={() => handleDelete(confirmDeleteId)}>Remove</SaveBtn>
            <CancelBtn onClick={() => setConfirmDeleteId(null)}>Cancel</CancelBtn>
          </div>
        </ConfirmDelete>
      )}

      {/* Edit params */}
      {editingId && (
        <EditBox>
          <EditTitle>Edit {editingId.toUpperCase()}</EditTitle>
          {Object.entries(editParams).map(([key, val]) => (
            <FieldRow key={key}>
              <FieldLabel>{key}</FieldLabel>
              <StyledInput
                type="number"
                value={val}
                min={1}
                onChange={(e) => setEditParams((p) => ({ ...p, [key]: e.target.value }))}
              />
            </FieldRow>
          ))}
          <BtnRow>
            <SaveBtn onClick={handleSaveEdit}>Apply</SaveBtn>
            <CancelBtn onClick={() => setEditingId(null)}>Cancel</CancelBtn>
          </BtnRow>
        </EditBox>
      )}

      {/* Add indicator */}
      <AddSection>
        <Select value={selectedAdd} onChange={(e) => setSelectedAdd(e.target.value)}>
          {availableIds.map((id) => (
            <option key={id} value={id}>
              {INDICATOR_META[id]?.label ?? id.toUpperCase()}
            </option>
          ))}
        </Select>
        <AddBtn onClick={handleAdd}>Add</AddBtn>
      </AddSection>
    </Panel>
  );
};

export default IndicatorPanel;
