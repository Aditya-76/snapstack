/**
 * Per-screenshot ingestion pipeline (PRD §4.3):
 *   OCR → classify → extract entities → embed → store → detect actions.
 *
 * Everything runs on-device. The LLM is consulted only for ambiguous
 * classifications, and only when the optional pack is installed.
 */

import { SnapStore } from '../db/store';
import { Ml, NativeScreenshotAsset, Ocr, Thumbnails } from '../native';
import { ALL_CATEGORIES, Category, OcrResult, ScreenshotRecord, Settings } from '../types';
import { classify, inferSourceApp } from './classifier';
import { embedText } from './embeddings';
import { extractEntities } from './entityExtraction';
import { newId, processSuggestions } from '../reminders/engine';

export interface PipelineDeps {
  /** OCR runner; defaults to the native module. Injectable for tests. */
  ocr?: (assetId: string) => Promise<OcrResult>;
  /** Thumbnailer; defaults to the native module. */
  thumbnail?: (assetId: string) => Promise<string | null>;
  now?: () => Date;
}

async function defaultOcr(assetId: string): Promise<OcrResult> {
  if (!Ocr) {
    return { text: '', boxes: [], languages: [] };
  }
  return Ocr.recognize(assetId);
}

async function defaultThumbnail(assetId: string, settings: Settings): Promise<string | null> {
  if (!Thumbnails || settings.thumbnailQuality === 'off') {
    return null; // "lite mode", PRD §6
  }
  const quality = settings.thumbnailQuality === 'low' ? 40 : 70;
  try {
    return await Thumbnails.createThumbnail(assetId, 256, quality);
  } catch (e) {
    console.warn('[pipeline] thumbnail failed', e);
    return null;
  }
}

/**
 * LLM fallback for ambiguous classification (PRD §4.3 step 2). Returns null
 * when the LLM is unavailable or the reply doesn't name a known category.
 */
export async function llmClassify(ocrText: string): Promise<Category | null> {
  if (!Ml) {
    return null;
  }
  try {
    if (!(await Ml.isLlmReady())) {
      return null;
    }
    const prompt =
      `Classify this phone screenshot's OCR text into exactly one category: ` +
      `${ALL_CATEGORIES.join(', ')}.\n\nText:\n${ocrText.slice(0, 1500)}\n\n` +
      `Reply with only the category id.`;
    const reply = (await Ml.complete(prompt, 8)).trim().toLowerCase();
    const match = ALL_CATEGORIES.find(c => reply.includes(c));
    return match ?? null;
  } catch (e) {
    console.warn('[pipeline] llm classify failed', e);
    return null;
  }
}

/**
 * Index one screenshot end-to-end. Idempotent per assetId: re-running updates
 * the existing row rather than duplicating.
 */
export async function indexScreenshot(
  store: SnapStore,
  asset: NativeScreenshotAsset,
  settings: Settings,
  deps: PipelineDeps = {},
): Promise<ScreenshotRecord> {
  const now = deps.now ? deps.now() : new Date();
  const ocrRun = deps.ocr ?? defaultOcr;

  // 1. OCR
  const ocr = await ocrRun(asset.assetId);
  const text = ocr.text ?? '';

  // 2. Classification (rules first, LLM only for ambiguous cases)
  let classification = classify(text);
  if (classification.ambiguous && text.trim().length > 0) {
    const llmCategory = await llmClassify(text);
    if (llmCategory) {
      classification = { ...classification, category: llmCategory, confidence: Math.max(classification.confidence, 0.7) };
    }
  }

  // 3. Entity extraction (rules/regex; PRD keeps LLM calls rare)
  const entities = extractEntities(text, now);

  // 4. Embedding
  const embedding = text.trim().length > 0 ? await embedText(text) : null;

  // 5. Thumbnail + store
  const thumbnailPath = deps.thumbnail
    ? await deps.thumbnail(asset.assetId)
    : await defaultThumbnail(asset.assetId, settings);

  const existing = await store.getScreenshotByAssetId(asset.assetId);
  const record: ScreenshotRecord = {
    id: existing?.id ?? newId('shot'),
    assetId: asset.assetId,
    takenAt: asset.takenAt,
    indexedAt: now.getTime(),
    ocrText: text,
    category: classification.category,
    categoryConfidence: classification.confidence,
    entities,
    sourceApp: inferSourceApp(text),
    thumbnailPath,
    originalDeleted: false,
    embedding,
  };
  await store.upsertScreenshot(record);

  // 6. Action detection → reminder suggestions (skip on re-index to avoid duplicates)
  if (!existing) {
    await processSuggestions(store, record, settings, now);
  }

  return record;
}

export interface BackfillProgress {
  processed: number;
  total: number;
  done: boolean;
}

/**
 * Backfill existing screenshots in chunks (PRD §4.1.3). The caller (native
 * WorkManager / BGProcessingTask, or the JS onboarding flow) decides pacing;
 * this function reports progress after each chunk so the UI can render it.
 */
export async function backfill(
  store: SnapStore,
  assets: NativeScreenshotAsset[],
  settings: Settings,
  onProgress: (p: BackfillProgress) => void,
  deps: PipelineDeps = {},
  chunkSize: number = 10,
): Promise<number> {
  let processed = 0;
  for (let i = 0; i < assets.length; i += chunkSize) {
    const chunk = assets.slice(i, i + chunkSize);
    for (const asset of chunk) {
      try {
        await indexScreenshot(store, asset, settings, deps);
      } catch (e) {
        console.warn(`[pipeline] failed to index ${asset.assetId}`, e);
      }
      processed += 1;
    }
    onProgress({ processed, total: assets.length, done: processed >= assets.length });
    // Yield to the JS event loop between chunks so the UI stays responsive.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return processed;
}

/** Milliseconds window for each BackfillWindow choice. */
export function backfillSinceMs(window: Settings['backfillWindow'], now: Date = new Date()): number {
  switch (window) {
    case 'last_30_days':
      return now.getTime() - 30 * 24 * 60 * 60 * 1000;
    case 'last_6_months':
      return now.getTime() - 183 * 24 * 60 * 60 * 1000;
    case 'all':
      return 0;
    case 'none':
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}
