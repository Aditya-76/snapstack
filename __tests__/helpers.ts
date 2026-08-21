import { hashEmbed } from '../src/pipeline/embeddings';
import { ScreenshotRecord } from '../src/types';

let counter = 0;

export function makeRecord(overrides: Partial<ScreenshotRecord> & { ocrText: string }): ScreenshotRecord {
  counter += 1;
  return {
    id: `shot_test_${counter}`,
    assetId: `asset_${counter}`,
    takenAt: Date.now() - counter * 1000,
    indexedAt: Date.now(),
    category: 'meme_other',
    categoryConfidence: 0.9,
    entities: [],
    sourceApp: null,
    thumbnailPath: null,
    originalDeleted: false,
    originalDeletedAt: null,
    embedding: hashEmbed(overrides.ocrText),
    ...overrides,
  };
}
