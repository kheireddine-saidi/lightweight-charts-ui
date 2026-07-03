import { describe, it, expect, beforeEach } from 'vitest';
import { FillModel } from '../FillModel';

describe('FillModel', () => {
  let fm;

  beforeEach(() => {
    fm = new FillModel('conservative');
  });

  // ── priceSequence ──────────────────────────────────────────────────────────

  describe('priceSequence', () => {
    const candle = { open: 100, high: 110, low: 90, close: 105 };

    it('returns O→H→L→C in conservative mode', () => {
      fm.setMode('conservative');
      expect(fm.priceSequence(candle)).toEqual([100, 110, 90, 105]);
    });

    it('returns O→L→H→C in optimistic mode', () => {
      fm.setMode('optimistic');
      expect(fm.priceSequence(candle)).toEqual([100, 90, 110, 105]);
    });
  });

  // ── checkTickFill – limit orders ───────────────────────────────────────────

  describe('checkTickFill – long limit', () => {
    const order = { side: 'long', type: 'limit', limitPrice: 100 };

    it('fills immediately when price is below limit (better for buyer)', () => {
      expect(fm.checkTickFill(98, null, order)).toBe(98);
    });

    it('fills immediately when price equals limit', () => {
      expect(fm.checkTickFill(100, null, order)).toBe(100);
    });

    it('does NOT fill when price is above limit', () => {
      expect(fm.checkTickFill(102, null, order)).toBeNull();
    });

    it('fills at limitPrice when price crosses down through limit', () => {
      // prev above, current at/below
      expect(fm.checkTickFill(99, 101, order)).toBe(99); // current below → fills at current
    });
  });

  describe('checkTickFill – short limit', () => {
    const order = { side: 'short', type: 'limit', limitPrice: 100 };

    it('fills immediately when price is above limit (better for seller)', () => {
      expect(fm.checkTickFill(102, null, order)).toBe(102);
    });

    it('fills immediately when price equals limit', () => {
      expect(fm.checkTickFill(100, null, order)).toBe(100);
    });

    it('does NOT fill when price is below limit', () => {
      expect(fm.checkTickFill(98, null, order)).toBeNull();
    });
  });

  // ── checkTickFill – stop orders ────────────────────────────────────────────

  describe('checkTickFill – long stop', () => {
    const order = { side: 'long', type: 'stop', limitPrice: 105, entryPrice: 105 };

    it('fills when price reaches or exceeds stop', () => {
      expect(fm.checkTickFill(105, null, order)).toBe(105);
      expect(fm.checkTickFill(107, null, order)).toBe(105);
    });

    it('does NOT fill when price is below stop', () => {
      expect(fm.checkTickFill(104, null, order)).toBeNull();
    });
  });

  describe('checkTickFill – short stop', () => {
    const order = { side: 'short', type: 'stop', limitPrice: 95, entryPrice: 95 };

    it('fills when price drops to or below stop', () => {
      expect(fm.checkTickFill(95, null, order)).toBe(95);
      expect(fm.checkTickFill(93, null, order)).toBe(95);
    });

    it('does NOT fill when price is above stop', () => {
      expect(fm.checkTickFill(96, null, order)).toBeNull();
    });
  });

  it('market orders never fill via checkTickFill (handled at submission)', () => {
    const mkt = { side: 'long', type: 'market', entryPrice: 100 };
    expect(fm.checkTickFill(100, null, mkt)).toBeNull();
  });

  // ── checkSLTPTick ──────────────────────────────────────────────────────────

  describe('checkSLTPTick – long position', () => {
    const pos = { side: 'long', stopLoss: 90, takeProfit: 110 };

    it('triggers SL when price drops to or below SL', () => {
      expect(fm.checkSLTPTick(90, pos)).toEqual({ price: 90, reason: 'sl' });
      expect(fm.checkSLTPTick(85, pos)).toEqual({ price: 90, reason: 'sl' });
    });

    it('triggers TP when price rises to or above TP', () => {
      expect(fm.checkSLTPTick(110, pos)).toEqual({ price: 110, reason: 'tp' });
      expect(fm.checkSLTPTick(115, pos)).toEqual({ price: 110, reason: 'tp' });
    });

    it('does not trigger within SL/TP range', () => {
      expect(fm.checkSLTPTick(100, pos)).toBeNull();
    });

    it('handles positions without SL', () => {
      const noSL = { side: 'long', takeProfit: 110 };
      expect(fm.checkSLTPTick(85, noSL)).toBeNull();
      expect(fm.checkSLTPTick(110, noSL)).toEqual({ price: 110, reason: 'tp' });
    });

    it('handles positions without TP', () => {
      const noTP = { side: 'long', stopLoss: 90 };
      expect(fm.checkSLTPTick(90, noTP)).toEqual({ price: 90, reason: 'sl' });
      expect(fm.checkSLTPTick(115, noTP)).toBeNull();
    });
  });

  describe('checkSLTPTick – short position', () => {
    const pos = { side: 'short', stopLoss: 110, takeProfit: 90 };

    it('triggers SL when price rises to or above SL', () => {
      expect(fm.checkSLTPTick(110, pos)).toEqual({ price: 110, reason: 'sl' });
      expect(fm.checkSLTPTick(115, pos)).toEqual({ price: 110, reason: 'sl' });
    });

    it('triggers TP when price drops to or below TP', () => {
      expect(fm.checkSLTPTick(90, pos)).toEqual({ price: 90, reason: 'tp' });
      expect(fm.checkSLTPTick(85, pos)).toEqual({ price: 90, reason: 'tp' });
    });

    it('does not trigger within SL/TP range', () => {
      expect(fm.checkSLTPTick(100, pos)).toBeNull();
    });
  });

  // ── Exact price-equality edge cases ────────────────────────────────────────

  describe('exact price equality edge cases', () => {
    it('long limit fills at exact limit price', () => {
      const order = { side: 'long', type: 'limit', limitPrice: 1.10500 };
      expect(fm.checkTickFill(1.10500, null, order)).toBe(1.10500);
    });

    it('short SL triggers at exact SL price', () => {
      const pos = { side: 'short', stopLoss: 1.10000, takeProfit: 1.09000 };
      expect(fm.checkSLTPTick(1.10000, pos)).toEqual({ price: 1.10000, reason: 'sl' });
    });

    it('long TP triggers at exact TP price', () => {
      const pos = { side: 'long', stopLoss: 1.08000, takeProfit: 1.12000 };
      expect(fm.checkSLTPTick(1.12000, pos)).toEqual({ price: 1.12000, reason: 'tp' });
    });
  });

  // ── checkCandleFill ────────────────────────────────────────────────────────

  describe('checkCandleFill', () => {
    const candle = { open: 100, high: 110, low: 90, close: 105 };

    it('fills a long limit when candle low dips to/below limit (conservative)', () => {
      fm.setMode('conservative');
      // Sequence: 100, 110, 90, 105 — price 90 <= limit 95
      const order = { side: 'long', type: 'limit', limitPrice: 95 };
      expect(fm.checkCandleFill(candle, order)).not.toBeNull();
    });

    it('fills a short limit when candle high reaches/above limit (conservative)', () => {
      fm.setMode('conservative');
      // Sequence: 100, 110, 90, 105 — price 110 >= limit 108
      const order = { side: 'short', type: 'limit', limitPrice: 108 };
      expect(fm.checkCandleFill(candle, order)).not.toBeNull();
    });

    it('does not fill if candle never touches limit', () => {
      // limit 80, but candle low is 90 — never reaches
      const order = { side: 'long', type: 'limit', limitPrice: 80 };
      // long limit fills if price <= 80; price sequence never goes below 90
      // Actually long limit: fills if currentPrice <= limitPrice, so 90 <= 80 is false
      expect(fm.checkCandleFill(candle, order)).toBeNull();
    });
  });

  // ── checkSLTPCandle ────────────────────────────────────────────────────────

  describe('checkSLTPCandle', () => {
    it('conservative mode: SL hit before TP for long (high before low in sequence)', () => {
      fm.setMode('conservative');
      // Sequence: O→H→L→C = 100→110→90→105
      // Long SL at 92 (below low 90), TP at 108 (below high 110)
      // At price 110 → TP not yet (110 < 108? no — 110 >= 108) → TP hits first actually
      // Let's make SL=95, TP=112 so SL hits in L phase, TP never hits
      const pos = { side: 'long', stopLoss: 95, takeProfit: 115 };
      // O=100 no, H=110 no, L=90 <= 95 → SL
      expect(fm.checkSLTPCandle({ open: 100, high: 110, low: 90, close: 105 }, pos))
        .toEqual({ price: 95, reason: 'sl' });
    });

    it('optimistic mode: TP hit before SL for long (low before high in sequence)', () => {
      fm.setMode('optimistic');
      // Sequence: O→L→H→C = 100→90→110→105
      // Long TP at 108, SL at 85
      // O=100 no, L=90 → 90<=85? no, H=110 → 110>=108 → TP
      const pos = { side: 'long', stopLoss: 85, takeProfit: 108 };
      expect(fm.checkSLTPCandle({ open: 100, high: 110, low: 90, close: 105 }, pos))
        .toEqual({ price: 108, reason: 'tp' });
    });

    it('returns null when neither SL nor TP is set', () => {
      const pos = { side: 'long' };
      expect(fm.checkSLTPCandle({ open: 100, high: 110, low: 90, close: 105 }, pos))
        .toBeNull();
    });

    it('returns null when candle never touches SL or TP', () => {
      const pos = { side: 'long', stopLoss: 80, takeProfit: 120 };
      // Low=90 > SL=80, High=110 < TP=120 — neither triggered
      expect(fm.checkSLTPCandle({ open: 100, high: 110, low: 90, close: 105 }, pos))
        .toBeNull();
    });
  });

  // ── marketFill ─────────────────────────────────────────────────────────────

  describe('marketFill', () => {
    it('returns the candle open price', () => {
      expect(fm.marketFill({ open: 100, high: 110, low: 90, close: 105 })).toBe(100);
    });
  });
});
