/**
 * TradeJournalService — listens to ExecutionEngine events and
 * creates / updates journal entries automatically.
 *
 * Attach once at app boot. React components read from TradeJournalRepository.
 */
import { EventBus, Events } from '../../core/EventBus';
import { tradeJournalRepository } from './TradeJournalRepository';
import type { JournalEntry } from './TradeJournalRepository';

class TradeJournalServiceClass {
  private _started = false;
  private _unsubFilled: (() => void) | null = null;
  private _unsubClosed: (() => void) | null = null;

  start() {
    if (this._started) return;
    this._started = true;

    // When an order is filled → create journal entry
    this._unsubFilled = EventBus.on(Events.ORDER_FILLED, ({ order, fillTime }: any) => {
      const entry: JournalEntry = {
        id: order.id,
        orderId: order.id,
        ticker: order.symbol ?? 'UNKNOWN',
        side: order.side,
        size: order.positionSize,
        leverage: order.leverage,
        entryPrice: order.entryPrice,
        status: 'open',
        fillDatetime: fillTime ?? Math.floor(Date.now() / 1000),
        pnl: 0,
        pnlPercent: 0,
        entryCriteriaTags: [],
        entryTimeframeTags: [],
      };
      tradeJournalRepository.upsert(entry);
    });

    // Market orders don't emit ORDER_FILLED — they go straight to POSITION_OPENED
    EventBus.on(Events.POSITION_OPENED, ({ position }: any) => {
      if (position.type !== 'market') return; // limit/stop handled by ORDER_FILLED
      const existing = tradeJournalRepository.getById(position.id);
      if (existing) return; // already created
      const entry: JournalEntry = {
        id: position.id,
        orderId: position.id,
        ticker: position.symbol ?? 'UNKNOWN',
        side: position.side,
        size: position.positionSize,
        leverage: position.leverage,
        entryPrice: position.entryPrice,
        status: 'open',
        fillDatetime: position.entryTime ?? Math.floor(Date.now() / 1000),
        pnl: 0,
        pnlPercent: 0,
        entryCriteriaTags: [],
        entryTimeframeTags: [],
      };
      tradeJournalRepository.upsert(entry);
    });

    // When a position closes → update the entry
    this._unsubClosed = EventBus.on(Events.POSITION_CLOSED, ({ position, closePrice, closeTime, pnl, reason }: any) => {
      const pnlPercent = (pnl / (position.entryPrice * position.positionSize)) * 100;
      // reason comes directly from ExecutionEngine._finaliseClose: 'sl' | 'tp' | 'manual'
      const condition = reason ?? position.closeReason ?? 'manual';
      tradeJournalRepository.closeEntry(
        position.id,
        closePrice,
        closeTime ?? Math.floor(Date.now() / 1000),
        condition,
        pnl,
        pnlPercent
      );
    });
  }

  stop() {
    this._unsubFilled?.();
    this._unsubClosed?.();
    this._started = false;
  }
}

export const tradeJournalService = new TradeJournalServiceClass();
