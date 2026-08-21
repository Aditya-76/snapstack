import { MemoryStore } from '../src/db/memoryStore';
import { backfill, backfillSinceMs, indexScreenshot } from '../src/pipeline/pipeline';
import { hybridSearch } from '../src/search/hybridSearch';
import { DEFAULT_SETTINGS, OcrResult } from '../src/types';
import { NativeScreenshotAsset } from '../src/native';

const NOW = new Date('2026-08-13T10:00:00');

function fakeOcr(text: string): (assetId: string) => Promise<OcrResult> {
  return async () => ({ text, boxes: [], languages: ['en'] });
}

function asset(id: string): NativeScreenshotAsset {
  return { assetId: id, takenAt: NOW.getTime(), width: 1080, height: 2400, filePath: '' };
}

describe('indexScreenshot', () => {
  it('runs the full pipeline: OCR → classify → extract → embed → store → suggest', async () => {
    const store = new MemoryStore();
    await store.init();

    const record = await indexScreenshot(
      store,
      asset('content://media/external/images/1'),
      DEFAULT_SETTINGS,
      {
        ocr: fakeOcr('Airtel Broadband Bill. Amount Due ₹1,178. Due Date: 20/08/2026'),
        thumbnail: async () => null,
        now: () => NOW,
      },
    );

    expect(record.category).toBe('bill');
    expect(record.sourceApp).toBeNull();
    expect(record.entities.some(e => e.type === 'due_date' && e.value === '2026-08-20')).toBe(true);
    expect(record.embedding).not.toBeNull();

    // Stored and searchable end-to-end.
    const results = await hybridSearch(store, 'broadband bill');
    expect(results[0]?.screenshot.id).toBe(record.id);

    // Action detection produced a reminder suggestion.
    expect(await store.listReminders('suggested')).toHaveLength(1);
  });

  it('is idempotent per asset and does not duplicate suggestions', async () => {
    const store = new MemoryStore();
    await store.init();
    const deps = {
      ocr: fakeOcr('Bill due 20/08/2026 ₹500'),
      thumbnail: async () => null,
      now: () => NOW,
    };
    const first = await indexScreenshot(store, asset('asset-1'), DEFAULT_SETTINGS, deps);
    const second = await indexScreenshot(store, asset('asset-1'), DEFAULT_SETTINGS, deps);

    expect(second.id).toBe(first.id);
    expect(await store.countScreenshots()).toBe(1);
    expect(await store.listReminders()).toHaveLength(1);
  });

  it('classifies empty-OCR screenshots as meme_other without embedding', async () => {
    const store = new MemoryStore();
    await store.init();
    const record = await indexScreenshot(store, asset('asset-2'), DEFAULT_SETTINGS, {
      ocr: fakeOcr(''),
      thumbnail: async () => null,
      now: () => NOW,
    });
    expect(record.category).toBe('meme_other');
    expect(record.embedding).toBeNull();
  });
});

describe('backfill', () => {
  it('indexes in chunks and reports progress', async () => {
    const store = new MemoryStore();
    await store.init();
    const assets = Array.from({ length: 25 }, (_, i) => asset(`bulk-${i}`));
    const progress: number[] = [];

    const processed = await backfill(
      store,
      assets,
      DEFAULT_SETTINGS,
      p => progress.push(p.processed),
      { ocr: fakeOcr('some text'), thumbnail: async () => null, now: () => NOW },
      10,
    );

    expect(processed).toBe(25);
    expect(await store.countScreenshots()).toBe(25);
    expect(progress[progress.length - 1]).toBe(25);
  });

  it('continues past individual failures', async () => {
    const store = new MemoryStore();
    await store.init();
    let calls = 0;
    const processed = await backfill(
      store,
      [asset('ok-1'), asset('boom'), asset('ok-2')],
      DEFAULT_SETTINGS,
      () => {},
      {
        ocr: async id => {
          calls += 1;
          if (id === 'boom') {
            throw new Error('ocr crashed');
          }
          return { text: 'hello', boxes: [], languages: [] };
        },
        thumbnail: async () => null,
        now: () => NOW,
      },
    );
    expect(calls).toBe(3);
    expect(processed).toBe(3);
    expect(await store.countScreenshots()).toBe(2);
  });
});

describe('backfillSinceMs', () => {
  it('maps windows to timestamps', () => {
    expect(backfillSinceMs('all', NOW)).toBe(0);
    expect(backfillSinceMs('last_30_days', NOW)).toBe(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(backfillSinceMs('none', NOW)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
