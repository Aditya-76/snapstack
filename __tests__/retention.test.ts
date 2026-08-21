import { MemoryStore } from '../src/db/memoryStore';
import { resetSweepCursor, runRetentionSweep } from '../src/maintenance/retention';
import { DEFAULT_SETTINGS } from '../src/types';
import { makeRecord } from './helpers';

const NOW = new Date('2026-08-13T10:00:00').getTime();
const DAY = 24 * 60 * 60 * 1000;

const granted = async () => 'granted';

beforeEach(() => resetSweepCursor());

describe('runRetentionSweep', () => {
  it('marks records whose gallery original disappeared', async () => {
    const store = new MemoryStore();
    await store.init();
    const kept = makeRecord({ ocrText: 'still there', assetId: 'exists' });
    const gone = makeRecord({ ocrText: 'deleted from gallery', assetId: 'gone' });
    await store.upsertScreenshot(kept);
    await store.upsertScreenshot(gone);

    const result = await runRetentionSweep(store, DEFAULT_SETTINGS, NOW, {
      assetExists: async id => id !== 'gone',
      getPermissionStatus: granted,
    });

    expect(result.newlyMarkedDeleted).toBe(1);
    expect((await store.getScreenshot(gone.id))!.originalDeleted).toBe(true);
    expect((await store.getScreenshot(gone.id))!.originalDeletedAt).not.toBeNull();
    expect((await store.getScreenshot(kept.id))!.originalDeleted).toBe(false);
  });

  it('never marks anything without full photo permission (limited/denied)', async () => {
    const store = new MemoryStore();
    await store.init();
    const rec = makeRecord({ ocrText: 'x', assetId: 'invisible-under-limited' });
    await store.upsertScreenshot(rec);

    for (const status of ['limited', 'denied', 'undetermined', 'unavailable']) {
      const result = await runRetentionSweep(store, DEFAULT_SETTINGS, NOW, {
        assetExists: async () => false, // the OS would claim everything is gone
        getPermissionStatus: async () => status,
      });
      expect(result.deletionPassSkipped).toBe(true);
      expect(result.newlyMarkedDeleted).toBe(0);
    }
    expect((await store.getScreenshot(rec.id))!.originalDeleted).toBe(false);
  });

  it('aborts the deletion pass when an implausible share of assets looks deleted', async () => {
    const store = new MemoryStore();
    await store.init();
    for (let i = 0; i < 30; i++) {
      await store.upsertScreenshot(makeRecord({ ocrText: `s${i}`, assetId: `a${i}` }));
    }
    // Everything "missing" — a permission race, not a real mass delete.
    const result = await runRetentionSweep(store, DEFAULT_SETTINGS, NOW, {
      assetExists: async () => false,
      getPermissionStatus: granted,
    });
    expect(result.newlyMarkedDeleted).toBe(0);
    const all = await store.listScreenshots(undefined, 100);
    expect(all.every(r => !r.originalDeleted)).toBe(true);
  });

  it('keeps extracted data forever by default', async () => {
    const store = new MemoryStore();
    await store.init();
    const rec = makeRecord({ ocrText: 'x', assetId: 'gone' });
    rec.originalDeleted = true;
    rec.originalDeletedAt = NOW - 400 * DAY;
    await store.upsertScreenshot(rec);

    const result = await runRetentionSweep(store, DEFAULT_SETTINGS, NOW, {
      assetExists: async () => false,
      getPermissionStatus: granted,
    });
    expect(result.purged).toBe(0);
    expect(await store.getScreenshot(rec.id)).not.toBeNull();
  });

  it('purges rows and thumbnails past the opt-in retention window', async () => {
    const store = new MemoryStore();
    await store.init();
    const old = makeRecord({ ocrText: 'old', assetId: 'old', thumbnailPath: '/thumbs/old.webp' });
    old.originalDeleted = true;
    old.originalDeletedAt = NOW - 31 * DAY;
    const recent = makeRecord({ ocrText: 'recent', assetId: 'recent' });
    recent.originalDeleted = true;
    recent.originalDeletedAt = NOW - 5 * DAY;
    await store.upsertScreenshot(old);
    await store.upsertScreenshot(recent);

    const deletedThumbs: string[] = [];
    const settings = { ...DEFAULT_SETTINGS, purgeAfterOriginalDeletedDays: 30 };
    const result = await runRetentionSweep(store, settings, NOW, {
      assetExists: async () => true,
      getPermissionStatus: granted,
      deleteThumbnail: async p => {
        deletedThumbs.push(p);
      },
    });

    expect(result.purged).toBe(1);
    expect(deletedThumbs).toEqual(['/thumbs/old.webp']);
    expect(await store.getScreenshot(old.id)).toBeNull();
    expect(await store.getScreenshot(recent.id)).not.toBeNull();
  });

  it('survives assetExists failures without marking anything', async () => {
    const store = new MemoryStore();
    await store.init();
    const rec = makeRecord({ ocrText: 'x', assetId: 'a' });
    await store.upsertScreenshot(rec);

    const result = await runRetentionSweep(store, DEFAULT_SETTINGS, NOW, {
      assetExists: async () => {
        throw new Error('transient');
      },
      getPermissionStatus: granted,
    });
    expect(result.newlyMarkedDeleted).toBe(0);
    expect((await store.getScreenshot(rec.id))!.originalDeleted).toBe(false);
  });
});
