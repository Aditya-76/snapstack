/**
 * Retention maintenance (PRD §6 "Retention policies"):
 *  - detect gallery originals that were deleted and mark them ("the
 *    intelligence outlives gallery cleanups" — §4.6);
 *  - optionally purge extracted data (row + thumbnail) N days after the
 *    original disappeared (default: keep forever).
 *
 * Safety: existence can only be trusted under full photo permission. Under
 * 'limited' access (iOS) or after a revocation, assets we indexed are
 * invisible without being deleted — marking them would corrupt the index and,
 * with a purge policy on, destroy data. So the deletion pass hard-requires
 * 'granted', and a same-sweep circuit breaker aborts if an implausible share
 * of checked assets appears deleted.
 *
 * Runs opportunistically on app foreground; each sweep checks a bounded,
 * rotating window so large libraries are covered over successive sweeps.
 */

import { SnapStore } from '../db/store';
import { ScreenshotObserver, Thumbnails } from '../native';
import { Settings } from '../types';

export interface RetentionResult {
  checked: number;
  newlyMarkedDeleted: number;
  purged: number;
  /** True when the deletion pass was skipped (no/limited permission). */
  deletionPassSkipped: boolean;
}

const SWEEP_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Abort if more than this fraction of a sweep looks deleted (permission glitch). */
const MASS_DELETE_FRACTION = 0.5;
const MASS_DELETE_MIN_CHECKED = 20;

/** Rotating window cursor so successive sweeps cover the whole library. */
let sweepOffset = 0;

/** Injectable seams; default to the native module. */
export interface RetentionDeps {
  assetExists?: (assetId: string) => Promise<boolean>;
  /** Must resolve 'granted' for the deletion pass to run. */
  getPermissionStatus?: () => Promise<string>;
  deleteThumbnail?: (path: string) => Promise<void>;
}

async function defaultAssetExists(assetId: string): Promise<boolean> {
  if (!ScreenshotObserver) {
    throw new Error('gallery access unavailable');
  }
  return ScreenshotObserver.assetExists(assetId);
}

async function defaultPermissionStatus(): Promise<string> {
  if (!ScreenshotObserver) {
    return 'unavailable';
  }
  return ScreenshotObserver.getPermissionStatus();
}

async function defaultDeleteThumbnail(path: string): Promise<void> {
  if (Thumbnails?.deleteThumbnail) {
    await Thumbnails.deleteThumbnail(path);
  }
}

export async function runRetentionSweep(
  store: SnapStore,
  settings: Settings,
  now: number = Date.now(),
  deps: RetentionDeps = {},
): Promise<RetentionResult> {
  const assetExists = deps.assetExists ?? defaultAssetExists;
  const getPermissionStatus = deps.getPermissionStatus ?? defaultPermissionStatus;
  const deleteThumbnail = deps.deleteThumbnail ?? defaultDeleteThumbnail;

  const result: RetentionResult = { checked: 0, newlyMarkedDeleted: 0, purged: 0, deletionPassSkipped: true };

  // Pass 1: find records whose original vanished from the gallery — only
  // under full permission, where "not found" really means "deleted".
  let permission = 'unavailable';
  try {
    permission = await getPermissionStatus();
  } catch {
    // treat as unavailable
  }
  if (permission === 'granted') {
    result.deletionPassSkipped = false;
    const total = await store.countScreenshots();
    if (sweepOffset >= total) {
      sweepOffset = 0;
    }
    const records = await store.listScreenshots(undefined, SWEEP_LIMIT, sweepOffset);
    sweepOffset = records.length < SWEEP_LIMIT ? 0 : sweepOffset + records.length;

    const missing: string[] = [];
    for (const rec of records) {
      if (rec.originalDeleted) {
        continue;
      }
      result.checked += 1;
      try {
        if (!(await assetExists(rec.assetId))) {
          missing.push(rec.assetId);
        }
      } catch {
        // Transient failure — try again next sweep. Never mark on error.
      }
    }
    // Circuit breaker: a huge fraction "missing" means the check is lying
    // (permission race, MediaStore rebuild) — not that the user deleted half
    // their gallery between sweeps.
    const massDelete =
      result.checked >= MASS_DELETE_MIN_CHECKED && missing.length / result.checked > MASS_DELETE_FRACTION;
    if (!massDelete) {
      for (const assetId of missing) {
        await store.markOriginalDeleted(assetId);
        result.newlyMarkedDeleted += 1;
      }
    }
  }

  // Pass 2: purge extracted data past the retention window (opt-in). Runs
  // regardless of permission — it only touches our own rows/thumbnails.
  const purgeDays = settings.purgeAfterOriginalDeletedDays;
  if (purgeDays != null) {
    const cutoff = now - purgeDays * DAY_MS;
    const all = await store.listScreenshots(undefined, SWEEP_LIMIT * 5);
    for (const rec of all) {
      if (rec.originalDeleted && rec.originalDeletedAt != null && rec.originalDeletedAt <= cutoff) {
        if (rec.thumbnailPath) {
          try {
            await deleteThumbnail(rec.thumbnailPath);
          } catch {
            // The row still goes; an orphaned thumb is cleaned next sweep.
          }
        }
        await store.deleteScreenshot(rec.id);
        result.purged += 1;
      }
    }
  }

  return result;
}

/** Test seam: reset the rotating cursor. */
export function resetSweepCursor(): void {
  sweepOffset = 0;
}
