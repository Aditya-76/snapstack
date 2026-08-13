/**
 * TypeScript bridge to the native pipeline modules (PRD §5 "RN bridge").
 *
 * Every module degrades gracefully: when the native side is missing (unit
 * tests, unsupported platform, below-floor device) callers get a typed
 * fallback instead of a crash. The contract for each module is implemented in:
 *   android/app/src/main/java/com/screenshotbrain/nativemodules/
 *   ios/ScreenshotBrain/NativeModules/
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { OcrResult } from '../types';

// ---------------------------------------------------------------------------
// Screenshot observer: MediaStore ContentObserver (Android) /
// PHPhotoLibraryChangeObserver (iOS). Emits `onNewScreenshot` events.
// ---------------------------------------------------------------------------

export interface NativeScreenshotAsset {
  /** MediaStore content URI (Android) or PHAsset localIdentifier (iOS). */
  assetId: string;
  /** Epoch ms. */
  takenAt: number;
  width: number;
  height: number;
  /** Best-effort local file path for OCR input (Android); empty on iOS. */
  filePath: string;
}

interface ScreenshotObserverModule {
  /** Ask for photo permission (screenshots-scoped where the OS allows). */
  requestPermission(): Promise<'granted' | 'limited' | 'denied'>;
  getPermissionStatus(): Promise<'granted' | 'limited' | 'denied' | 'undetermined'>;
  /** Start watching for new screenshots; emits `onNewScreenshot`. */
  startObserving(): Promise<void>;
  stopObserving(): Promise<void>;
  /** Enumerate existing screenshots newer than sinceMs (backfill, PRD §4.1.3). */
  listScreenshots(sinceMs: number, limit: number, offset: number): Promise<NativeScreenshotAsset[]>;
  /** Check whether an asset still exists in the gallery. */
  assetExists(assetId: string): Promise<boolean>;
  /** Open the original in the gallery (Android ACTION_VIEW) or return false → in-app viewer (iOS). */
  openInGallery(assetId: string): Promise<boolean>;
}

interface OcrModule {
  /** Run on-device OCR (ML Kit / Vision) against a gallery asset. */
  recognize(assetId: string): Promise<OcrResult>;
}

interface ThumbnailModule {
  /** Create & cache a small WebP/JPEG thumbnail; returns file path (PRD §6). */
  createThumbnail(assetId: string, maxDimension: number, quality: number): Promise<string>;
}

interface NotificationsModule {
  requestPermission(): Promise<boolean>;
  /** Schedule a local notification at epoch ms; returns platform notification id. */
  schedule(id: string, title: string, body: string, fireAt: number): Promise<string>;
  cancel(id: string): Promise<void>;
}

interface MlModule {
  /** True when the embedding model file is present and loaded. */
  isEmbeddingReady(): Promise<boolean>;
  embed(text: string): Promise<number[]>;
  /** True when the optional LLM pack is downloaded and the device is above floor. */
  isLlmReady(): Promise<boolean>;
  /** Single-shot completion against the local LLM. */
  complete(prompt: string, maxTokens: number): Promise<string>;
  /** Kick off the staged LLM pack download ("Enable Q&A", PRD §7.2). */
  downloadLlmPack(): Promise<void>;
  getLlmDownloadProgress(): Promise<number>;
}

function optionalModule<T>(name: string): T | null {
  const mod = NativeModules[name];
  return mod ? (mod as T) : null;
}

export const ScreenshotObserver = optionalModule<ScreenshotObserverModule>('ScreenshotObserver');
export const Ocr = optionalModule<OcrModule>('OcrModule');
export const Thumbnails = optionalModule<ThumbnailModule>('ThumbnailModule');
export const Notifications = optionalModule<NotificationsModule>('NotificationsModule');
export const Ml = optionalModule<MlModule>('MlModule');

export function screenshotEventEmitter(): NativeEventEmitter | null {
  if (!ScreenshotObserver) {
    return null;
  }
  return new NativeEventEmitter(NativeModules.ScreenshotObserver);
}

/** iOS cannot watch the gallery in background; PRD §4.2 sets that expectation. */
export function supportsRealtimeCapture(): boolean {
  return Platform.OS === 'android';
}
