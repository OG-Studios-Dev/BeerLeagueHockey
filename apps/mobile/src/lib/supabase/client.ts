import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SECURE_STORE_CHUNK_SIZE = 1800;
const AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

function getChunkMetaKey(key: string) {
  return `${key}.chunks`;
}

function getChunkKey(key: string, index: number) {
  return `${key}.chunk.${index}`;
}

async function removeChunkedValue(key: string): Promise<void> {
  const metaKey = getChunkMetaKey(key);
  const countRaw = await SecureStore.getItemAsync(metaKey);
  const count = countRaw ? Number(countRaw) : 0;

  await Promise.all([
    SecureStore.deleteItemAsync(key),
    SecureStore.deleteItemAsync(metaKey),
    ...Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(getChunkKey(key, index))),
  ]);
}

async function getNativeStoredValue(key: string): Promise<string | null> {
  const chunkCountRaw = await SecureStore.getItemAsync(getChunkMetaKey(key));
  if (!chunkCountRaw) {
    return SecureStore.getItemAsync(key);
  }

  const chunkCount = Number(chunkCountRaw);
  if (!Number.isFinite(chunkCount) || chunkCount <= 0) {
    return SecureStore.getItemAsync(key);
  }

  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, (_, index) => SecureStore.getItemAsync(getChunkKey(key, index))),
  );

  if (chunks.some((chunk) => chunk == null)) {
    return null;
  }

  return chunks.join('');
}

async function setNativeStoredValue(key: string, value: string): Promise<void> {
  await removeChunkedValue(key);

  if (value.length <= SECURE_STORE_CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  const chunks = value.match(new RegExp(`.{1,${SECURE_STORE_CHUNK_SIZE}}`, 'g')) ?? [value];
  await Promise.all([
    SecureStore.setItemAsync(getChunkMetaKey(key), String(chunks.length)),
    ...chunks.map((chunk, index) => SecureStore.setItemAsync(getChunkKey(key, index), chunk)),
  ]);
}

/**
 * Custom storage adapter using expo-secure-store for native
 * and localStorage for web (dev only)
 */
const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return getNativeStoredValue(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    await setNativeStoredValue(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    await removeChunkedValue(key);
  },
};

export async function purgeStoredSession(): Promise<void> {
  await ExpoSecureStoreAdapter.removeItem(AUTH_STORAGE_KEY);
}

/**
 * Supabase client for React Native
 * Uses SecureStore for JWT persistence (encrypted on-device storage)
 * Same database as web app — RLS policies protect data
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // No URL-based auth in native
  },
});
