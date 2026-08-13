/**
 * Storage abstraction (PRD §4.3 step 5, §6).
 *
 * Two implementations:
 *  - SqliteStore: op-sqlite with FTS5 for keyword search; embeddings as BLOBs.
 *    This is what runs on device. One file → easy encrypted backup (§6).
 *  - MemoryStore: pure-JS fallback used by unit tests and as a safety net when
 *    the native module is unavailable (e.g. web preview).
 */

import {
  ActivityLogEntry,
  Category,
  ReminderSuggestion,
  ScreenshotRecord,
  SearchFilters,
  Settings,
} from '../types';

export interface KeywordHit {
  screenshotId: string;
  /** BM25-style rank; lower is better in FTS5, normalized to higher-is-better here. */
  score: number;
  snippet: string | null;
}

export interface SnapStore {
  init(): Promise<void>;

  upsertScreenshot(record: ScreenshotRecord): Promise<void>;
  getScreenshot(id: string): Promise<ScreenshotRecord | null>;
  getScreenshotByAssetId(assetId: string): Promise<ScreenshotRecord | null>;
  deleteScreenshot(id: string): Promise<void>;
  markOriginalDeleted(assetId: string): Promise<void>;
  listScreenshots(filters?: SearchFilters, limit?: number, offset?: number): Promise<ScreenshotRecord[]>;
  countScreenshots(): Promise<number>;
  countByCategory(): Promise<Partial<Record<Category, number>>>;

  /** FTS5 keyword search (BM25). Returns normalized scores in [0, 1]. */
  keywordSearch(query: string, filters?: SearchFilters, limit?: number): Promise<KeywordHit[]>;
  /** All records that have embeddings, for brute-force / vec-index semantic scan. */
  listEmbedded(filters?: SearchFilters): Promise<ScreenshotRecord[]>;

  upsertReminder(reminder: ReminderSuggestion): Promise<void>;
  getReminder(id: string): Promise<ReminderSuggestion | null>;
  listReminders(status?: ReminderSuggestion['status']): Promise<ReminderSuggestion[]>;

  appendActivity(entry: ActivityLogEntry): Promise<void>;
  listActivity(limit?: number): Promise<ActivityLogEntry[]>;

  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  close(): Promise<void>;
}

/** Simple tokenizer shared by MemoryStore search and snippet extraction. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9₹@._-]+/)
    .filter(t => t.length > 0);
}

/** Extract a short snippet around the first occurrence of any query token. */
export function makeSnippet(text: string, query: string, radius: number = 60): string | null {
  const lower = text.toLowerCase();
  for (const token of tokenize(query)) {
    const idx = lower.indexOf(token);
    if (idx >= 0) {
      const start = Math.max(0, idx - radius);
      const end = Math.min(text.length, idx + token.length + radius);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < text.length ? '…' : '';
      return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
    }
  }
  return null;
}
