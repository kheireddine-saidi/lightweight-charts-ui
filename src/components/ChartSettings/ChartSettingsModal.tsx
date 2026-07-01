/**
 * ChartSettingsModal — modal for chart display settings.
 * Opened from the Topbar settings (gear) icon.
 *
 * Settings: grid lines on/off, background color, bull/bear bar colors,
 * magnet snap threshold (pixels).
 *
 * Changes apply live — ChartComponent watches chartSettingsStore and
 * re-applies chart.applyOptions() / series.applyOptions() on every change.
 */
import React from 'react';
import styled from 'styled-components';
import { useChartSettingsStore } from '../../stores/chartSettingsStore';

interface Theme {
  bg: string; surface: string; elevated: string; border: string;
  text: string; muted: string; dim: string; blue: string;
}

const DARK: Theme = {
  bg: '#131722', surface: '#1e222d', elevated: '#2a2e39', border: '#2a2e39',
  text: '#d1d4dc', muted: '#787b86', dim: '#555b6e', blue: '#2962ff',
};
const LIGHT: Theme = {
  bg: '#ffffff', surface: '#f8f9fb', elevated: '#eef0f3', border: '#e0e3eb',
  text: '#131722', muted: '#5d606b', dim: '#9598a1', blue: '#2962ff',
};

const Overlay = styled.div`
  position: fixed; inset: 0; background: rgba(0,0,0,.5);
  z-index: 3000; display: flex; align-items: center; justify-content: center;
`;

const Modal = styled.div<{ $t: Theme }>`
  background: ${(p) => p.$t.surface};
  border: 1px solid ${(p) => p.$t.border};
  border-radius: 10px;
  width: 340px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 16px 48px rgba(0,0,0,.5);
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  color: ${(p) => p.$t.text};
`;

const Header = styled.div<{ $t: Theme }>`
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid ${(p) => p.$t.border};
`;

const Title = styled.div` font-size: 14px; font-weight: 700; `;

const CloseBtn = styled.button<{ $t: Theme }>`
  background: transparent; border: none; cursor: pointer;
  color: ${(p) => p.$t.muted}; font-size: 18px; line-height: 1;
  &:hover { color: ${(p) => p.$t.text}; }
`;

const Body = styled.div` padding: 16px 18px; display: flex; flex-direction: column; gap: 16px; `;

const Section = styled.div` display: flex; flex-direction: column; gap: 8px; `;
const SectionLabel = styled.div<{ $t: Theme }>`
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
  color: ${(p) => p.$t.muted};
`;

const Row = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
`;

const RowLabel = styled.span<{ $t: Theme }>` font-size: 12px; color: ${(p) => p.$t.text}; `;

const Toggle = styled.button<{ $on: boolean; $t: Theme }>`
  width: 36px; height: 18px; border-radius: 9px; border: none; cursor: pointer;
  background: ${(p) => (p.$on ? p.$t.blue : p.$t.elevated)};
  position: relative; transition: background .15s; flex-shrink: 0;
  &::after {
    content: ''; position: absolute; top: 2px;
    left: ${(p) => (p.$on ? '20px' : '2px')};
    width: 14px; height: 14px; border-radius: 50%;
    background: #fff; transition: left .15s;
  }
`;

const ColorRow = styled.div`
  display: flex; align-items: center; gap: 8px;
`;

const ColorSwatch = styled.input.attrs({ type: 'color' })`
  width: 28px; height: 28px; border: none; padding: 0;
  background: transparent; cursor: pointer; border-radius: 6px;
`;

const ColorHex = styled.span<{ $t: Theme }>`
  font-size: 11px; color: ${(p) => p.$t.muted}; font-family: monospace;
`;

const ResetLink = styled.button<{ $t: Theme }>`
  font-size: 11px; color: ${(p) => p.$t.muted}; background: transparent;
  border: none; cursor: pointer; text-align: left; padding: 0; margin-top: 2px;
  &:hover { color: ${(p) => p.$t.text}; text-decoration: underline; }
`;

const SliderRow = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;

const SliderTrack = styled.input.attrs({ type: 'range' })`
  width: 100%; accent-color: ${(p: { theme?: Theme }) => p.theme?.blue ?? '#2962ff'};
`;

const SliderValue = styled.span<{ $t: Theme }>`
  font-size: 11px; color: ${(p) => p.$t.muted}; align-self: flex-end;
`;

const Footer = styled.div<{ $t: Theme }>`
  padding: 12px 18px; border-top: 1px solid ${(p) => p.$t.border};
  display: flex; justify-content: space-between; align-items: center;
`;

const Btn = styled.button<{ $primary?: boolean; $t: Theme }>`
  padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
  border: ${(p) => (p.$primary ? 'none' : `1px solid ${p.$t.border}`)};
  background: ${(p) => (p.$primary ? p.$t.blue : 'transparent')};
  color: ${(p) => (p.$primary ? '#fff' : p.$t.muted)};
  &:hover { opacity: .9; }
`;

interface ChartSettingsModalProps {
  onClose: () => void;
  theme?: 'dark' | 'light';
}

const ChartSettingsModal: React.FC<ChartSettingsModalProps> = ({ onClose, theme = 'dark' }) => {
  const t = theme === 'light' ? LIGHT : DARK;
  const settings = useChartSettingsStore();
  const { setSetting, resetSettings } = settings;

  return (
    <Overlay onClick={onClose}>
      <Modal $t={t} onClick={(e) => e.stopPropagation()}>
        <Header $t={t}>
          <Title>Chart Settings</Title>
          <CloseBtn $t={t} onClick={onClose}>✕</CloseBtn>
        </Header>

        <Body>
          <Section>
            <SectionLabel $t={t}>Appearance</SectionLabel>
            <Row>
              <RowLabel $t={t}>Grid lines</RowLabel>
              <Toggle
                $on={settings.showGrid}
                $t={t}
                onClick={() => setSetting('showGrid', !settings.showGrid)}
              />
            </Row>
            <Row>
              <RowLabel $t={t}>Background color</RowLabel>
              <ColorRow>
                <ColorSwatch
                  value={settings.backgroundColor ?? (theme === 'light' ? '#ffffff' : '#131722')}
                  onChange={(e) => setSetting('backgroundColor', e.target.value)}
                />
                <ColorHex $t={t}>{settings.backgroundColor ?? 'default'}</ColorHex>
              </ColorRow>
            </Row>
            {settings.backgroundColor && (
              <ResetLink $t={t} onClick={() => setSetting('backgroundColor', null)}>
                Reset to theme default
              </ResetLink>
            )}
          </Section>

          <Section>
            <SectionLabel $t={t}>Candle Colors</SectionLabel>
            <Row>
              <RowLabel $t={t}>Bullish</RowLabel>
              <ColorRow>
                <ColorSwatch
                  value={settings.bullColor}
                  onChange={(e) => setSetting('bullColor', e.target.value)}
                />
                <ColorHex $t={t}>{settings.bullColor}</ColorHex>
              </ColorRow>
            </Row>
            <Row>
              <RowLabel $t={t}>Bearish</RowLabel>
              <ColorRow>
                <ColorSwatch
                  value={settings.bearColor}
                  onChange={(e) => setSetting('bearColor', e.target.value)}
                />
                <ColorHex $t={t}>{settings.bearColor}</ColorHex>
              </ColorRow>
            </Row>
          </Section>

          <Section>
            <SectionLabel $t={t}>Magnet Mode</SectionLabel>
            <SliderRow>
              <Row>
                <RowLabel $t={t}>Snap threshold</RowLabel>
                <SliderValue $t={t}>{settings.magnetThresholdPx}px</SliderValue>
              </Row>
              <SliderTrack
                min={2} max={40} step={1}
                value={settings.magnetThresholdPx}
                onChange={(e) => setSetting('magnetThresholdPx', parseInt(e.target.value))}
              />
              <span style={{ fontSize: 10, color: t.dim }}>
                If the cursor is farther than this from the nearest OHLC point, the raw cursor position is used instead of snapping.
              </span>
            </SliderRow>
          </Section>
        </Body>

        <Footer $t={t}>
          <ResetLink $t={t} onClick={resetSettings}>Reset all to defaults</ResetLink>
          <Btn $primary $t={t} onClick={onClose}>Done</Btn>
        </Footer>
      </Modal>
    </Overlay>
  );
};

export default ChartSettingsModal;
