/**
 * Encrypted backup & restore (PRD §3 "Sync/backup", §6).
 *
 * The backup is a JSON snapshot of the extracted database — screenshots
 * (minus embeddings, which are recomputed on restore), reminders, activity
 * log, settings — encrypted with AES-256 (crypto-js, OpenSSL-compatible
 * passphrase KDF) before it leaves the app via the OS share sheet / document
 * picker. The user owns the destination: iCloud Drive, Google Drive, files.
 * Originals live in the user's own photo backup, so restoring on a new device
 * restores the intelligence.
 */

import CryptoJS from 'crypto-js';
import { SnapStore } from '../db/store';
import { Notifications } from '../native';
import { embedText } from '../pipeline/embeddings';
import {
  ActivityLogEntry,
  ReminderSuggestion,
  ScreenshotRecord,
  Settings,
} from '../types';

export const BACKUP_VERSION = 1;
export const BACKUP_MAGIC = 'screenshot-brain-backup';

type PortableScreenshot = Omit<ScreenshotRecord, 'embedding'>;

export interface BackupPayload {
  magic: typeof BACKUP_MAGIC;
  version: number;
  exportedAt: number;
  screenshots: PortableScreenshot[];
  reminders: ReminderSuggestion[];
  activity: ActivityLogEntry[];
  settings: Settings;
}

export async function serializeBackup(store: SnapStore, now: number = Date.now()): Promise<BackupPayload> {
  const [screenshots, reminders, activity, settings] = await Promise.all([
    store.listScreenshots(undefined, 100000),
    store.listReminders(),
    store.listActivity(10000),
    store.getSettings(),
  ]);
  return {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    exportedAt: now,
    screenshots: screenshots.map(({ embedding: _embedding, ...rest }) => rest),
    reminders,
    activity,
    settings,
  };
}

const KDF_ITERATIONS = 10000;
const FORMAT_PREFIX = 'sbb1';

/**
 * AES-256-CBC with a PBKDF2-derived key (10k iterations, random salt & IV) —
 * deliberately not crypto-js's default OpenSSL EVP KDF, which is a single
 * MD5 pass. Format: `sbb1:<salt-hex>:<iv-hex>:<ciphertext-base64>`.
 */
export function encryptBackup(payload: BackupPayload, passphrase: string): string {
  if (passphrase.length < 4) {
    throw new Error('Passphrase must be at least 4 characters');
  }
  const salt = CryptoJS.lib.WordArray.random(16);
  const iv = CryptoJS.lib.WordArray.random(16);
  const key = CryptoJS.PBKDF2(passphrase, salt, { keySize: 256 / 32, iterations: KDF_ITERATIONS });
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(payload), key, { iv });
  return `${FORMAT_PREFIX}:${salt.toString()}:${iv.toString()}:${encrypted.ciphertext.toString(CryptoJS.enc.Base64)}`;
}

export function decryptBackup(cipherText: string, passphrase: string): BackupPayload {
  const parts = cipherText.trim().split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) {
    throw new Error('Not a Screenshot Brain backup');
  }
  let json: string;
  try {
    const salt = CryptoJS.enc.Hex.parse(parts[1]);
    const iv = CryptoJS.enc.Hex.parse(parts[2]);
    const key = CryptoJS.PBKDF2(passphrase, salt, { keySize: 256 / 32, iterations: KDF_ITERATIONS });
    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Base64.parse(parts[3]),
    });
    json = CryptoJS.AES.decrypt(cipherParams, key, { iv }).toString(CryptoJS.enc.Utf8);
  } catch {
    throw new Error('Wrong passphrase or corrupted backup');
  }
  if (!json) {
    throw new Error('Wrong passphrase or corrupted backup');
  }
  let payload: BackupPayload;
  try {
    payload = JSON.parse(json) as BackupPayload;
  } catch {
    throw new Error('Wrong passphrase or corrupted backup');
  }
  if (payload.magic !== BACKUP_MAGIC) {
    throw new Error('Not a Screenshot Brain backup');
  }
  if (payload.version > BACKUP_VERSION) {
    throw new Error('Backup was made by a newer app version');
  }
  return payload;
}

export interface RestoreResult {
  screenshots: number;
  reminders: number;
}

async function rescheduleNotification(reminder: ReminderSuggestion): Promise<void> {
  if (!Notifications) {
    return;
  }
  try {
    await Notifications.schedule(reminder.id, 'Screenshot Brain', reminder.title, reminder.fireAt!);
  } catch (e) {
    console.warn('[backup] reschedule failed', e);
  }
}

/**
 * Merge a backup into the store. Existing records win on assetId collisions
 * (the device's live index is fresher than a backup). Embeddings are
 * recomputed so semantic search works immediately.
 */
export async function restoreBackup(store: SnapStore, payload: BackupPayload): Promise<RestoreResult> {
  let restoredScreenshots = 0;
  for (const shot of payload.screenshots) {
    const existing = await store.getScreenshotByAssetId(shot.assetId);
    if (existing) {
      continue;
    }
    const embedding = shot.ocrText.trim().length > 0 ? await embedText(shot.ocrText) : null;
    await store.upsertScreenshot({ ...shot, embedding });
    restoredScreenshots += 1;
  }

  let restoredReminders = 0;
  for (const reminder of payload.reminders) {
    if (!(await store.getReminder(reminder.id))) {
      await store.upsertReminder(reminder);
      restoredReminders += 1;
      // A confirmed reminder's local notification exists only on the old
      // device — re-schedule future ones here.
      if (reminder.status === 'confirmed' && reminder.fireAt != null && reminder.fireAt > Date.now()) {
        await rescheduleNotification(reminder);
      }
    }
  }

  // Settings: backup fills a fresh install; an initialized device keeps its own.
  const current = await store.getSettings();
  if (!current.onboardingCompleted && payload.settings.onboardingCompleted) {
    await store.saveSettings(payload.settings);
  }

  return { screenshots: restoredScreenshots, reminders: restoredReminders };
}

export function backupFileName(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `screenshot-brain-backup-${y}${m}${d}.sbb`;
}
