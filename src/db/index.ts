/**
 * Store factory: native SQLite (FTS5, encrypted-at-rest via SQLCipher key when
 * available) with a pure-JS fallback so the app never hard-crashes if the
 * native module is missing (tests, web preview, first-frame races).
 */

import { SnapStore } from './store';
import { MemoryStore } from './memoryStore';

let instance: SnapStore | null = null;

export async function getStore(): Promise<SnapStore> {
  if (instance) {
    return instance;
  }
  try {
    const { SqliteStore } = require('./sqliteStore') as typeof import('./sqliteStore');
    instance = await SqliteStore.open();
  } catch (e) {
    console.warn('[db] native SQLite unavailable, using in-memory store', e);
    instance = new MemoryStore();
    await instance.init();
  }
  return instance;
}

/** Test seam. */
export function setStore(store: SnapStore | null): void {
  instance = store;
}

export type { SnapStore } from './store';
export { MemoryStore } from './memoryStore';
