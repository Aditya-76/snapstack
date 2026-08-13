/**
 * Pure-JS SnapStore. Used by unit tests and as a graceful fallback when the
 * native SQLite module is unavailable. Keyword search is TF-based rather than
 * BM25 but produces scores in the same normalized [0, 1] space as SqliteStore.
 */

import {
  ActivityLogEntry,
  Category,
  DEFAULT_SETTINGS,
  ReminderSuggestion,
  ScreenshotRecord,
  SearchFilters,
  Settings,
  SENSITIVE_CATEGORIES,
} from '../types';
import { KeywordHit, SnapStore, makeSnippet, tokenize } from './store';

export function passesFilters(record: ScreenshotRecord, filters?: SearchFilters): boolean {
  if (!filters) {
    return true;
  }
  if (filters.categories && filters.categories.length > 0 && !filters.categories.includes(record.category)) {
    return false;
  }
  if (
    !filters.includeSensitive &&
    SENSITIVE_CATEGORIES.includes(record.category) &&
    !(filters.categories ?? []).some(c => SENSITIVE_CATEGORIES.includes(c))
  ) {
    // Sensitive categories are hidden unless explicitly filtered-for or opted-in (PRD §7.7).
    return false;
  }
  if (filters.fromDate != null && record.takenAt < filters.fromDate) {
    return false;
  }
  if (filters.toDate != null && record.takenAt > filters.toDate) {
    return false;
  }
  if (filters.sourceApp && record.sourceApp !== filters.sourceApp) {
    return false;
  }
  return true;
}

export class MemoryStore implements SnapStore {
  private screenshots = new Map<string, ScreenshotRecord>();
  private reminders = new Map<string, ReminderSuggestion>();
  private activity: ActivityLogEntry[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };

  async init(): Promise<void> {}

  async upsertScreenshot(record: ScreenshotRecord): Promise<void> {
    this.screenshots.set(record.id, { ...record });
  }

  async getScreenshot(id: string): Promise<ScreenshotRecord | null> {
    return this.screenshots.get(id) ?? null;
  }

  async getScreenshotByAssetId(assetId: string): Promise<ScreenshotRecord | null> {
    for (const rec of this.screenshots.values()) {
      if (rec.assetId === assetId) {
        return rec;
      }
    }
    return null;
  }

  async deleteScreenshot(id: string): Promise<void> {
    this.screenshots.delete(id);
  }

  async markOriginalDeleted(assetId: string): Promise<void> {
    for (const rec of this.screenshots.values()) {
      if (rec.assetId === assetId) {
        rec.originalDeleted = true;
      }
    }
  }

  async listScreenshots(filters?: SearchFilters, limit: number = 100, offset: number = 0): Promise<ScreenshotRecord[]> {
    return [...this.screenshots.values()]
      .filter(r => passesFilters(r, filters))
      .sort((a, b) => b.takenAt - a.takenAt)
      .slice(offset, offset + limit);
  }

  async countScreenshots(): Promise<number> {
    return this.screenshots.size;
  }

  async countByCategory(): Promise<Partial<Record<Category, number>>> {
    const counts: Partial<Record<Category, number>> = {};
    for (const rec of this.screenshots.values()) {
      counts[rec.category] = (counts[rec.category] ?? 0) + 1;
    }
    return counts;
  }

  async keywordSearch(query: string, filters?: SearchFilters, limit: number = 30): Promise<KeywordHit[]> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }
    const hits: KeywordHit[] = [];
    for (const rec of this.screenshots.values()) {
      if (!passesFilters(rec, filters)) {
        continue;
      }
      const docTokens = tokenize(rec.ocrText);
      if (docTokens.length === 0) {
        continue;
      }
      const docSet = new Set(docTokens);
      let matched = 0;
      for (const qt of queryTokens) {
        if (docSet.has(qt) || docTokens.some(dt => dt.startsWith(qt))) {
          matched += 1;
        }
      }
      if (matched === 0) {
        continue;
      }
      const score = matched / queryTokens.length;
      hits.push({
        screenshotId: rec.id,
        score,
        snippet: makeSnippet(rec.ocrText, query),
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async listEmbedded(filters?: SearchFilters): Promise<ScreenshotRecord[]> {
    return [...this.screenshots.values()].filter(r => r.embedding != null && passesFilters(r, filters));
  }

  async upsertReminder(reminder: ReminderSuggestion): Promise<void> {
    this.reminders.set(reminder.id, { ...reminder });
  }

  async getReminder(id: string): Promise<ReminderSuggestion | null> {
    return this.reminders.get(id) ?? null;
  }

  async listReminders(status?: ReminderSuggestion['status']): Promise<ReminderSuggestion[]> {
    return [...this.reminders.values()]
      .filter(r => (status ? r.status === status : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async appendActivity(entry: ActivityLogEntry): Promise<void> {
    this.activity.push({ ...entry });
  }

  async listActivity(limit: number = 100): Promise<ActivityLogEntry[]> {
    return [...this.activity].sort((a, b) => b.at - a.at).slice(0, limit);
  }

  async getSettings(): Promise<Settings> {
    return { ...this.settings };
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.settings = { ...settings };
  }

  async close(): Promise<void> {}
}
