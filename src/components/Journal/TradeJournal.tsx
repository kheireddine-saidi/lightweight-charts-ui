/**
 * TradeJournal — tab component shown inside PositionsPanel.
 *
 * Reads from TradeJournalRepository (localStorage).
 * Allows editing notes, criteria tags, timeframe tags, risk, and R:R.
 * Clicking a row expands it inline.
 */
import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { tradeJournalRepository } from '../../services/journal/TradeJournalRepository';
import type { JournalEntry, JournalTag } from '../../services/journal/TradeJournalRepository';
import { EventBus, Events } from '../../core/EventBus';

/* ─── Design tokens (match PositionsPanel) ─── */
const C = {
  bg: '#131722',
  surface: '#1e222d',
  surfaceAlt: '#252b3b',
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

/* ─── Styled components ─── */
const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 12px;
  color: ${C.text};
  overflow: hidden;
`;

const ScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  &::-webkit-scrollbar { width: 4px; height: 4px; }
  &::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 6px;
  color: ${C.textDim};
  font-size: 12px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;
`;

const TH = styled.th`
  padding: 6px 10px;
  text-align: left;
  color: ${C.textMuted};
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid ${C.border};
  white-space: nowrap;
  position: sticky;
  top: 0;
  background: ${C.surface};
  z-index: 1;
`;

const TR = styled.tr<{ $selected: boolean }>`
  background: ${(p) => (p.$selected ? C.surfaceAlt : 'transparent')};
  cursor: pointer;
  &:hover td { background: ${C.surfaceAlt}; }
  &:not(:last-child) td { border-bottom: 1px solid ${C.border}; }
`;

const TD = styled.td`
  padding: 7px 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: background 0.1s;
`;

const SidePill = styled.span<{ $side: string }>`
  display: inline-block;
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  background: ${(p) => (p.$side === 'long' ? 'rgba(8,153,129,0.12)' : 'rgba(242,54,69,0.12)')};
  color: ${(p) => (p.$side === 'long' ? C.green : C.red)};
`;

const PnLCell = styled.span<{ $val: number }>`
  color: ${(p) => (p.$val >= 0 ? C.green : C.red)};
  font-weight: 600;
`;

/* ─── Expanded row (inline edit) ─── */
const ExpandedRow = styled.tr``;

const ExpandedCell = styled.td`
  padding: 12px 16px;
  background: ${C.bg};
  border-bottom: 1px solid ${C.border};
`;

const EditGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 20px;
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const FieldLabel = styled.label`
  font-size: 10px;
  color: ${C.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const StyledInput = styled.input`
  background: ${C.surfaceElevated};
  border: 1px solid transparent;
  border-radius: 4px;
  color: ${C.text};
  font-size: 12px;
  padding: 5px 8px;
  outline: none;
  width: 100%;
  &:focus { border-color: ${C.blue}; }
`;

const StyledTextarea = styled.textarea`
  background: ${C.surfaceElevated};
  border: 1px solid transparent;
  border-radius: 4px;
  color: ${C.text};
  font-size: 12px;
  padding: 5px 8px;
  outline: none;
  width: 100%;
  resize: vertical;
  min-height: 56px;
  font-family: inherit;
  &:focus { border-color: ${C.blue}; }
`;

/* ─── Tag system ─── */
const TagsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
`;

const TagBadge = styled.span<{ $color: string; $selected?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  background: ${(p) => p.$color}22;
  color: ${(p) => p.$color};
  border: 1px solid ${(p) => (p.$selected ? p.$color : 'transparent')};
  cursor: pointer;
  user-select: none;
  transition: border-color 0.1s;
  &:hover { border-color: ${(p) => p.$color}; }
`;

const AddTagBtn = styled.button`
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px dashed ${C.border};
  background: transparent;
  color: ${C.textMuted};
  font-size: 10px;
  cursor: pointer;
  &:hover { border-color: ${C.textMuted}; color: ${C.text}; }
`;

const SaveBtn = styled.button`
  padding: 4px 14px;
  border-radius: 4px;
  border: none;
  background: ${C.blue};
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  &:hover { opacity: 0.85; }
`;

const SummaryRow = styled.div`
  display: flex;
  gap: 20px;
  padding: 6px 10px;
  border-top: 1px solid ${C.border};
  background: ${C.surface};
  flex-shrink: 0;
`;

const SumItem = styled.div`
  display: flex;
  gap: 5px;
  align-items: center;
  font-size: 11px;
`;

const SumLabel = styled.span` color: ${C.textMuted}; `;
const SumVal = styled.span<{ $color?: string }>`
  color: ${(p) => p.$color || C.text};
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

/* ─── Tag manager modal ─── */
const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const ModalBox = styled.div`
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 8px;
  padding: 20px;
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ModalTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${C.text};
`;

const TagRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ColorDot = styled.input.attrs({ type: 'color' })`
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  padding: 0;
  cursor: pointer;
  background: transparent;
`;

const DeleteTagBtn = styled.button`
  background: transparent;
  border: none;
  color: ${C.textMuted};
  cursor: pointer;
  font-size: 14px;
  &:hover { color: ${C.red}; }
`;

const PRESET_COLORS = ['#2962ff','#089981','#f23645','#f0a500','#9c27b0','#00bcd4','#ff5722'];

/* ─── Helpers ─── */
const fmtDt = (ts?: number) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

/* ─── Main component ─── */
const TradeJournal: React.FC = () => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [tags, setTags] = useState<JournalTag[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editState, setEditState] = useState<Partial<JournalEntry>>({});
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0]);

  const reload = useCallback(() => {
    setEntries(tradeJournalRepository.getAll());
    setTags(tradeJournalRepository.getTags());
  }, []);

  useEffect(() => {
    reload();
    // Reload whenever a position closes so the journal updates in real time
    const unsub = EventBus.on(Events.POSITION_CLOSED, () => setTimeout(reload, 100));
    const unsubFilled = EventBus.on(Events.ORDER_FILLED, () => setTimeout(reload, 100));
    const unsubOpened = EventBus.on(Events.POSITION_OPENED, () => setTimeout(reload, 100));
    return () => { unsub(); unsubFilled(); unsubOpened(); };
  }, [reload]);

  const selectRow = (id: string) => {
    if (selectedId === id) {
      setSelectedId(null);
      return;
    }
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    setSelectedId(id);
    setEditState({
      riskReward: e.riskReward ?? '',
      risk: e.risk ?? '',
      entryCriteriaTags: [...(e.entryCriteriaTags ?? [])],
      entryTimeframeTags: [...(e.entryTimeframeTags ?? [])],
      mistake: e.mistake ?? '',
      notes: e.notes ?? '',
    });
  };

  const handleSave = () => {
    if (!selectedId) return;
    tradeJournalRepository.updateEditable(selectedId, {
      riskReward: editState.riskReward,
      risk: editState.risk,
      entryCriteriaTags: editState.entryCriteriaTags ?? [],
      entryTimeframeTags: editState.entryTimeframeTags ?? [],
      mistake: editState.mistake,
      notes: editState.notes,
    });
    reload();
    setSelectedId(null);
  };

  const toggleTag = (tagId: string, field: 'entryCriteriaTags' | 'entryTimeframeTags') => {
    setEditState((prev) => {
      const arr = [...(prev[field] ?? [])];
      const idx = arr.indexOf(tagId);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(tagId);
      return { ...prev, [field]: arr };
    });
  };

  const addTag = () => {
    if (!newTagLabel.trim()) return;
    const tag: JournalTag = {
      id: `tag_${Date.now()}`,
      label: newTagLabel.trim(),
      color: newTagColor,
    };
    tradeJournalRepository.upsertTag(tag);
    setNewTagLabel('');
    setNewTagColor(PRESET_COLORS[0]);
    reload();
  };

  const deleteTag = (id: string) => {
    tradeJournalRepository.deleteTag(id);
    reload();
  };

  if (entries.length === 0) {
    return (
      <EmptyState>
        <span>📒 No journal entries yet</span>
        <span style={{ fontSize: 10 }}>Entries are created automatically when orders fill</span>
      </EmptyState>
    );
  }

  const totalPnL = entries.filter((e) => e.status === 'closed').reduce((s, e) => s + e.pnl, 0);
  const wins = entries.filter((e) => e.status === 'closed' && e.pnl > 0).length;
  const closed = entries.filter((e) => e.status === 'closed').length;

  return (
    <Wrap>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <AddTagBtn onClick={() => setShowTagManager(true)}>⚙ Manage Tags</AddTagBtn>
      </div>

      <ScrollArea>
        <Table>
          <thead>
            <tr>
              <TH>ID</TH>
              <TH>Side</TH>
              <TH>Ticker</TH>
              <TH>Size/Lev</TH>
              <TH>Entry</TH>
              <TH>Exit</TH>
              <TH>PnL</TH>
              <TH>Status</TH>
              <TH>Filled At</TH>
              <TH>R:R</TH>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <React.Fragment key={e.id}>
                <TR $selected={selectedId === e.id} onClick={() => selectRow(e.id)}>
                  <TD style={{ color: C.textMuted, fontFamily: 'monospace', fontSize: 10 }}>{e.orderId}</TD>
                  <TD><SidePill $side={e.side}>{e.side.toUpperCase()}</SidePill></TD>
                  <TD style={{ fontWeight: 500 }}>{e.ticker}</TD>
                  <TD style={{ color: C.textMuted }}>{e.size} · {e.leverage}×</TD>
                  <TD>{e.entryPrice.toFixed(5)}</TD>
                  <TD style={{ color: C.textMuted }}>{e.exitPrice?.toFixed(5) ?? '—'}</TD>
                  <TD>
                    {e.status === 'closed' ? (
                      <PnLCell $val={e.pnl}>
                        {e.pnl >= 0 ? '+' : ''}{e.pnl.toFixed(2)}
                      </PnLCell>
                    ) : <span style={{ color: C.textDim }}>open</span>}
                  </TD>
                  <TD>
                    <span style={{ color: e.status === 'closed' ? C.textMuted : C.orange, fontWeight: 600, fontSize: 10 }}>
                      {e.status === 'closed' ? (e.exitCondition ?? 'closed') : 'OPEN'}
                    </span>
                  </TD>
                  <TD style={{ color: C.textMuted, fontSize: 10 }}>{fmtDt(e.fillDatetime)}</TD>
                  <TD style={{ color: C.textMuted }}>{e.riskReward || '—'}</TD>
                </TR>

                {selectedId === e.id && (
                  <ExpandedRow>
                    <ExpandedCell colSpan={10}>
                      <EditGrid>
                        <FieldGroup>
                          <FieldLabel>R:R Ratio</FieldLabel>
                          <StyledInput
                            placeholder="e.g. 1:2"
                            value={editState.riskReward ?? ''}
                            onChange={(ev) => setEditState((p) => ({ ...p, riskReward: ev.target.value }))}
                          />
                        </FieldGroup>
                        <FieldGroup>
                          <FieldLabel>Risk (USD or %)</FieldLabel>
                          <StyledInput
                            placeholder="e.g. 50 or 2%"
                            value={editState.risk ?? ''}
                            onChange={(ev) => setEditState((p) => ({ ...p, risk: ev.target.value }))}
                          />
                        </FieldGroup>
                        <FieldGroup style={{ gridColumn: '1 / -1' }}>
                          <FieldLabel>Entry Criteria Tags</FieldLabel>
                          <TagsRow>
                            {tags.map((t) => (
                              <TagBadge
                                key={t.id}
                                $color={t.color}
                                $selected={(editState.entryCriteriaTags ?? []).includes(t.id)}
                                onClick={() => toggleTag(t.id, 'entryCriteriaTags')}
                              >
                                {t.label}
                              </TagBadge>
                            ))}
                            {tags.length === 0 && (
                              <span style={{ color: C.textDim, fontSize: 10 }}>No tags — create some above</span>
                            )}
                          </TagsRow>
                        </FieldGroup>
                        <FieldGroup style={{ gridColumn: '1 / -1' }}>
                          <FieldLabel>Entry Timeframe Tags</FieldLabel>
                          <TagsRow>
                            {tags.map((t) => (
                              <TagBadge
                                key={t.id}
                                $color={t.color}
                                $selected={(editState.entryTimeframeTags ?? []).includes(t.id)}
                                onClick={() => toggleTag(t.id, 'entryTimeframeTags')}
                              >
                                {t.label}
                              </TagBadge>
                            ))}
                          </TagsRow>
                        </FieldGroup>
                        <FieldGroup>
                          <FieldLabel>Mistake</FieldLabel>
                          <StyledInput
                            placeholder="What went wrong?"
                            value={editState.mistake ?? ''}
                            onChange={(ev) => setEditState((p) => ({ ...p, mistake: ev.target.value }))}
                          />
                        </FieldGroup>
                        <FieldGroup style={{ gridColumn: '1 / -1' }}>
                          <FieldLabel>Notes</FieldLabel>
                          <StyledTextarea
                            placeholder="Trade notes, reasoning, lessons learned…"
                            value={editState.notes ?? ''}
                            onChange={(ev) => setEditState((p) => ({ ...p, notes: ev.target.value }))}
                          />
                        </FieldGroup>
                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                          <SaveBtn onClick={handleSave}>Save</SaveBtn>
                          <AddTagBtn onClick={() => setSelectedId(null)}>Cancel</AddTagBtn>
                        </div>
                      </EditGrid>
                    </ExpandedCell>
                  </ExpandedRow>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </Table>
      </ScrollArea>

      <SummaryRow>
        <SumItem>
          <SumLabel>Total P&L:</SumLabel>
          <SumVal $color={totalPnL >= 0 ? C.green : C.red}>
            {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
          </SumVal>
        </SumItem>
        <SumItem>
          <SumLabel>Win Rate:</SumLabel>
          <SumVal $color={closed > 0 && (wins / closed) >= 0.5 ? C.green : C.red}>
            {closed > 0 ? ((wins / closed) * 100).toFixed(0) : 0}%
          </SumVal>
        </SumItem>
        <SumItem>
          <SumLabel>Entries:</SumLabel>
          <SumVal>{entries.length}</SumVal>
        </SumItem>
      </SummaryRow>

      {/* Tag Manager Modal */}
      {showTagManager && (
        <ModalOverlay onClick={() => setShowTagManager(false)}>
          <ModalBox onClick={(ev) => ev.stopPropagation()}>
            <ModalTitle>Manage Tags</ModalTitle>
            {tags.map((t) => (
              <TagRow key={t.id}>
                <TagBadge $color={t.color} style={{ cursor: 'default' }}>{t.label}</TagBadge>
                <div style={{ flex: 1 }} />
                <DeleteTagBtn onClick={() => deleteTag(t.id)}>✕</DeleteTagBtn>
              </TagRow>
            ))}
            <TagRow>
              <ColorDot
                value={newTagColor}
                onChange={(ev) => setNewTagColor(ev.target.value)}
              />
              <StyledInput
                placeholder="Tag name…"
                value={newTagLabel}
                onChange={(ev) => setNewTagLabel(ev.target.value)}
                onKeyDown={(ev) => ev.key === 'Enter' && addTag()}
                style={{ flex: 1 }}
              />
              <SaveBtn onClick={addTag}>Add</SaveBtn>
            </TagRow>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((c) => (
                <span
                  key={c}
                  onClick={() => setNewTagColor(c)}
                  style={{
                    width: 18, height: 18, borderRadius: '50%', background: c,
                    cursor: 'pointer', border: newTagColor === c ? `2px solid #fff` : '2px solid transparent',
                  }}
                />
              ))}
            </div>
            <SaveBtn onClick={() => setShowTagManager(false)} style={{ alignSelf: 'flex-end' }}>Done</SaveBtn>
          </ModalBox>
        </ModalOverlay>
      )}
    </Wrap>
  );
};

export default TradeJournal;
