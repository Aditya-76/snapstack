/**
 * SQLite-backed SnapStore using op-sqlite (PRD §5: "sqlite-vec inside the main
 * SQLite DB — one file, easy backup").
 *
 * Layout:
 *  - screenshots           main table; embedding stored as BLOB (float32 LE)
 *  - screenshots_fts       FTS5 external-content table over ocr_text (BM25)
 *  - reminders, activity_log, settings (single-row JSON)
 *
 * Semantic search is a brute-force cosine scan over embedding BLOBs; at the
 * PRD's 10k-screenshot scale with 384-dim vectors this is a few ms of math and
 * keeps us dependency-light. The listEmbedded() seam lets sqlite-vec replace
 * the scan later without touching callers.
 */

import type { DB } from '@op-engineering/op-sqlite';
import {
  ActivityLogEntry,
  Category,
  DEFAULT_SETTINGS,
  Entity,
  ReminderSuggestion,
  ScreenshotRecord,
  SearchFilters,
  Settings,
} from '../types';
import { KeywordHit, makeSnippet, SnapStore } from './store';

export const DB_NAME = 'screenshot_brain.sqlite';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS screenshots (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL UNIQUE,
    taken_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    ocr_text TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    category_confidence REAL NOT NULL DEFAULT 0,
    entities_json TEXT NOT NULL DEFAULT '[]',
    source_app TEXT,
    thumbnail_path TEXT,
    original_deleted INTEGER NOT NULL DEFAULT 0,
    original_deleted_at INTEGER,
    embedding BLOB
  )`,
  `CREATE INDEX IF NOT EXISTS idx_screenshots_taken_at ON screenshots(taken_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_screenshots_category ON screenshots(category)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS screenshots_fts USING fts5(
    ocr_text,
    content='screenshots',
    content_rowid='rowid',
    tokenize='unicode61'
  )`,
  `CREATE TRIGGER IF NOT EXISTS screenshots_ai AFTER INSERT ON screenshots BEGIN
    INSERT INTO screenshots_fts(rowid, ocr_text) VALUES (new.rowid, new.ocr_text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS screenshots_ad AFTER DELETE ON screenshots BEGIN
    INSERT INTO screenshots_fts(screenshots_fts, rowid, ocr_text) VALUES('delete', old.rowid, old.ocr_text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS screenshots_au AFTER UPDATE OF ocr_text ON screenshots BEGIN
    INSERT INTO screenshots_fts(screenshots_fts, rowid, ocr_text) VALUES('delete', old.rowid, old.ocr_text);
    INSERT INTO screenshots_fts(rowid, ocr_text) VALUES (new.rowid, new.ocr_text);
  END`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    screenshot_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    title TEXT NOT NULL,
    fire_at INTEGER,
    status TEXT NOT NULL,
    auto INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    screenshot_id TEXT,
    reminder_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL
  )`,
];

type Row = Record<string, unknown>;

export function embeddingToBlob(embedding: Float32Array): ArrayBuffer {
  return embedding.buffer.slice(embedding.byteOffset, embedding.byteOffset + embedding.byteLength) as ArrayBuffer;
}

export function blobToEmbedding(blob: unknown): Float32Array | null {
  if (blob == null) {
    return null;
  }
  if (blob instanceof ArrayBuffer) {
    return new Float32Array(blob);
  }
  if (ArrayBuffer.isView(blob)) {
    const view = blob as ArrayBufferView;
    return new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return null;
}

function rowToRecord(row: Row): ScreenshotRecord {
  return {
    id: String(row.id),
    assetId: String(row.asset_id),
    takenAt: Number(row.taken_at),
    indexedAt: Number(row.indexed_at),
    ocrText: String(row.ocr_text ?? ''),
    category: String(row.category) as Category,
    categoryConfidence: Number(row.category_confidence ?? 0),
    entities: JSON.parse(String(row.entities_json ?? '[]')) as Entity[],
    sourceApp: row.source_app == null ? null : String(row.source_app),
    thumbnailPath: row.thumbnail_path == null ? null : String(row.thumbnail_path),
    originalDeleted: Number(row.original_deleted) === 1,
    originalDeletedAt: row.original_deleted_at == null ? null : Number(row.original_deleted_at),
    embedding: blobToEmbedding(row.embedding),
  };
}

/** Build a WHERE clause + params for SearchFilters. */
function filterSql(filters?: SearchFilters, alias: string = 's'): { where: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const explicitCategories = filters?.categories ?? [];

  if (explicitCategories.length > 0) {
    clauses.push(`${alias}.category IN (${explicitCategories.map(() => '?').join(',')})`);
    params.push(...explicitCategories);
  }
  if (filters?.fromDate != null) {
    clauses.push(`${alias}.taken_at >= ?`);
    params.push(filters.fromDate);
  }
  if (filters?.toDate != null) {
    clauses.push(`${alias}.taken_at <= ?`);
    params.push(filters.toDate);
  }
  if (filters?.sourceApp) {
    clauses.push(`${alias}.source_app = ?`);
    params.push(filters.sourceApp);
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Escape a user query into an FTS5 prefix-match expression. */
export function toFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}@._-]+/u)
    .filter(t => t.length > 0)
    .map(t => `"${t.replace(/"/g, '')}"*`);
  return tokens.join(' ');
}

export class SqliteStore implements SnapStore {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  /** Open with op-sqlite. Kept as a factory so tests can inject a fake DB. */
  static async open(encryptionKey?: string): Promise<SqliteStore> {
    // Lazy import keeps MemoryStore usable in environments without the native module.
    const opsqlite = require('@op-engineering/op-sqlite') as typeof import('@op-engineering/op-sqlite');
    const db = opsqlite.open({ name: DB_NAME, encryptionKey });
    const store = new SqliteStore(db);
    await store.init();
    return store;
  }

  async init(): Promise<void> {
    await this.db.execute('PRAGMA journal_mode = WAL');
    for (const stmt of SCHEMA) {
      await this.db.execute(stmt);
    }
  }

  async upsertScreenshot(r: ScreenshotRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO screenshots (id, asset_id, taken_at, indexed_at, ocr_text, category, category_confidence,
        entities_json, source_app, thumbnail_path, original_deleted, original_deleted_at, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        asset_id=excluded.asset_id, taken_at=excluded.taken_at, indexed_at=excluded.indexed_at,
        ocr_text=excluded.ocr_text, category=excluded.category, category_confidence=excluded.category_confidence,
        entities_json=excluded.entities_json, source_app=excluded.source_app,
        thumbnail_path=excluded.thumbnail_path, original_deleted=excluded.original_deleted,
        original_deleted_at=excluded.original_deleted_at, embedding=excluded.embedding`,
      [
        r.id,
        r.assetId,
        r.takenAt,
        r.indexedAt,
        r.ocrText,
        r.category,
        r.categoryConfidence,
        JSON.stringify(r.entities),
        r.sourceApp,
        r.thumbnailPath,
        r.originalDeleted ? 1 : 0,
        r.originalDeletedAt,
        r.embedding ? (embeddingToBlob(r.embedding) as unknown as string) : null,
      ],
    );
  }

  async getScreenshot(id: string): Promise<ScreenshotRecord | null> {
    const res = await this.db.execute('SELECT * FROM screenshots WHERE id = ?', [id]);
    return res.rows.length > 0 ? rowToRecord(res.rows[0] as Row) : null;
  }

  async getScreenshotByAssetId(assetId: string): Promise<ScreenshotRecord | null> {
    const res = await this.db.execute('SELECT * FROM screenshots WHERE asset_id = ?', [assetId]);
    return res.rows.length > 0 ? rowToRecord(res.rows[0] as Row) : null;
  }

  async deleteScreenshot(id: string): Promise<void> {
    await this.db.execute('DELETE FROM screenshots WHERE id = ?', [id]);
  }

  async markOriginalDeleted(assetId: string): Promise<void> {
    await this.db.execute(
      'UPDATE screenshots SET original_deleted = 1, original_deleted_at = COALESCE(original_deleted_at, ?) WHERE asset_id = ?',
      [Date.now(), assetId],
    );
  }

  async listScreenshots(filters?: SearchFilters, limit: number = 100, offset: number = 0): Promise<ScreenshotRecord[]> {
    const { where, params } = filterSql(filters);
    const res = await this.db.execute(
      `SELECT * FROM screenshots s ${where} ORDER BY taken_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return res.rows.map(row => rowToRecord(row as Row));
  }

  async countScreenshots(): Promise<number> {
    const res = await this.db.execute('SELECT COUNT(*) AS n FROM screenshots');
    return Number((res.rows[0] as Row).n);
  }

  async countByCategory(): Promise<Partial<Record<Category, number>>> {
    const res = await this.db.execute('SELECT category, COUNT(*) AS n FROM screenshots GROUP BY category');
    const out: Partial<Record<Category, number>> = {};
    for (const row of res.rows as Row[]) {
      out[String(row.category) as Category] = Number(row.n);
    }
    return out;
  }

  async keywordSearch(query: string, filters?: SearchFilters, limit: number = 30): Promise<KeywordHit[]> {
    const fts = toFtsQuery(query);
    if (fts.length === 0) {
      return [];
    }
    const { where, params } = filterSql(filters);
    const clause = where ? `${where} AND` : 'WHERE';
    const res = await this.db.execute(
      `SELECT s.id AS id, s.ocr_text AS ocr_text, bm25(screenshots_fts) AS rank
       FROM screenshots_fts f
       JOIN screenshots s ON s.rowid = f.rowid
       ${clause} screenshots_fts MATCH ?
       ORDER BY rank ASC
       LIMIT ?`,
      [...params, fts, limit],
    );
    return (res.rows as Row[]).map(row => {
      const rank = Number(row.rank); // bm25(): lower (more negative) = better
      return {
        screenshotId: String(row.id),
        score: 1 / (1 + Math.exp(rank)), // squash to (0, 1), higher = better
        snippet: makeSnippet(String(row.ocr_text ?? ''), query),
      };
    });
  }

  async listEmbedded(filters?: SearchFilters): Promise<ScreenshotRecord[]> {
    const { where, params } = filterSql(filters);
    const clause = where ? `${where} AND` : 'WHERE';
    const res = await this.db.execute(`SELECT * FROM screenshots s ${clause} embedding IS NOT NULL`, params);
    return res.rows.map(row => rowToRecord(row as Row));
  }

  async upsertReminder(r: ReminderSuggestion): Promise<void> {
    await this.db.execute(
      `INSERT INTO reminders (id, screenshot_id, action_type, title, fire_at, status, auto, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        screenshot_id=excluded.screenshot_id, action_type=excluded.action_type, title=excluded.title,
        fire_at=excluded.fire_at, status=excluded.status, auto=excluded.auto, created_at=excluded.created_at`,
      [r.id, r.screenshotId, r.actionType, r.title, r.fireAt, r.status, r.auto ? 1 : 0, r.createdAt],
    );
  }

  async getReminder(id: string): Promise<ReminderSuggestion | null> {
    const res = await this.db.execute('SELECT * FROM reminders WHERE id = ?', [id]);
    if (res.rows.length === 0) {
      return null;
    }
    return this.rowToReminder(res.rows[0] as Row);
  }

  private rowToReminder(row: Row): ReminderSuggestion {
    return {
      id: String(row.id),
      screenshotId: String(row.screenshot_id),
      actionType: String(row.action_type) as ReminderSuggestion['actionType'],
      title: String(row.title),
      fireAt: row.fire_at == null ? null : Number(row.fire_at),
      status: String(row.status) as ReminderSuggestion['status'],
      auto: Number(row.auto) === 1,
      createdAt: Number(row.created_at),
    };
  }

  async listReminders(status?: ReminderSuggestion['status']): Promise<ReminderSuggestion[]> {
    const res = status
      ? await this.db.execute('SELECT * FROM reminders WHERE status = ? ORDER BY created_at DESC', [status])
      : await this.db.execute('SELECT * FROM reminders ORDER BY created_at DESC');
    return (res.rows as Row[]).map(row => this.rowToReminder(row));
  }

  async appendActivity(e: ActivityLogEntry): Promise<void> {
    await this.db.execute(
      'INSERT INTO activity_log (id, at, kind, message, screenshot_id, reminder_id) VALUES (?, ?, ?, ?, ?, ?)',
      [e.id, e.at, e.kind, e.message, e.screenshotId, e.reminderId],
    );
  }

  async listActivity(limit: number = 100): Promise<ActivityLogEntry[]> {
    const res = await this.db.execute('SELECT * FROM activity_log ORDER BY at DESC LIMIT ?', [limit]);
    return (res.rows as Row[]).map(row => ({
      id: String(row.id),
      at: Number(row.at),
      kind: String(row.kind) as ActivityLogEntry['kind'],
      message: String(row.message),
      screenshotId: row.screenshot_id == null ? null : String(row.screenshot_id),
      reminderId: row.reminder_id == null ? null : String(row.reminder_id),
    }));
  }

  async getSettings(): Promise<Settings> {
    const res = await this.db.execute('SELECT json FROM settings WHERE id = 1');
    if (res.rows.length === 0) {
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(String((res.rows[0] as Row).json)) };
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.db.execute(
      'INSERT INTO settings (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
      [JSON.stringify(settings)],
    );
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
