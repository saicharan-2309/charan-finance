/**
 * Session storage for Supabase Auth backed by the iOS Keychain (expo-secure-store).
 *
 * Keychain items are best kept small (SecureStore warns above ~2 KB) and a
 * Supabase session JSON is usually larger, so values are split into chunks.
 * Writes are ordered so a crash mid-write can never yield a mixed session:
 * chunks first, then the chunk count (the commit marker).
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK_SIZE = 1800;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

async function getChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(`${safeKey(key)}.n`, OPTIONS);
  const n = raw ? Number(raw) : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

const webStorage = {
  getItem: async (key: string) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
  setItem: async (key: string, value: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};

export const secureSessionStorage =
  Platform.OS === 'web'
    ? webStorage
    : {
        async getItem(key: string): Promise<string | null> {
          const n = await getChunkCount(key);
          if (n === 0) return null;
          const parts: string[] = [];
          for (let i = 0; i < n; i++) {
            const part = await SecureStore.getItemAsync(`${safeKey(key)}.${i}`, OPTIONS);
            if (part === null) return null; // incomplete write — treat as signed out
            parts.push(part);
          }
          return parts.join('');
        },

        async setItem(key: string, value: string): Promise<void> {
          const k = safeKey(key);
          const previous = await getChunkCount(key);
          const chunks = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
          for (let i = 0; i < chunks; i++) {
            await SecureStore.setItemAsync(
              `${k}.${i}`,
              value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
              OPTIONS,
            );
          }
          await SecureStore.setItemAsync(`${k}.n`, String(chunks), OPTIONS);
          for (let i = chunks; i < previous; i++) {
            await SecureStore.deleteItemAsync(`${k}.${i}`, OPTIONS);
          }
        },

        async removeItem(key: string): Promise<void> {
          const k = safeKey(key);
          const n = await getChunkCount(key);
          await SecureStore.deleteItemAsync(`${k}.n`, OPTIONS);
          for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${k}.${i}`, OPTIONS);
        },
      };
