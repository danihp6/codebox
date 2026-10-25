import { describe, expect, it } from 'vitest';
import { REFRESH_TOKEN_KEY, createSecureStore } from './secure-store';

describe('createSecureStore', () => {
  it('falls back to an in-memory store without IndexedDB', async () => {
    const store = createSecureStore({ indexedDb: null });

    await expect(store.get(REFRESH_TOKEN_KEY)).resolves.toBeNull();
    await store.set(REFRESH_TOKEN_KEY, 'refresh-token');
    await expect(store.get(REFRESH_TOKEN_KEY)).resolves.toBe('refresh-token');
    await store.remove(REFRESH_TOKEN_KEY);
    await expect(store.get(REFRESH_TOKEN_KEY)).resolves.toBeNull();
  });

  it('clears every entry', async () => {
    const store = createSecureStore({ indexedDb: null });
    await store.set('a', '1');
    await store.set('b', '2');

    await store.clear();

    await expect(store.get('a')).resolves.toBeNull();
    await expect(store.get('b')).resolves.toBeNull();
  });

  it('falls back when the global IndexedDB is absent', async () => {
    const store = createSecureStore();
    await store.set(REFRESH_TOKEN_KEY, 'refresh-token');
    await expect(store.get(REFRESH_TOKEN_KEY)).resolves.toBe('refresh-token');
    expect(REFRESH_TOKEN_KEY).toBe('cb.refreshToken');
  });
});
