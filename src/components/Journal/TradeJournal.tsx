/**
 * TradeJournal — flat horizontal table with:
 * - Single "Manage Tags" button opening a tabbed dialog (Criteria / Timeframe)
 * - Tags stored by value (label+color snapshot) on entries so deletions don't lose history
 * - Resizable columns via drag handles on TH borders
 * - Inline editing for all text fields, auto-save on change
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { tradeJournalRepository } from '../../services/journal/TradeJournalRepository';
import type { JournalEntry, JournalTag } from '../../services/journal/TradeJournalRepository';
import { EventBus, Events } from '../../core/EventBus';

/* ─── Tokens ─── */
const C = {
  bg: '#131722', surface: '#1e222d', surfaceAlt: '#252b3b',
  elevated: '#2a2e39', border: '#2a2e39',
  text: '#d1d4dc', muted: '#787b86', dim: '#4a5060',
  green: '#089981', red: '#f23645', blue: '#2962ff', orange: '#f0a500',
};
const PRESETS = ['#2962ff','#089981','#f23645','#f0a500','#9c27b0','#00bcd4','#ff5722','#795548'];

const GlobalStyle = createGlobalStyle`body.tj-dragging { user-select:none; cursor:col-resize !important; }`;

/* ─── Layout ─── */
const Wrap = styled.div`
  display:flex; flex-direction:column; height:100%;
  font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
  font-size:11px; color:${C.text}; overflow:hidden; background:${C.bg};
`;
const Toolbar = styled.div`
  display:flex; align-items:center; gap:8px; padding:5px 10px;
  border-bottom:1px solid ${C.border}; flex-shrink:0; background:${C.surface};
`;
const ToolBtn = styled.button`
  padding:3px 10px; border-radius:4px; border:1px solid ${C.border};
  background:transparent; color:${C.muted}; font-size:10px; cursor:pointer;
  &:hover { border-color:${C.blue}; color:${C.text}; }
`;
const PrimaryBtn = styled(ToolBtn)`
  background:${C.blue}; color:#fff; border-color:${C.blue};
  &:hover { opacity:.85; color:#fff; }
`;

/* ─── Table ─── */
const TableWrap = styled.div`
  flex:1; overflow-x:auto; overflow-y:auto;
  &::-webkit-scrollbar { width:5px; height:5px; }
  &::-webkit-scrollbar-track { background:${C.bg}; }
  &::-webkit-scrollbar-thumb { background:${C.elevated}; border-radius:3px; }
  &::-webkit-scrollbar-corner { background:${C.bg}; }
`;
const Table = styled.table`
  border-collapse:collapse; white-space:nowrap; table-layout:fixed;
`;
const ResizableTH = styled.th<{ $w: number }>`
  width:${p=>p.$w}px; min-width:40px;
  padding:5px 9px; text-align:left;
  font-size:9px; font-weight:600; text-transform:uppercase; letter-spacing:.07em;
  color:${C.muted}; border-bottom:1px solid ${C.border};
  position:sticky; top:0; background:${C.surface}; z-index:2;
  overflow:hidden; text-overflow:ellipsis;
  box-sizing:border-box;
  user-select:none;
`;
const ResizeHandle = styled.div`
  position:absolute; right:0; top:0; bottom:0; width:5px;
  cursor:col-resize;
  &:hover, &:active { background:${C.blue}44; }
`;
const TR = styled.tr`&:hover td { background:${C.surfaceAlt}; } &:not(:last-child) td { border-bottom:1px solid ${C.border}26; }`;
const TD = styled.td`
  padding:5px 9px; vertical-align:middle;
  overflow:hidden; text-overflow:ellipsis; box-sizing:border-box;
`;
const SidePill = styled.span<{$s:string}>`
  display:inline-block; padding:1px 7px; border-radius:3px;
  font-size:9px; font-weight:700;
  background:${p=>p.$s==='long'?'#08998122':'#f2364522'};
  color:${p=>p.$s==='long'?C.green:C.red};
`;
const PnLText = styled.span<{$v:number}>`
  color:${p=>p.$v>=0?C.green:C.red}; font-weight:600; font-variant-numeric:tabular-nums;
`;
const StatusDot = styled.span<{$open:boolean}>`
  display:inline-block; width:6px; height:6px; border-radius:50%;
  background:${p=>p.$open?C.orange:C.muted}; vertical-align:middle; margin-right:4px;
`;
const InlineInput = styled.input`
  background:transparent; border:none; border-bottom:1px solid transparent;
  color:${C.text}; font-size:11px; font-family:inherit;
  padding:1px 2px; width:100%; outline:none;
  &:focus { border-bottom-color:${C.blue}; background:${C.elevated}; border-radius:2px 2px 0 0; }
`;

/* ─── Tag badges ─── */
const BadgeRow = styled.div`display:flex; flex-wrap:nowrap; gap:3px; align-items:center; min-width:60px; position:relative;`;
const Badge = styled.span<{$color:string}>`
  display:inline-flex; align-items:center; padding:1px 6px; border-radius:8px;
  font-size:9px; font-weight:600; background:${p=>p.$color}22; color:${p=>p.$color};
  white-space:nowrap; cursor:pointer; user-select:none;
`;
const AddTagBtn = styled.button`
  background:transparent; border:1px dashed ${C.border}; border-radius:8px;
  color:${C.dim}; font-size:9px; padding:1px 5px; cursor:pointer; white-space:nowrap; flex-shrink:0;
  &:hover { border-color:${C.blue}; color:${C.blue}; }
`;

/* ─── Tag dropdown ─── */
const DropOverlay = styled.div`position:fixed; inset:0; z-index:900;`;
const Drop = styled.div<{$top:number;$left:number}>`
  position:fixed; top:${p=>p.$top}px; left:${p=>p.$left}px; z-index:901;
  background:${C.surface}; border:1px solid ${C.elevated}; border-radius:6px;
  min-width:180px; max-width:240px; box-shadow:0 8px 24px rgba(0,0,0,.5); padding:4px 0;
`;
const DropItem = styled.div<{$sel:boolean;$color:string}>`
  display:flex; align-items:center; gap:7px; padding:6px 12px; cursor:pointer;
  background:${p=>p.$sel?`${p.$color}18`:'transparent'};
  &:hover { background:${p=>`${p.$color}28`}; }
`;
const DropDot = styled.span<{$color:string}>`width:8px;height:8px;border-radius:50%;background:${p=>p.$color};flex-shrink:0;`;
const DropLabel = styled.span<{$color:string;$sel:boolean}>`font-size:11px;color:${p=>p.$sel?p.$color:C.text};font-weight:${p=>p.$sel?600:400};`;
const DropFooter = styled.div`border-top:1px solid ${C.border};padding:6px 12px;display:flex;justify-content:space-between;`;
const DropFooterBtn = styled.button`background:transparent;border:none;font-size:10px;color:${C.muted};cursor:pointer;&:hover{color:${C.text};}`;

/* ─── Modal ─── */
const Overlay = styled.div`position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;display:flex;align-items:center;justify-content:center;`;
const Modal = styled.div`
  background:${C.surface}; border:1px solid ${C.elevated}; border-radius:8px;
  padding:0; width:320px; display:flex; flex-direction:column; overflow:hidden;
  box-shadow:0 12px 40px rgba(0,0,0,.5);
`;
const ModalHeader = styled.div`padding:14px 18px 0; display:flex; flex-direction:column; gap:0;`;
const ModalTitle = styled.div`font-size:13px; font-weight:600; margin-bottom:8px;`;
const TabRow = styled.div`display:flex; gap:0; border-bottom:1px solid ${C.border};`;
const Tab = styled.button<{$active:boolean}>`
  padding:7px 14px; background:transparent; border:none;
  border-bottom:2px solid ${p=>p.$active?C.blue:'transparent'};
  color:${p=>p.$active?C.text:C.muted}; font-size:11px; font-weight:${p=>p.$active?600:400};
  cursor:pointer; margin-bottom:-1px;
  &:hover { color:${C.text}; }
`;
const ModalBody = styled.div`padding:14px 18px; display:flex; flex-direction:column; gap:10px; max-height:280px; overflow-y:auto;`;
const ModalFooter = styled.div`padding:10px 18px; border-top:1px solid ${C.border}; display:flex; justify-content:flex-end; gap:8px;`;
const TagRow = styled.div`display:flex; align-items:center; gap:7px;`;
const DelBtn = styled.button`background:transparent;border:none;color:${C.muted};cursor:pointer;font-size:13px;&:hover{color:${C.red};}`;
const MInput = styled.input`
  flex:1; background:${C.elevated}; border:1px solid transparent; border-radius:4px;
  color:${C.text}; font-size:12px; padding:4px 8px; outline:none;
  &:focus { border-color:${C.blue}; }
`;
const ColorDot = styled.input.attrs({type:'color'})`width:22px;height:22px;border:none;padding:0;background:transparent;cursor:pointer;border-radius:50%;`;
const ColorSwatches = styled.div`display:flex; gap:5px; flex-wrap:wrap;`;
const Swatch = styled.span<{$c:string;$sel:boolean}>`
  width:16px; height:16px; border-radius:50%; background:${p=>p.$c}; cursor:pointer;
  border:2px solid ${p=>p.$sel?'#fff':'transparent'};
`;

/* ─── Summary ─── */
const Summary = styled.div`display:flex;gap:18px;padding:5px 10px;border-top:1px solid ${C.border};flex-shrink:0;background:${C.surface};`;
const SumItem = styled.div`display:flex;gap:5px;align-items:center;font-size:11px;`;
const SumLabel = styled.span`color:${C.muted};`;
const SumVal = styled.span<{$c?:string}>`color:${p=>p.$c||C.text};font-weight:600;`;

const fmtDt = (ts?:number) => {
  if (!ts) return '—';
  const d = new Date(ts*1000);
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
};

/* ─── Default column widths ─── */
const DEFAULT_WIDTHS: Record<string, number> = {
  orderId:80, side:52, ticker:90, size:56, lev:44,
  entry:80, exit:80, pnl:70, status:64, filledAt:108, exitAt:108,
  exitCond:70, rr:58, risk:58, criteria:160, timeframe:160, mistake:140, notes:200,
};

const COL_WIDTHS_KEY = 'tj_col_widths_v1';

function loadColWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    if (!raw) return DEFAULT_WIDTHS;
    return { ...DEFAULT_WIDTHS, ...JSON.parse(raw) };
  } catch { return DEFAULT_WIDTHS; }
}

function saveColWidths(w: Record<string, number>) {
  try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(w)); } catch {}
}

type ColKey = keyof typeof DEFAULT_WIDTHS;
const COLS: { key:ColKey; label:string }[] = [
  {key:'orderId',label:'Order ID'},{key:'side',label:'Side'},{key:'ticker',label:'Ticker'},
  {key:'size',label:'Size'},{key:'lev',label:'Lev'},{key:'entry',label:'Entry'},
  {key:'exit',label:'Exit'},{key:'pnl',label:'P&L'},{key:'status',label:'Status'},
  {key:'filledAt',label:'Filled At'},{key:'exitAt',label:'Exit At'},
  {key:'exitCond',label:'Exit Cond.'},{key:'rr',label:'R:R'},{key:'risk',label:'Risk'},
  {key:'criteria',label:'Entry Criteria'},{key:'timeframe',label:'Timeframe'},
  {key:'mistake',label:'Mistake'},{key:'notes',label:'Notes'},
];

/* ─── TagDropdown ─── */
interface TagDropProps {
  selectedSnapshots: {id:string;label:string;color:string}[];
  allTags: JournalTag[];
  onChange: (snaps:{id:string;label:string;color:string}[]) => void;
  onManage: () => void;
}
const TagDropdown: React.FC<TagDropProps> = ({selectedSnapshots, allTags, onChange, onManage}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({top:0,left:0});
  const btnRef = useRef<HTMLButtonElement>(null);

  const openDrop = (e:React.MouseEvent) => {
    e.stopPropagation();
    const r = btnRef.current!.getBoundingClientRect();
    setPos({top:r.bottom+4, left:r.left});
    setOpen(true);
  };

  // Merge: active tag definitions + any orphaned snapshots whose tag was deleted
  const selectedIds = selectedSnapshots.map(s=>s.id);
  const allVisible = [
    ...allTags,
    ...selectedSnapshots.filter(s=>!allTags.find(t=>t.id===s.id)).map(s=>({...s})),
  ];

  const toggle = (tag:{id:string;label:string;color:string}) => {
    const already = selectedSnapshots.find(s=>s.id===tag.id);
    if (already) {
      onChange(selectedSnapshots.filter(s=>s.id!==tag.id));
    } else {
      onChange([...selectedSnapshots, {id:tag.id, label:tag.label, color:tag.color}]);
    }
  };

  return (
    <BadgeRow>
      {selectedSnapshots.map(s=>(
        <Badge key={s.id} $color={s.color} onClick={openDrop}>{s.label}</Badge>
      ))}
      <AddTagBtn ref={btnRef} onClick={openDrop}>{selectedSnapshots.length===0?'+ tag':'+'}</AddTagBtn>
      {open && <>
        <DropOverlay onClick={()=>setOpen(false)}/>
        <Drop $top={pos.top} $left={pos.left}>
          {allVisible.length===0 && <div style={{padding:'8px 12px',color:C.dim,fontSize:10}}>No tags yet</div>}
          {allVisible.map(t=>{
            const sel=selectedIds.includes(t.id);
            return (
              <DropItem key={t.id} $sel={sel} $color={t.color} onClick={e=>{e.stopPropagation();toggle(t);}}>
                <DropDot $color={t.color}/>
                <DropLabel $color={t.color} $sel={sel}>{t.label}</DropLabel>
                {sel&&<span style={{marginLeft:'auto',fontSize:10,color:t.color}}>✓</span>}
              </DropItem>
            );
          })}
          <DropFooter>
            <DropFooterBtn onClick={()=>{onManage();setOpen(false);}}>⚙ Manage tags</DropFooterBtn>
            <DropFooterBtn onClick={()=>setOpen(false)}>Done</DropFooterBtn>
          </DropFooter>
        </Drop>
      </>}
    </BadgeRow>
  );
};

/* ─── Main ─── */
const TradeJournal: React.FC = () => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [criteriaTags, setCriteriaTags] = useState<JournalTag[]>([]);
  const [timeframeTags, setTimeframeTags] = useState<JournalTag[]>([]);
  const [showTagManager, setShowTagManager] = useState(false);
  const [tagTab, setTagTab] = useState<'criteria'|'timeframe'>('criteria');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(PRESETS[0]);
  const [colWidths, setColWidths] = useState<Record<string,number>>(loadColWidths);
  const [edits, setEdits] = useState<Record<string,Partial<JournalEntry>>>({});

  const reload = useCallback(()=>{
    setEntries(tradeJournalRepository.getAll());
    setCriteriaTags(tradeJournalRepository.getCriteriaTags());
    setTimeframeTags(tradeJournalRepository.getTimeframeTags());
  },[]);

  useEffect(()=>{
    reload();
    const u1=EventBus.on(Events.POSITION_CLOSED,()=>setTimeout(reload,120));
    const u2=EventBus.on(Events.ORDER_FILLED,()=>setTimeout(reload,120));
    const u3=EventBus.on(Events.POSITION_OPENED,()=>setTimeout(reload,120));
    return ()=>{u1();u2();u3();};
  },[reload]);

  /* ─── Column resize ─── */
  const startColResize = (key:string, e:React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('tj-dragging');
    const startX = e.clientX;
    const startW = colWidths[key];
    const onMove = (ev:MouseEvent) => {
      const next = Math.max(40, startW + ev.clientX - startX);
      setColWidths(p => {
        const updated = {...p, [key]: next};
        saveColWidths(updated);
        return updated;
      });
    };
    const onUp = () => {
      document.body.classList.remove('tj-dragging');
      window.removeEventListener('mousemove',onMove);
      window.removeEventListener('mouseup',onUp);
    };
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
  };

  /* ─── Field helpers ─── */
  const getVal = <K extends keyof JournalEntry>(id:string, field:K, fallback:JournalEntry[K]):JournalEntry[K] =>
    (edits[id]?.[field] as JournalEntry[K])??fallback;

  const setField = (id:string, field:keyof JournalEntry, value:unknown) => {
    setEdits(p=>({...p,[id]:{...p[id],[field]:value}}));
    tradeJournalRepository.updateEditable(id,{[field]:value} as any);
    reload();
  };

  /* Tag snapshots: store label+color inline so entries survive tag deletion */
  const setTagSnaps = (id:string, field:'entryCriteriaTags'|'entryTimeframeTags', snaps:{id:string;label:string;color:string}[]) => {
    tradeJournalRepository.updateEditable(id,{[field]:snaps} as any);
    reload();
  };

  /* ─── Tag manager ─── */
  const activeTags = tagTab==='criteria'?criteriaTags:timeframeTags;
  const addTag = () => {
    if (!newLabel.trim()) return;
    const tag:JournalTag = {id:`tag_${Date.now()}`,label:newLabel.trim(),color:newColor};
    tagTab==='criteria'?tradeJournalRepository.upsertCriteriaTag(tag):tradeJournalRepository.upsertTimeframeTag(tag);
    setNewLabel(''); setNewColor(PRESETS[0]); reload();
  };
  const deleteTag = (id:string) => {
    // Deleting a tag from the library does NOT remove it from journal entries —
    // entries store snapshots (label+color) so historical context is preserved.
    // The tag just disappears from the selection dropdown for future use.
    tagTab==='criteria'?tradeJournalRepository.deleteCriteriaTag(id):tradeJournalRepository.deleteTimeframeTag(id);
    reload();
  };

  if (entries.length===0) return (
    <Wrap>
      <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,color:C.dim}}>
        <span style={{fontSize:14}}>📒</span>
        <span>No journal entries yet</span>
        <span style={{fontSize:10}}>Entries are created automatically when orders fill</span>
      </div>
    </Wrap>
  );

  const closedEntries = entries.filter(e=>e.status==='closed');
  const totalPnL = closedEntries.reduce((s,e)=>s+e.pnl,0);
  const wins = closedEntries.filter(e=>e.pnl>0).length;
  const winRate = closedEntries.length>0?((wins/closedEntries.length)*100).toFixed(0):'0';

  return (
    <Wrap>
      <GlobalStyle/>
      <Toolbar>
        <span style={{color:C.muted,fontSize:10,marginRight:4}}>{entries.length} trade{entries.length!==1?'s':''}</span>
        <ToolBtn onClick={()=>setShowTagManager(true)}>⚙ Manage Tags</ToolBtn>
      </Toolbar>

      <TableWrap>
        <Table style={{width:COLS.reduce((s,c)=>s+colWidths[c.key],0)}}>
          <thead>
            <tr>
              {COLS.map(col=>(
                <ResizableTH key={col.key} $w={colWidths[col.key]} style={{position:'sticky',top:0}}>
                  {col.label}
                  <ResizeHandle onMouseDown={e=>startColResize(col.key,e)}/>
                </ResizableTH>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(e=>{
              // Tag snapshots: stored as {id,label,color}[] on the entry
              const criteriaSnaps = ((e as any).entryCriteriaTags as any[])?.filter(Boolean) ?? [];
              const timeframeSnaps = ((e as any).entryTimeframeTags as any[])?.filter(Boolean) ?? [];

              const handleRowClick = () => {
                // Scroll the active chart to the candle where the order was filled
                if (e.fillDatetime) {
                  EventBus.emit(Events.SCROLL_TO_TIME, { time: e.fillDatetime });
                }
              };

              return (
                <TR key={e.id} onClick={handleRowClick} style={{cursor:'pointer'}}>
                  <TD style={{width:colWidths.orderId}}><span style={{fontFamily:'monospace',fontSize:10,color:C.muted}}>{e.orderId}</span></TD>
                  <TD style={{width:colWidths.side}}><SidePill $s={e.side}>{e.side.toUpperCase()}</SidePill></TD>
                  <TD style={{width:colWidths.ticker,fontWeight:500}}>{e.ticker}</TD>
                  <TD style={{width:colWidths.size,fontVariantNumeric:'tabular-nums'}}>{e.size}</TD>
                  <TD style={{width:colWidths.lev,color:C.muted}}>{e.leverage}×</TD>
                  <TD style={{width:colWidths.entry,fontVariantNumeric:'tabular-nums'}}>{e.entryPrice.toFixed(4)}</TD>
                  <TD style={{width:colWidths.exit,fontVariantNumeric:'tabular-nums',color:C.muted}}>{e.exitPrice?.toFixed(4)??'—'}</TD>
                  <TD style={{width:colWidths.pnl}}>
                    {e.status==='closed'?<PnLText $v={e.pnl}>{e.pnl>=0?'+':''}{e.pnl.toFixed(2)}</PnLText>:<span style={{color:C.dim}}>open</span>}
                  </TD>
                  <TD style={{width:colWidths.status}}><StatusDot $open={e.status==='open'}/><span style={{color:C.muted,fontSize:10}}>{e.status==='closed'?'closed':'OPEN'}</span></TD>
                  <TD style={{width:colWidths.filledAt,color:C.muted,fontSize:10}}>{fmtDt(e.fillDatetime)}</TD>
                  <TD style={{width:colWidths.exitAt,color:C.muted,fontSize:10}}>{fmtDt(e.exitDatetime)}</TD>
                  <TD style={{width:colWidths.exitCond}}>
                    {e.exitCondition?<span style={{color:e.exitCondition==='tp'?C.green:e.exitCondition==='sl'?C.red:C.muted,fontSize:10,fontWeight:600,textTransform:'uppercase'}}>{e.exitCondition}</span>:<span style={{color:C.dim}}>—</span>}
                  </TD>
                  <TD style={{width:colWidths.rr}}>
                    <InlineInput value={getVal(e.id,'riskReward',e.riskReward??'') as string} placeholder="1:2" onChange={ev=>setField(e.id,'riskReward',ev.target.value)}/>
                  </TD>
                  <TD style={{width:colWidths.risk}}>
                    <InlineInput value={getVal(e.id,'risk',e.risk??'') as string} placeholder="50" onChange={ev=>setField(e.id,'risk',ev.target.value)}/>
                  </TD>
                  <TD style={{width:colWidths.criteria}}>
                    <TagDropdown
                      selectedSnapshots={criteriaSnaps}
                      allTags={criteriaTags}
                      onChange={snaps=>setTagSnaps(e.id,'entryCriteriaTags',snaps)}
                      onManage={()=>{setTagTab('criteria');setShowTagManager(true);}}
                    />
                  </TD>
                  <TD style={{width:colWidths.timeframe}}>
                    <TagDropdown
                      selectedSnapshots={timeframeSnaps}
                      allTags={timeframeTags}
                      onChange={snaps=>setTagSnaps(e.id,'entryTimeframeTags',snaps)}
                      onManage={()=>{setTagTab('timeframe');setShowTagManager(true);}}
                    />
                  </TD>
                  <TD style={{width:colWidths.mistake}}>
                    <InlineInput value={getVal(e.id,'mistake',e.mistake??'') as string} placeholder="What went wrong…" onChange={ev=>setField(e.id,'mistake',ev.target.value)}/>
                  </TD>
                  <TD style={{width:colWidths.notes}}>
                    <InlineInput value={getVal(e.id,'notes',e.notes??'') as string} placeholder="Notes…" onChange={ev=>setField(e.id,'notes',ev.target.value)} style={{minWidth:180}}/>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      <Summary>
        <SumItem><SumLabel>P&L:</SumLabel><SumVal $c={totalPnL>=0?C.green:C.red}>{totalPnL>=0?'+':''}{totalPnL.toFixed(2)}</SumVal></SumItem>
        <SumItem><SumLabel>Win Rate:</SumLabel><SumVal $c={Number(winRate)>=50?C.green:C.red}>{winRate}%</SumVal></SumItem>
        <SumItem><SumLabel>Trades:</SumLabel><SumVal>{entries.length}</SumVal></SumItem>
        <SumItem><SumLabel>Closed:</SumLabel><SumVal>{closedEntries.length}</SumVal></SumItem>
      </Summary>

      {/* ─── Tag Manager Modal (tabbed) ─── */}
      {showTagManager&&(
        <Overlay onClick={()=>setShowTagManager(false)}>
          <Modal onClick={e=>e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>Tag Library</ModalTitle>
              <TabRow>
                <Tab $active={tagTab==='criteria'} onClick={()=>setTagTab('criteria')}>Entry Criteria</Tab>
                <Tab $active={tagTab==='timeframe'} onClick={()=>setTagTab('timeframe')}>Timeframe</Tab>
              </TabRow>
            </ModalHeader>
            <ModalBody>
              {activeTags.length===0&&<div style={{color:C.dim,fontSize:11}}>No tags yet — create one below.</div>}
              {activeTags.map(t=>(
                <TagRow key={t.id}>
                  <Badge $color={t.color}>{t.label}</Badge>
                  <div style={{flex:1}}/>
                  <DelBtn onClick={()=>deleteTag(t.id)}>✕</DelBtn>
                </TagRow>
              ))}
              <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10,display:'flex',flexDirection:'column',gap:8}}>
                <TagRow>
                  <ColorDot value={newColor} onChange={e=>setNewColor(e.target.value)}/>
                  <MInput placeholder="Tag name…" value={newLabel} onChange={e=>setNewLabel(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTag()}/>
                  <PrimaryBtn onClick={addTag}>Add</PrimaryBtn>
                </TagRow>
                <ColorSwatches>
                  {PRESETS.map(c=><Swatch key={c} $c={c} $sel={newColor===c} onClick={()=>setNewColor(c)}/>)}
                </ColorSwatches>
              </div>
            </ModalBody>
            <ModalFooter>
              <PrimaryBtn onClick={()=>setShowTagManager(false)}>Done</PrimaryBtn>
            </ModalFooter>
          </Modal>
        </Overlay>
      )}
    </Wrap>
  );
};

export default TradeJournal;
