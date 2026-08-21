/**
 * Keystore/Keychain-backed secrets (PRD §7.7). Thin wrapper so callers get a
 * clean throw (caught by db factory) instead of a null-module crash.
 */

import { NativeModules } from 'react-native';

interface SecureStoreModuleType {
  getOrCreateSecret(alias: string): Promise<string>;
}

export const SecureStore: SecureStoreModuleType = {
  async getOrCreateSecret(alias: string): Promise<string> {
    const mod = NativeModules.SecureStoreModule as SecureStoreModuleType | undefined;
    if (!mod) {
      throw new Error('SecureStoreModule not available');
    }
    return mod.getOrCreateSecret(alias);
  },
};
