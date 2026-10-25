import { InjectionToken } from '@angular/core';

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export const REFRESH_TOKEN_KEY = 'cb.refreshToken';

const DB_NAME = 'codebox-secure';
const DB_VERSION = 1;
const KEYS_STORE = 'keys';
const ITEMS_STORE = 'items';
const WRAP_RECORD = 'wrap';
const WRAP_ALGORITHM = 'AES-GCM';
const WRAP_KEY_LENGTH = 256;
const IV_BYTES = 12;

interface WrappedKeyRecord {
  readonly id: string;
  readonly key: CryptoKey;
}

interface SecretRecord {
  readonly key: string;
  readonly iv: Uint8Array;
  readonly data: ArrayBuffer;
}

export function createSecureStore(options?: {
  readonly indexedDb?: IDBFactory | null;
  readonly crypto?: Crypto;
}): SecureStore {
  const factory =
    options?.indexedDb === undefined ? (globalThis.indexedDB ?? null) : options.indexedDb;
  const cryptoImpl = options?.crypto ?? globalThis.crypto;
  return factory === null ? createMemoryStore() : createIndexedDbStore(factory, cryptoImpl);
}

export const SECURE_STORE = new InjectionToken<SecureStore>('SECURE_STORE', {
  providedIn: 'root',
  factory: () => createSecureStore(),
});

function createMemoryStore(): SecureStore {
  const values = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      values.clear();
      return Promise.resolve();
    },
  };
}

function createIndexedDbStore(factory: IDBFactory, cryptoImpl: Crypto): SecureStore {
  let database: Promise<IDBDatabase> | null = null;
  let wrapKey: Promise<CryptoKey> | null = null;

  const open = (): Promise<IDBDatabase> => {
    database ??= openDatabase(factory);
    return database;
  };

  const keyFor = (): Promise<CryptoKey> => {
    wrapKey ??= open().then((db) => loadWrapKey(db, cryptoImpl));
    return wrapKey;
  };

  return {
    async get(key) {
      const db = await open();
      const record = await readRecord(db, key);
      if (!isSecretRecord(record)) return null;
      return decrypt(await keyFor(), cryptoImpl, record);
    },

    async set(key, value) {
      const db = await open();
      const iv = cryptoImpl.getRandomValues(new Uint8Array(IV_BYTES));
      const data = await cryptoImpl.subtle.encrypt(
        { name: WRAP_ALGORITHM, iv },
        await keyFor(),
        new TextEncoder().encode(value),
      );
      await writeRecord(db, { key, iv, data });
    },

    async remove(key) {
      const db = await open();
      const tx = db.transaction(ITEMS_STORE, 'readwrite');
      tx.objectStore(ITEMS_STORE).delete(key);
      await transactionDone(tx);
    },

    async clear() {
      const db = await open();
      const tx = db.transaction(ITEMS_STORE, 'readwrite');
      tx.objectStore(ITEMS_STORE).clear();
      await transactionDone(tx);
    },
  };
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEYS_STORE)) {
        db.createObjectStore(KEYS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ITEMS_STORE)) {
        db.createObjectStore(ITEMS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

async function loadWrapKey(db: IDBDatabase, cryptoImpl: Crypto): Promise<CryptoKey> {
  const tx = db.transaction(KEYS_STORE, 'readonly');
  const existing = await readRequest<unknown>(tx.objectStore(KEYS_STORE).get(WRAP_RECORD));
  if (isWrappedKeyRecord(existing)) return existing.key;

  const generated = await cryptoImpl.subtle.generateKey(
    { name: WRAP_ALGORITHM, length: WRAP_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
  const write = db.transaction(KEYS_STORE, 'readwrite');
  write.objectStore(KEYS_STORE).put({ id: WRAP_RECORD, key: generated } satisfies WrappedKeyRecord);
  await transactionDone(write);
  return generated;
}

async function readRecord(db: IDBDatabase, key: string): Promise<unknown> {
  const tx = db.transaction(ITEMS_STORE, 'readonly');
  return readRequest<unknown>(tx.objectStore(ITEMS_STORE).get(key));
}

async function writeRecord(db: IDBDatabase, record: SecretRecord): Promise<void> {
  const tx = db.transaction(ITEMS_STORE, 'readwrite');
  tx.objectStore(ITEMS_STORE).put(record);
  await transactionDone(tx);
}

async function decrypt(
  key: CryptoKey,
  cryptoImpl: Crypto,
  record: SecretRecord,
): Promise<string> {
  const plain = await cryptoImpl.subtle.decrypt(
    { name: WRAP_ALGORITHM, iv: new Uint8Array(record.iv) },
    key,
    record.data,
  );
  return new TextDecoder().decode(plain);
}

function readRequest<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  });
}

function isWrappedKeyRecord(value: unknown): value is WrappedKeyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { id?: unknown; key?: unknown };
  return record.id === WRAP_RECORD && typeof record.key === 'object' && record.key !== null;
}

function isSecretRecord(value: unknown): value is SecretRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { key?: unknown; iv?: unknown; data?: unknown };
  return (
    typeof record.key === 'string' &&
    record.iv instanceof Uint8Array &&
    record.data instanceof ArrayBuffer
  );
}
