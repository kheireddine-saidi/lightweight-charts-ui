/**
 * IndicatorPanel — full indicator management UI.
 *
 * Built-in indicators (SMA/EMA) use the existing WorkspaceStore toggle.
 * User indicators (Pine Script) use indicatorStore and PineTSRuntime.
 *
 * Features:
 * - List all indicators (built-in + user)
 * - ✏ Edit source code (opens inline editor toggled in place of positions panel)
 * - ⚙ Edit params (period / color)
 * - ✕ Delete with confirmation
 * - + New indicator button
 * - Apply button wires params into PineTSRuntime and re-runs
 */
import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { indicatorFactory } from '../../indicators/registry';
import { useWorkspaceStore } from '../../features/workspace/WorkspaceStore';
import { useIndicatorStore, createDefaultIndicator } from '../../stores/indicatorStore';
import type { UserIndicator } from '../../stores/indicatorStore';

const C = {
  bg:'#131722', surface:'#1e222d', elevated:'#2a2e39',
  border:'#2a2e39', text:'#d1d4dc', muted:'#787b86', dim:'#555b6e',
  green:'#089981', red:'#f23645', blue:'#2962ff', orange:'#f0a500',
};

const Panel = styled.div`
  background:${C.surface}; border:1px solid ${C.border}; border-radius:8px;
  min-width:300px; max-width:380px; font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
  font-size:12px; color:${C.text}; overflow:hidden; box-shadow:0 8px 24px rgba(0,0,0,.4);
`;
const Header = styled.div`
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 14px; border-bottom:1px solid ${C.border};
`;
const Title = styled.div`font-size:13px; font-weight:600;`;
const HBtns = styled.div`display:flex; gap:4px;`;
const IconBtn = styled.button<{$active?:boolean}>`
  background:${p=>p.$active?`${C.blue}22`:'transparent'};
  border:none; color:${p=>p.$active?C.blue:C.muted}; cursor:pointer;
  font-size:13px; padding:3px 6px; border-radius:3px;
  &:hover { background:${C.elevated}; color:${C.text}; }
`;
const CloseBtn = styled(IconBtn)`font-size:16px;`;
const List = styled.div`display:flex; flex-direction:column;`;
const SectionLabel = styled.div`
  padding:5px 14px 2px; font-size:9px; font-weight:700; color:${C.dim};
  text-transform:uppercase; letter-spacing:.07em;
`;
const ItemRow = styled.div<{$active:boolean}>`
  display:flex; align-items:center; gap:6px; padding:7px 14px;
  border-bottom:1px solid ${C.border}26;
  background:${p=>p.$active?`${C.blue}10`:'transparent'};
  &:last-child { border-bottom:none; }
`;
const Dot = styled.div<{$color:string}>`
  width:8px; height:8px; border-radius:50%; background:${p=>p.$color}; flex-shrink:0;
`;
const ItemName = styled.div`flex:1; font-size:12px; font-weight:500; overflow:hidden; text-overflow:ellipsis;`;
const Toggle = styled.button<{$on:boolean}>`
  width:28px; height:14px; border-radius:7px; border:none; cursor:pointer; flex-shrink:0;
  background:${p=>p.$on?C.blue:C.elevated}; position:relative; transition:background .15s;
  &::after {
    content:''; position:absolute; top:2px;
    left:${p=>p.$on?'14px':'2px'}; width:10px; height:10px;
    border-radius:50%; background:#fff; transition:left .15s;
  }
`;

/* ─── Edit params panel ─── */
const EditBox = styled.div`padding:12px 14px; border-top:1px solid ${C.border}; background:${C.bg}; display:flex; flex-direction:column; gap:8px;`;
const EditTitle = styled.div`font-size:10px; font-weight:700; color:${C.muted}; text-transform:uppercase; letter-spacing:.05em;`;
const FieldRow = styled.div`display:flex; align-items:center; gap:8px;`;
const FieldLabel = styled.label`font-size:11px; color:${C.muted}; min-width:56px;`;
const FInput = styled.input`
  flex:1; background:${C.elevated}; border:1px solid transparent; border-radius:4px;
  color:${C.text}; font-size:12px; padding:4px 8px; outline:none;
  &:focus { border-color:${C.blue}; }
`;
const BtnRow = styled.div`display:flex; gap:6px; justify-content:flex-end;`;
const SaveBtn = styled.button`padding:4px 12px; border-radius:4px; border:none; background:${C.blue}; color:#fff; font-size:11px; font-weight:600; cursor:pointer; &:hover{opacity:.85;}`;
const CancelBtn = styled.button`padding:4px 10px; border-radius:4px; border:1px solid ${C.border}; background:transparent; color:${C.muted}; font-size:11px; cursor:pointer; &:hover{color:${C.text};}`;
const DelConfirm = styled.div`padding:8px 14px; background:rgba(242,54,69,.08); border-top:1px solid ${C.border}; display:flex; align-items:center; justify-content:space-between; font-size:11px;`;

const AddSection = styled.div`padding:10px 14px; border-top:1px solid ${C.border}; display:flex; gap:6px;`;
const Select = styled.select`flex:1; background:${C.elevated}; border:1px solid ${C.border}; border-radius:4px; color:${C.text}; font-size:12px; padding:5px 8px; outline:none; cursor:pointer; &:focus{border-color:${C.blue};}`;
const AddBtn = styled.button`padding:5px 12px; border-radius:4px; border:none; background:${C.blue}; color:#fff; font-size:11px; font-weight:600; cursor:pointer; &:hover{opacity:.85;}`;

const BUILTIN_META: Record<string, {label:string; defaultParams:Record<string,unknown>; colors:string[]}> = {
  sma: { label:'SMA', defaultParams:{period:20}, colors:[C.blue] },
  ema: { label:'EMA', defaultParams:{period:20}, colors:[C.orange] },
};

interface IndicatorPanelProps {
  onClose: () => void;
  onEditSource?: (indicator: UserIndicator) => void;
}

const IndicatorPanel: React.FC<IndicatorPanelProps> = ({ onClose, onEditSource }) => {
  const indicators = useWorkspaceStore(s => s.getActiveChart()?.indicators ?? {});
  const toggleActiveChartIndicator = useWorkspaceStore(s => s.toggleActiveChartIndicator);
  const updateChartIndicatorParams = useWorkspaceStore(s => (s as any).updateChartIndicatorParams);

  const userInds = useIndicatorStore(s => s.indicators);
  const { upsert, remove, setEnabled } = useIndicatorStore();

  const [editingId, setEditingId] = useState<string|null>(null);
  const [editParams, setEditParams] = useState<Record<string,string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string|null>(null);
  const [selectedBuiltin, setSelectedBuiltin] = useState('sma');

  const availableBuiltins = [...indicatorFactory.keys()];

  /* ── Built-in: add ── */
  const addBuiltin = useCallback(() => {
    if (!indicators[selectedBuiltin]) toggleActiveChartIndicator(selectedBuiltin);
  }, [selectedBuiltin, indicators, toggleActiveChartIndicator]);

  /* ── Built-in: edit params ── */
  const startEditBuiltin = (id: string) => {
    setConfirmDeleteId(null);
    setEditingId(`builtin:${id}`);
    const meta = BUILTIN_META[id];
    setEditParams(Object.fromEntries(Object.entries(meta?.defaultParams ?? {period:20}).map(([k,v])=>[k,String(v)])));
  };

  const applyBuiltinParams = () => {
    const id = editingId?.replace('builtin:','') ?? '';
    if (updateChartIndicatorParams) {
      updateChartIndicatorParams(id, Object.fromEntries(Object.entries(editParams).map(([k,v])=>[k,Number(v)])));
    }
    setEditingId(null);
  };

  /* ── User indicators ── */
  const createNew = () => {
    const ind = createDefaultIndicator();
    upsert(ind);
    if (onEditSource) onEditSource(ind);
    onClose();
  };

  const editSource = (ind: UserIndicator) => {
    if (onEditSource) { onEditSource(ind); onClose(); }
  };

  const startEditUserParams = (ind: UserIndicator) => {
    setConfirmDeleteId(null);
    setEditingId(`user:${ind.id}`);
    setEditParams(Object.fromEntries(Object.entries(ind.params).map(([k,v])=>[k,String(v)])));
  };

  const applyUserParams = () => {
    const id = editingId?.replace('user:','') ?? '';
    const ind = userInds.find(i=>i.id===id);
    if (!ind) return;
    const params = Object.fromEntries(Object.entries(editParams).map(([k,v])=>[k,isNaN(Number(v))?v:Number(v)]));
    upsert({...ind, params});
    setEditingId(null);
  };

  const deleteUser = (id: string) => { remove(id); setConfirmDeleteId(null); setEditingId(null); };
  const deleteBuiltin = (id: string) => { if(indicators[id]) toggleActiveChartIndicator(id); setConfirmDeleteId(null); setEditingId(null); };

  const activeBuiltins = Object.entries(indicators).filter(([,v])=>v).map(([k])=>k);

  return (
    <Panel>
      <Header>
        <Title>Indicators</Title>
        <HBtns>
          <IconBtn title="New Pine Script indicator" onClick={createNew}>＋</IconBtn>
          <CloseBtn onClick={onClose}>✕</CloseBtn>
        </HBtns>
      </Header>

      <List>
        {/* ── Built-in indicators ── */}
        {activeBuiltins.length > 0 && <SectionLabel>Built-in</SectionLabel>}
        {activeBuiltins.map(id => {
          const meta = BUILTIN_META[id];
          const isEditing = editingId === `builtin:${id}`;
          const isDeleting = confirmDeleteId === `builtin:${id}`;
          return (
            <React.Fragment key={id}>
              <ItemRow $active={isEditing}>
                <Dot $color={meta?.colors?.[0] ?? C.blue}/>
                <ItemName>{meta?.label ?? id.toUpperCase()}</ItemName>
                <IconBtn title="Edit params" onClick={()=>startEditBuiltin(id)}>⚙</IconBtn>
                <IconBtn title="Remove" style={{color:C.red}} onClick={()=>setConfirmDeleteId(`builtin:${id}`)}>✕</IconBtn>
              </ItemRow>
              {isDeleting&&(
                <DelConfirm>
                  <span>Remove <strong>{meta?.label ?? id}</strong>?</span>
                  <div style={{display:'flex',gap:6}}>
                    <SaveBtn style={{background:C.red}} onClick={()=>deleteBuiltin(id)}>Remove</SaveBtn>
                    <CancelBtn onClick={()=>setConfirmDeleteId(null)}>Cancel</CancelBtn>
                  </div>
                </DelConfirm>
              )}
              {isEditing&&(
                <EditBox>
                  <EditTitle>Edit {meta?.label ?? id} params</EditTitle>
                  {Object.entries(editParams).map(([k,v])=>(
                    <FieldRow key={k}>
                      <FieldLabel>{k}</FieldLabel>
                      <FInput type="number" value={v} min={1} onChange={e=>setEditParams(p=>({...p,[k]:e.target.value}))}/>
                    </FieldRow>
                  ))}
                  <BtnRow>
                    <SaveBtn onClick={applyBuiltinParams}>Apply</SaveBtn>
                    <CancelBtn onClick={()=>setEditingId(null)}>Cancel</CancelBtn>
                  </BtnRow>
                </EditBox>
              )}
            </React.Fragment>
          );
        })}

        {/* ── User Pine Script indicators ── */}
        {userInds.length > 0 && <SectionLabel>Pine Script</SectionLabel>}
        {userInds.map(ind => {
          const isEditing = editingId === `user:${ind.id}`;
          const isDeleting = confirmDeleteId === `user:${ind.id}`;
          return (
            <React.Fragment key={ind.id}>
              <ItemRow $active={isEditing}>
                <Dot $color={ind.color}/>
                <ItemName title={ind.title}>{ind.title}</ItemName>
                <Toggle $on={ind.enabled} onClick={()=>setEnabled(ind.id,!ind.enabled)} title={ind.enabled?'Disable':'Enable'}/>
                <IconBtn title="Edit source code" onClick={()=>editSource(ind)}>✏</IconBtn>
                <IconBtn title="Edit params" onClick={()=>startEditUserParams(ind)}>⚙</IconBtn>
                <IconBtn title="Delete" style={{color:C.red}} onClick={()=>setConfirmDeleteId(`user:${ind.id}`)}>✕</IconBtn>
              </ItemRow>
              {isDeleting&&(
                <DelConfirm>
                  <span>Delete <strong>{ind.title}</strong>?</span>
                  <div style={{display:'flex',gap:6}}>
                    <SaveBtn style={{background:C.red}} onClick={()=>deleteUser(ind.id)}>Delete</SaveBtn>
                    <CancelBtn onClick={()=>setConfirmDeleteId(null)}>Cancel</CancelBtn>
                  </div>
                </DelConfirm>
              )}
              {isEditing&&(
                <EditBox>
                  <EditTitle>Edit params — {ind.title}</EditTitle>
                  {Object.keys(editParams).length === 0 && (
                    <div style={{color:C.dim,fontSize:11}}>No params defined in source yet.<br/>Use <code style={{color:C.muted}}>input.*</code> in Pine Script to expose params.</div>
                  )}
                  {Object.entries(editParams).map(([k,v])=>(
                    <FieldRow key={k}>
                      <FieldLabel>{k}</FieldLabel>
                      <FInput value={v} onChange={e=>setEditParams(p=>({...p,[k]:e.target.value}))}/>
                    </FieldRow>
                  ))}
                  <BtnRow>
                    <SaveBtn onClick={applyUserParams}>Apply</SaveBtn>
                    <CancelBtn onClick={()=>setEditingId(null)}>Cancel</CancelBtn>
                  </BtnRow>
                </EditBox>
              )}
            </React.Fragment>
          );
        })}

        {activeBuiltins.length === 0 && userInds.length === 0 && (
          <div style={{padding:'12px 14px', color:C.dim, fontSize:11}}>
            No active indicators — add below or create a Pine Script indicator.
          </div>
        )}
      </List>

      {/* ── Add built-in section ── */}
      <AddSection>
        <Select value={selectedBuiltin} onChange={e=>setSelectedBuiltin(e.target.value)}>
          {availableBuiltins.map(id=>(
            <option key={id} value={id}>{BUILTIN_META[id]?.label ?? id.toUpperCase()}</option>
          ))}
        </Select>
        <AddBtn onClick={addBuiltin}>Add</AddBtn>
      </AddSection>
    </Panel>
  );
};

export default IndicatorPanel;
