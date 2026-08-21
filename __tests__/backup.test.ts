import { MemoryStore } from '../src/db/memoryStore';
import {
  backupFileName,
  decryptBackup,
  encryptBackup,
  restoreBackup,
  serializeBackup,
} from '../src/backup/backupService';
import { DEFAULT_SETTINGS } from '../src/types';
import { makeRecord } from './helpers';

describe('backup round trip', () => {
  it('serializes, encrypts, decrypts and restores onto a fresh store', async () => {
    const source = new MemoryStore();
    await source.init();
    await source.upsertScreenshot(makeRecord({ ocrText: 'BESCOM bill ₹1,178 due 20/08/2026', category: 'bill' }));
    await source.upsertScreenshot(makeRecord({ ocrText: 'PNR: 4521067893', category: 'booking' }));
    await source.upsertReminder({
      id: 'rem_1',
      screenshotId: 'shot_x',
      actionType: 'due_date_reminder',
      title: 'Bill due',
      fireAt: Date.now() + 86400000,
      status: 'confirmed',
      auto: false,
      createdAt: Date.now(),
    });
    await source.saveSettings({ ...DEFAULT_SETTINGS, onboardingCompleted: true });

    const payload = await serializeBackup(source, 1234567890);
    expect(payload.screenshots).toHaveLength(2);
    // Embeddings are stripped — recomputed on restore.
    expect((payload.screenshots[0] as Record<string, unknown>).embedding).toBeUndefined();

    const cipherText = encryptBackup(payload, 'hunter2');
    expect(cipherText.startsWith('sbb1:')).toBe(true);
    expect(cipherText).not.toContain('BESCOM');

    const decrypted = decryptBackup(cipherText, 'hunter2');
    expect(decrypted.screenshots).toHaveLength(2);
    expect(decrypted.exportedAt).toBe(1234567890);

    const target = new MemoryStore();
    await target.init();
    const result = await restoreBackup(target, decrypted);
    expect(result.screenshots).toBe(2);
    expect(result.reminders).toBe(1);

    // Restored records are searchable again (embeddings recomputed).
    const restored = await target.listScreenshots(undefined, 10);
    expect(restored).toHaveLength(2);
    expect(restored.every(r => r.embedding != null)).toBe(true);

    // Settings adopted on a fresh install.
    expect((await target.getSettings()).onboardingCompleted).toBe(true);
  });

  it('rejects a wrong passphrase and non-backup content', async () => {
    const store = new MemoryStore();
    await store.init();
    const cipherText = encryptBackup(await serializeBackup(store), 'correct');
    expect(() => decryptBackup(cipherText, 'wrong')).toThrow(/passphrase|corrupted/i);
    expect(() => decryptBackup('garbage', 'x')).toThrow(/not a screenshot brain backup/i);
  });

  it('does not clobber existing records on restore', async () => {
    const store = new MemoryStore();
    await store.init();
    const live = makeRecord({ ocrText: 'live version', assetId: 'shared-asset' });
    await store.upsertScreenshot(live);

    const backupStore = new MemoryStore();
    await backupStore.init();
    await backupStore.upsertScreenshot(makeRecord({ ocrText: 'stale version', assetId: 'shared-asset' }));
    const payload = await serializeBackup(backupStore);

    const result = await restoreBackup(store, payload);
    expect(result.screenshots).toBe(0);
    expect((await store.getScreenshotByAssetId('shared-asset'))!.ocrText).toBe('live version');
  });

  it('rejects short passphrases and names files by date', () => {
    expect(() => encryptBackup({} as never, 'abc')).toThrow(/at least 4/i);
    expect(backupFileName(new Date('2026-08-21'))).toBe('screenshot-brain-backup-20260821.sbb');
  });
});
