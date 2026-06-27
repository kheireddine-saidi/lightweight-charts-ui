/**
 * TradeJournalRepository — persists trade journal entries.
 *
 * Uses localStorage now; interface is backend-ready (swap the
 * _load / _save methods for API calls without changing consumers).
 */

export interface JournalTag {
  id: string;
  label: string;
  color: string;
}

export interface JournalEntry {
  // Auto-populated from fill event
  id: string;           // matches orderId
  orderId: string;
  ticker: string;
  side: 'long' | 'short';
  size: number;
  leverage: number;
  entryPrice: number;
  exitPrice?: number;
  status: 'open' | 'closed';
  fillDatetime: number;   // unix seconds
  exitDatetime?: number;
  exitCondition?: 'sl' | 'tp' | 'manual' | string;
  pnl: number;
  pnlPercent: number;

  // Editable by trader
  riskReward?: string;
  risk?: string;
  entryCriteriaTags: string[];  // tag ids
  entryTimeframeTags: string[]; // tag ids
  mistake?: string;
  notes?: string;
}

const ENTRIES_KEY = 'tj_entries_v1';
const TAGS_KEY    = 'tj_tags_v1';

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.warn('[TradeJournalRepository] localStorage write failed');
  }
}

class TradeJournalRepositoryClass {
  // ── Entries ──────────────────────────────────────────────────────────────

  getAll(): JournalEntry[] {
    return loadJSON<JournalEntry[]>(ENTRIES_KEY, []);
  }

  getById(id: string): JournalEntry | undefined {
    return this.getAll().find((e) => e.id === id);
  }

  upsert(entry: JournalEntry): void {
    const all = this.getAll();
    const idx = all.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      all[idx] = entry;
    } else {
      all.unshift(entry);
    }
    saveJSON(ENTRIES_KEY, all);
  }

  updateEditable(
    id: string,
    fields: Partial<Pick<JournalEntry,
      'riskReward' | 'risk' | 'entryCriteriaTags' | 'entryTimeframeTags' | 'mistake' | 'notes'
    >>
  ): void {
    const all = this.getAll();
    const idx = all.findIndex((e) => e.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx], ...fields };
    saveJSON(ENTRIES_KEY, all);
  }

  /** Called when a position closes — patch the open entry with exit data. */
  closeEntry(id: string, exitPrice: number, exitDatetime: number, exitCondition: string, pnl: number, pnlPercent: number): void {
    const all = this.getAll();
    const idx = all.findIndex((e) => e.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx], exitPrice, exitDatetime, exitCondition, pnl, pnlPercent, status: 'closed' };
    saveJSON(ENTRIES_KEY, all);
  }

  // ── Tags ─────────────────────────────────────────────────────────────────

  getTags(): JournalTag[] {
    return loadJSON<JournalTag[]>(TAGS_KEY, []);
  }

  upsertTag(tag: JournalTag): void {
    const all = this.getTags();
    const idx = all.findIndex((t) => t.id === tag.id);
    if (idx >= 0) {
      all[idx] = tag;
    } else {
      all.push(tag);
    }
    saveJSON(TAGS_KEY, all);
  }

  deleteTag(id: string): void {
    const all = this.getTags().filter((t) => t.id !== id);
    saveJSON(TAGS_KEY, all);
  }
}

export const tradeJournalRepository = new TradeJournalRepositoryClass();
