/**
 * SourceEditor — Pine Script source code editor.
 * Replaces the PositionsPanel when a user opens an indicator's source.
 * Toolbar: Save | Cancel | indicator title.
 */
import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useIndicatorStore, refreshIndicatorMeta } from '../../stores/indicatorStore';
import type { UserIndicator } from '../../stores/indicatorStore';

const C = {
  bg:'#131722', surface:'#1e222d', elevated:'#2a2e39',
  border:'#2a2e39', text:'#d1d4dc', muted:'#787b86',
  blue:'#2962ff', red:'#f23645', green:'#089981',
};

const Wrap = styled.div`
  display:flex; flex-direction:column; height:100%;
  background:${C.bg}; font-family:'JetBrains Mono',monospace, 'Fira Code',monospace,'Courier New',monospace;
`;
const Bar = styled.div`
  display:flex; align-items:center; gap:8px; padding:6px 12px;
  background:${C.surface}; border-bottom:1px solid ${C.border};
  flex-shrink:0;
`;
const BarTitle = styled.div`
  flex:1; font-size:12px; font-weight:600; color:${C.text};
  font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
`;
const TitleInput = styled.input`
  flex:1; background:transparent; border:none; border-bottom:1px solid ${C.border};
  color:${C.text}; font-size:12px; font-weight:600; outline:none; padding:2px 4px;
  font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
  &:focus { border-bottom-color:${C.blue}; }
`;
const Btn = styled.button<{$primary?:boolean}>`
  padding:4px 12px; border-radius:4px; border:none;
  background:${p=>p.$primary?C.blue:C.elevated};
  color:${p=>p.$primary?'#fff':C.muted};
  font-size:11px; font-weight:600; cursor:pointer;
  font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
  &:hover { opacity:.85; color:${p=>p.$primary?'#fff':C.text}; }
`;
const Editor = styled.textarea`
  flex:1; background:${C.bg}; color:${C.text};
  border:none; outline:none; resize:none;
  font-family:'JetBrains Mono',monospace,'Fira Code',monospace,'Courier New',monospace;
  font-size:12px; line-height:1.7; padding:14px 16px;
  tab-size:4; -moz-tab-size:4;
  &::selection { background:${C.blue}44; }
  &::-webkit-scrollbar { width:5px; }
  &::-webkit-scrollbar-thumb { background:${C.elevated}; border-radius:3px; }
`;
const StatusBar = styled.div`
  padding:3px 12px; background:${C.surface}; border-top:1px solid ${C.border};
  font-size:10px; color:${C.muted}; flex-shrink:0;
  font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
`;

interface SourceEditorProps {
  indicator: UserIndicator;
  onClose: () => void;
}

const SourceEditor: React.FC<SourceEditorProps> = ({ indicator, onClose }) => {
  const { upsert } = useIndicatorStore();
  const [title, setTitle] = useState(indicator.title);
  const [source, setSource] = useState(indicator.source);
  const [dirty, setDirty] = useState(false);
  const [lines, setLines] = useState(1);
  const [col, setCol] = useState(1);

  useEffect(() => {
    setTitle(indicator.title);
    setSource(indicator.source);
    setDirty(false);
  }, [indicator.id]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSource(e.target.value);
    setDirty(true);
    setLines(e.target.value.split('\n').length);
  };

  const onTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    setDirty(true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab → insert 4 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = source.substring(0, start) + '    ' + source.substring(end);
      setSource(next);
      setDirty(true);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 4; });
    }
    // Ctrl+S → save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  const onSelectionChange = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const text = source.substring(0, el.selectionStart);
    const linesCount = text.split('\n').length;
    const colCount = text.split('\n').pop()!.length + 1;
    setLines(source.split('\n').length);
    setCol(colCount);
    // Update line display using linesCount for cursor position
    void linesCount;
  };

  const handleSave = () => {
    const updated = refreshIndicatorMeta({
      ...indicator,
      title: title.trim() || indicator.title,
      source,
    });
    upsert(updated);
    setDirty(false);
    onClose();
  };

  return (
    <Wrap>
      <Bar>
        <TitleInput
          value={title}
          onChange={onTitleChange}
          placeholder="Indicator title"
        />
        {dirty && <span style={{fontSize:10,color:C.muted}}>●</span>}
        <Btn $primary onClick={handleSave}>Save</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </Bar>
      <Editor
        value={source}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSelect={onSelectionChange}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="//@version=5&#10;indicator(&quot;My Indicator&quot;)&#10;plot(ta.sma(close, 20), &quot;SMA&quot;)"
      />
      <StatusBar>
        Pine Script  ·  {source.split('\n').length} lines  ·  Col {col}
        {dirty ? '  ·  Unsaved changes' : '  ·  Saved'}  ·  Ctrl+S to save
      </StatusBar>
    </Wrap>
  );
};

export default SourceEditor;
