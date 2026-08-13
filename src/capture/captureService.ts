/**
 * Continuous capture (PRD §4.2).
 *
 * Android: the native ScreenshotObserver registers a MediaStore ContentObserver
 * and emits `onNewScreenshot` in near-real-time.
 * iOS: PHPhotoLibraryChangeObserver while the app is alive; on each app-open /
 * foreground we also sweep for screenshots newer than the last index.
 */

import { AppState, EmitterSubscription, NativeEventEmitter } from 'react-native';
import { getStore } from '../db';
import { NativeScreenshotAsset, ScreenshotObserver, screenshotEventEmitter } from '../native';
import { indexScreenshot } from '../pipeline/pipeline';

let subscription: EmitterSubscription | null = null;
let appStateSubscription: { remove(): void } | null = null;
let lastSweepMs = 0;
let listeners: Array<(assetId: string) => void> = [];

/** Notify UI (e.g. Library screen) that a new screenshot was indexed. */
export function onScreenshotIndexed(cb: (assetId: string) => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter(l => l !== cb);
  };
}

async function handleNewAsset(asset: NativeScreenshotAsset): Promise<void> {
  try {
    const store = await getStore();
    const existing = await store.getScreenshotByAssetId(asset.assetId);
    if (existing) {
      return;
    }
    const settings = await store.getSettings();
    await indexScreenshot(store, asset, settings);
    listeners.forEach(l => l(asset.assetId));
  } catch (e) {
    console.warn('[capture] failed to index new screenshot', e);
  }
}

/** Sweep for screenshots taken since the last sweep (iOS on-open processing). */
export async function sweepNewScreenshots(): Promise<number> {
  if (!ScreenshotObserver) {
    return 0;
  }
  const store = await getStore();
  const since = lastSweepMs;
  lastSweepMs = Date.now();
  let indexed = 0;
  try {
    const assets = await ScreenshotObserver.listScreenshots(since, 200, 0);
    for (const asset of assets) {
      const existing = await store.getScreenshotByAssetId(asset.assetId);
      if (!existing) {
        await handleNewAsset(asset);
        indexed += 1;
      }
    }
  } catch (e) {
    console.warn('[capture] sweep failed', e);
  }
  return indexed;
}

export async function startCapture(): Promise<void> {
  if (!ScreenshotObserver) {
    return;
  }
  const emitter: NativeEventEmitter | null = screenshotEventEmitter();
  if (emitter && !subscription) {
    subscription = emitter.addListener('onNewScreenshot', (asset: NativeScreenshotAsset) => {
      void handleNewAsset(asset);
    });
  }
  try {
    await ScreenshotObserver.startObserving();
  } catch (e) {
    console.warn('[capture] startObserving failed', e);
  }
  // Sweep on foreground: covers the iOS "processed on next app open" contract.
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void sweepNewScreenshots();
      }
    });
  }
  lastSweepMs = Date.now() - 24 * 60 * 60 * 1000;
  void sweepNewScreenshots();
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
