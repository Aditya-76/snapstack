/**
 * Continuous capture (PRD §4.2).
 *
 * Android: the native ScreenshotObserver registers a MediaStore ContentObserver
 * and emits `onNewScreenshot` in near-real-time while the app process lives.
 * iOS: PHPhotoLibraryChangeObserver while the app is alive; on each app-open /
 * foreground we also sweep for screenshots newer than the persisted watermark,
 * so days-long gaps with the app closed are still caught (§7.1).
 * Manual import: the OS share sheet hands images to ShareImportModule; we run
 * them through the same pipeline.
 */

import { AppState, EmitterSubscription, NativeEventEmitter } from 'react-native';
import { getStore } from '../db';
import { runRetentionSweep } from '../maintenance/retention';
import {
  NativeScreenshotAsset,
  ScreenshotObserver,
  ShareImport,
  screenshotEventEmitter,
} from '../native';
import { indexScreenshot } from '../pipeline/pipeline';
import { newId } from '../reminders/engine';

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SWEEP_PAGE_SIZE = 200;
const MAX_SWEEP_PAGES = 25;

let lastRetentionSweepMs = 0;
let subscription: EmitterSubscription | null = null;
let appStateSubscription: { remove(): void } | null = null;
let sweeping = false;
let listeners: Array<(assetId: string) => void> = [];
/** Serializes indexing per asset: observer event + sweep can race on the same one. */
const inFlight = new Map<string, Promise<boolean>>();

/** Notify UI (e.g. Library screen) that a new screenshot was indexed. */
export function onScreenshotIndexed(cb: (assetId: string) => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter(l => l !== cb);
  };
}

async function handleNewAsset(asset: NativeScreenshotAsset): Promise<boolean> {
  const existing = inFlight.get(asset.assetId);
  if (existing) {
    return existing;
  }
  const work = (async () => {
    try {
      const store = await getStore();
      if (await store.getScreenshotByAssetId(asset.assetId)) {
        return false;
      }
      const settings = await store.getSettings();
      await indexScreenshot(store, asset, settings);
      listeners.forEach(l => l(asset.assetId));
      return true;
    } catch (e) {
      console.warn('[capture] failed to index new screenshot', e);
      return false;
    } finally {
      inFlight.delete(asset.assetId);
    }
  })();
  inFlight.set(asset.assetId, work);
  return work;
}

/**
 * Sweep for screenshots taken since the persisted watermark (iOS on-open
 * processing; Android safety net for bursts and process death). Paginates so
 * long gaps are fully drained.
 */
export async function sweepNewScreenshots(): Promise<number> {
  if (!ScreenshotObserver || sweeping) {
    return 0;
  }
  sweeping = true;
  let indexed = 0;
  try {
    const store = await getStore();
    const settings = await store.getSettings();
    const sweepStartedAt = Date.now();
    // First-ever sweep: look back one day, not into all of history — the
    // user chooses how far back to index via backfill, not the sweep.
    const since = settings.lastSweepMs > 0 ? settings.lastSweepMs : sweepStartedAt - 24 * 60 * 60 * 1000;

    for (let page = 0; page < MAX_SWEEP_PAGES; page++) {
      const assets = await ScreenshotObserver.listScreenshots(since, SWEEP_PAGE_SIZE, page * SWEEP_PAGE_SIZE);
      for (const asset of assets) {
        if (await handleNewAsset(asset)) {
          indexed += 1;
        }
      }
      if (assets.length < SWEEP_PAGE_SIZE) {
        break;
      }
    }

    // Advance the watermark only after a completed sweep.
    const fresh = await store.getSettings();
    await store.saveSettings({ ...fresh, lastSweepMs: sweepStartedAt });
  } catch (e) {
    console.warn('[capture] sweep failed', e);
  } finally {
    sweeping = false;
  }
  return indexed;
}

/** Index an image handed to us via the OS share sheet (manual import, §4.2). */
export async function consumeSharedImport(): Promise<boolean> {
  if (!ShareImport) {
    return false;
  }
  try {
    const asset = await ShareImport.consumePendingSharedImage();
    if (!asset) {
      return false;
    }
    const indexed = await handleNewAsset(asset);
    if (indexed) {
      const store = await getStore();
      await store.appendActivity({
        id: newId('act'),
        at: Date.now(),
        kind: 'screenshot_indexed',
        message: 'Imported an image from the share sheet',
        screenshotId: null,
        reminderId: null,
      });
    }
    return indexed;
  } catch (e) {
    console.warn('[capture] share import failed', e);
    return false;
  }
}

export async function startCapture(): Promise<void> {
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void sweepNewScreenshots();
        void consumeSharedImport();
        void maybeRunRetentionSweep();
      }
    });
  }
  if (!ScreenshotObserver) {
    return;
  }
  const emitter: NativeEventEmitter | null = screenshotEventEmitter();
  if (emitter && !subscription) {
    subscription = emitter.addListener('onNewScreenshot', (asset: unknown) => {
      void handleNewAsset(asset as NativeScreenshotAsset);
    });
  }
  try {
    await ScreenshotObserver.startObserving();
  } catch (e) {
    console.warn('[capture] startObserving failed', e);
  }
  void sweepNewScreenshots();
  void consumeSharedImport();
  void maybeRunRetentionSweep();
}

/** Throttled retention sweep (deleted-original detection + purge, PRD §6). */
export async function maybeRunRetentionSweep(): Promise<void> {
  const now = Date.now();
  if (now - lastRetentionSweepMs < RETENTION_SWEEP_INTERVAL_MS) {
    return;
  }
  lastRetentionSweepMs = now;
  try {
    const store = await getStore();
    const settings = await store.getSettings();
    await runRetentionSweep(store, settings, now);
  } catch (e) {
    console.warn('[capture] retention sweep failed', e);
  }
}

export async function stopCapture(): Promise<void> {
  subscription?.remove();
  subscription = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  if (ScreenshotObserver) {
    try {
      await ScreenshotObserver.stopObserving();
    } catch {
      // already stopped
    }
  }
}
