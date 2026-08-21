import { MemoryStore } from '../src/db/memoryStore';
import { hybridSearch, rrfMerge } from '../src/search/hybridSearch';
import { makeRecord } from './helpers';

describe('rrfMerge', () => {
  it('ranks documents found by both legs above single-leg hits', () => {
    const merged = rrfMerge(
      [
        { id: 'both', rank: 1 },
        { id: 'kw-only', rank: 0 },
      ],
      [
        { id: 'both', rank: 1 },
        { id: 'sem-only', rank: 0 },
      ],
    );
    expect(merged[0].id).toBe('both');
    expect(merged[0].matchedBy).toEqual(['keyword', 'semantic']);
  });
});

describe('hybridSearch', () => {
  it('finds screenshots by keyword and applies category filters', async () => {
    const store = new MemoryStore();
    await store.init();
    await store.upsertScreenshot(
      makeRecord({ ocrText: 'BESCOM electricity bill due 20 Aug ₹1,178', category: 'bill' }),
    );
    await store.upsertScreenshot(
      makeRecord({ ocrText: 'IRCTC PNR 4521067893 train to Chennai', category: 'booking' }),
    );

    const all = await hybridSearch(store, 'electricity bill');
    expect(all.length).toBeGreaterThan(0);
    expect(all[0].screenshot.category).toBe('bill');
    expect(all[0].snippet).toContain('electricity');

    const bookingsOnly = await hybridSearch(store, 'electricity bill', { categories: ['booking'] });
    expect(bookingsOnly.every(r => r.screenshot.category === 'booking')).toBe(true);
  });

  it('keeps sensitive categories findable (only previews are masked, in the UI)', async () => {
    const store = new MemoryStore();
    await store.init();
    await store.upsertScreenshot(
      makeRecord({ ocrText: 'Aadhaar card number 1234 5678 9012', category: 'id_document' }),
    );

    const results = await hybridSearch(store, 'aadhaar card');
    expect(results).toHaveLength(1);
    expect(results[0].screenshot.category).toBe('id_document');

    const explicitFilter = await hybridSearch(store, 'aadhaar card', { categories: ['id_document'] });
    expect(explicitFilter).toHaveLength(1);
  });

  it('returns empty for empty queries', async () => {
    const store = new MemoryStore();
    await store.init();
    expect(await hybridSearch(store, '   ')).toEqual([]);
  });
});
