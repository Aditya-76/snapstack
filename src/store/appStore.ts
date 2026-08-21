/**
 * App-level state (zustand). Persistent data lives in SQLite; this store holds
 * UI state plus cached views of the DB, refreshed via the load* actions.
 */

import { create } from 'zustand';
import { getStore } from '../db';
import { hybridSearch } from '../search/hybridSearch';
import { answerQuestion, isQaAvailable } from '../qa/qa';
import {
  backupFileName,
  decryptBackup,
  encryptBackup,
  restoreBackup,
  serializeBackup,
} from '../backup/backupService';
import { Backup, Ml, ScreenshotObserver } from '../native';
import { backfill, backfillSinceMs } from '../pipeline/pipeline';
import {
  confirmReminder,
  dismissReminder,
  newId,
  setAutoMode,
  undoReminder,
} from '../reminders/engine';
import {
  ActivityLogEntry,
  Category,
  ChatMessage,
  DEFAULT_SETTINGS,
  ReminderSuggestion,
  ScreenshotRecord,
  SearchFilters,
  SearchResult,
  Settings,
} from '../types';

interface AppState {
  // Library / search
  screenshots: ScreenshotRecord[];
  totalCount: number;
  categoryCounts: Partial<Record<Category, number>>;
  query: string;
  activeCategory: Category | null;
  results: SearchResult[];
  searching: boolean;

  // Chat
  chatMessages: ChatMessage[];
  qaAvailable: boolean;
  answering: boolean;

  // Reminders
  suggestions: ReminderSuggestion[];
  confirmedReminders: ReminderSuggestion[];
  activity: ActivityLogEntry[];

  // Settings
  settings: Settings;

  // Background jobs (survive navigation; UI reads these anywhere)
  backfillRunning: boolean;
  backfillProcessed: number;
  backfillTotal: number;
  llmDownloadProgress: number | null;

  // App lock
  unlocked: boolean;

  // Actions
  refreshLibrary(): Promise<void>;
  setQuery(query: string): void;
  runSearch(): Promise<void>;
  setActiveCategory(category: Category | null): void;
  askQuestion(question: string): Promise<void>;
  refreshReminders(): Promise<void>;
  confirm(reminderId: string): Promise<void>;
  dismiss(reminderId: string): Promise<void>;
  undo(reminderId: string): Promise<void>;
  refreshActivity(): Promise<void>;
  loadSettings(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  toggleAutoReminders(category: Category, enabled: boolean): Promise<void>;
  /** Start a backfill in the background; progress is exposed on the store. */
  startBackfill(window: Exclude<Settings['backfillWindow'], 'none'>): Promise<void>;
  startLlmDownload(): Promise<void>;
  pollLlmDownload(): Promise<void>;
  exportBackup(passphrase: string): Promise<void>;
  importBackup(passphrase: string): Promise<{ screenshots: number; reminders: number } | null>;
  setUnlocked(unlocked: boolean): void;
}

function currentFilters(state: Pick<AppState, 'activeCategory'>): SearchFilters {
  return {
    categories: state.activeCategory ? [state.activeCategory] : undefined,
  };
}

let searchToken = 0;

export const useAppStore = create<AppState>((set, get) => ({
  screenshots: [],
  totalCount: 0,
  categoryCounts: {},
  query: '',
  activeCategory: null,
  results: [],
  searching: false,

  chatMessages: [],
  qaAvailable: false,
  answering: false,

  suggestions: [],
  confirmedReminders: [],
  activity: [],

  settings: { ...DEFAULT_SETTINGS },

  backfillRunning: false,
  backfillProcessed: 0,
  backfillTotal: 0,
  llmDownloadProgress: null,
  unlocked: false,

  async refreshLibrary() {
    const store = await getStore();
    const state = get();
    const [screenshots, totalCount, categoryCounts] = await Promise.all([
      store.listScreenshots(currentFilters(state), 200),
      store.countScreenshots(),
      store.countByCategory(),
    ]);
    set({ screenshots, totalCount, categoryCounts });
  },

  setQuery(query: string) {
    set({ query });
    if (query.trim().length === 0) {
      set({ results: [] });
    }
  },

  async runSearch() {
    const { query } = get();
    if (query.trim().length === 0) {
      set({ results: [] });
      return;
    }
    // Sequence token: a slow earlier search must not overwrite a newer one.
    const token = ++searchToken;
    set({ searching: true });
    try {
      const store = await getStore();
      const results = await hybridSearch(store, query, currentFilters(get()));
      if (token === searchToken && get().query.trim().length > 0) {
        set({ results });
      }
    } finally {
      if (token === searchToken) {
        set({ searching: false });
      }
    }
  },

  setActiveCategory(category: Category | null) {
    set({ activeCategory: category });
    void get().refreshLibrary();
    if (get().query.trim().length > 0) {
      void get().runSearch();
    }
  },

  async askQuestion(question: string) {
    const userMsg: ChatMessage = { id: newId('msg'), role: 'user', text: question, at: Date.now() };
    set(s => ({ chatMessages: [...s.chatMessages, userMsg], answering: true }));
    try {
      const store = await getStore();
      const qa = await answerQuestion(store, question);
      const text = qa.answer
        ? qa.answer
        : qa.citations.length > 0
          ? 'Q&A needs the on-device model (enable it in Settings). Here are the most relevant screenshots I found:'
          : "I couldn't find any screenshots matching that.";
      const assistantMsg: ChatMessage = {
        id: newId('msg'),
        role: 'assistant',
        text,
        citations: qa.citations,
        at: Date.now(),
      };
      set(s => ({ chatMessages: [...s.chatMessages, assistantMsg] }));
    } finally {
      set({ answering: false });
    }
  },

  async refreshReminders() {
    const store = await getStore();
    const [suggestions, confirmedReminders, qaAvailable] = await Promise.all([
      store.listReminders('suggested'),
      store.listReminders('confirmed'),
      isQaAvailable(),
    ]);
    set({ suggestions, confirmedReminders, qaAvailable });
  },

  async confirm(reminderId: string) {
    const store = await getStore();
    await confirmReminder(store, reminderId);
    await get().refreshReminders();
    await get().refreshActivity();
  },

  async dismiss(reminderId: string) {
    const store = await getStore();
    await dismissReminder(store, reminderId);
    await get().refreshReminders();
    await get().refreshActivity();
  },

  async undo(reminderId: string) {
    const store = await getStore();
    await undoReminder(store, reminderId);
    await get().refreshReminders();
    await get().refreshActivity();
  },

  async refreshActivity() {
    const store = await getStore();
    set({ activity: await store.listActivity(100) });
  },

  async loadSettings() {
    const store = await getStore();
    set({ settings: await store.getSettings() });
  },

  async updateSettings(patch: Partial<Settings>) {
    const store = await getStore();
    const next = { ...get().settings, ...patch };
    await store.saveSettings(next);
    set({ settings: next });
  },

  async toggleAutoReminders(category: Category, enabled: boolean) {
    const store = await getStore();
    const next = setAutoMode(get().settings, category, enabled);
    await store.saveSettings(next);
    set({ settings: next });
  },

  async startBackfill(window) {
    if (get().backfillRunning || !ScreenshotObserver) {
      return;
    }
    set({ backfillRunning: true, backfillProcessed: 0, backfillTotal: 0 });
    // Fire-and-forget: onboarding/settings return immediately, the Search
    // header banner shows live progress (PRD §4.1.3 "background job with
    // progress UI").
    void (async () => {
      try {
        const store = await getStore();
        const assets = await ScreenshotObserver.listScreenshots(backfillSinceMs(window), 10000, 0);
        set({ backfillTotal: assets.length });
        await backfill(store, assets, get().settings, p => {
          set({ backfillProcessed: p.processed, backfillTotal: p.total });
        });
        await get().refreshLibrary();
        await get().refreshReminders();
      } catch (e) {
        console.warn('[backfill] failed', e);
      } finally {
        set({ backfillRunning: false });
      }
    })();
  },

  async startLlmDownload() {
    if (!Ml) {
      throw new Error('This device does not support the Q&A model.');
    }
    await Ml.downloadLlmPack();
    set({ llmDownloadProgress: 0 });
    void get().pollLlmDownload();
  },

  async pollLlmDownload() {
    if (!Ml) {
      return;
    }
    for (;;) {
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
      try {
        const p = await Ml.getLlmDownloadProgress();
        set({ llmDownloadProgress: p });
        if (p >= 1) {
          await get().updateSettings({ llmPackInstalled: true });
          set({ qaAvailable: await isQaAvailable() });
          return;
        }
      } catch {
        set({ llmDownloadProgress: null });
        return;
      }
    }
  },

  async exportBackup(passphrase: string) {
    if (!Backup) {
      throw new Error('Backup is not available on this build.');
    }
    const store = await getStore();
    const payload = await serializeBackup(store);
    const cipherText = encryptBackup(payload, passphrase);
    await Backup.exportFile(backupFileName(), cipherText);
  },

  async importBackup(passphrase: string) {
    if (!Backup) {
      throw new Error('Backup is not available on this build.');
    }
    const content = await Backup.importFile();
    if (content == null) {
      return null; // user cancelled the picker
    }
    const payload = decryptBackup(content, passphrase);
    const store = await getStore();
    const result = await restoreBackup(store, payload);
    await get().loadSettings();
    await get().refreshLibrary();
    await get().refreshReminders();
    return result;
  },

  setUnlocked(unlocked: boolean) {
    set({ unlocked });
  },
}));
