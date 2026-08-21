/**
 * Store factory: native SQLite (FTS5) encrypted at rest with a device-local
 * key held in the OS keystore/keychain (PRD §7.7), with a pure-JS fallback so
 * the app never hard-crashes if the native module is missing (tests, web
 * preview, first-frame races).
 */

import { SnapStore } from './store';
import { MemoryStore } from './memoryStore';

const DB_KEY_ALIAS = 'sb_db_key';

let instance: SnapStore | null = null;
let opening: Promise<SnapStore> | null = null;

async function getDbEncryptionKey(): Promise<string | undefined> {
  try {
    const { SecureStore } = require('../native/secureStore') as typeof import('../native/secureStore');
    return await SecureStore.getOrCreateSecret(DB_KEY_ALIAS);
  } catch (e) {
    console.warn('[db] secure key unavailable; opening without at-rest encryption', e);
    return undefined;
  }
}

export async function getStore(): Promise<SnapStore> {
  if (instance) {
    return instance;
  }
  // Memoize the open so concurrent first calls share one connection.
  if (!opening) {
    opening = (async () => {
      try {
        const { SqliteStore } = require('./sqliteStore') as typeof import('./sqliteStore');
        const key = await getDbEncryptionKey();
        instance = await SqliteStore.open(key);
      } catch (e) {
        console.warn('[db] native SQLite unavailable, using in-memory store', e);
        instance = new MemoryStore();
        await instance.init();
      }
      return instance;
    })();
  }
  return opening;
}

/** Test seam. */
export function setStore(store: SnapStore | null): void {
  instance = store;
  opening = null;
}

export type { SnapStore } from './store';
export { MemoryStore } from './memoryStore';
