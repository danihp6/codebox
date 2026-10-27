import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeMasterKey, sealSecret } from '@codebox/security';
import { createFileCredentialStorage, credentialsDirectory, storedLastFour } from './storage.js';
import type { StoredCredential } from './storage.js';

const KEY = decodeMasterKey(Buffer.alloc(32, 9).toString('base64'));
const directories: string[] = [];

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'cb-58-credentials-'));
  directories.push(path);
  return path;
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function credential(id: string, overrides: Partial<StoredCredential> = {}): StoredCredential {
  return {
    id,
    name: 'OpenAI',
    kind: 'model_key',
    expose: 'env',
    sealed: sealSecret('sk-test-abcdef', KEY),
    createdAt: '2026-10-27T10:00:00.000Z',
    updatedAt: '2026-10-27T10:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
    ...{ lastFour: 'cdef' },
  } as StoredCredential;
}

describe('file credential storage', () => {
  it('round-trips one credential with 0700 on the directory and 0600 on the file', () => {
    const root = directory();
    const path = credentialsDirectory(root);
    const storage = createFileCredentialStorage({ directory: path, masterKey: KEY });
    expect(storage.configured).toBe(true);
    storage.save(credential('cred_first'));

    const file = join(path, 'cred_first.json');
    expect(statSync(path).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(path)).toEqual(['cred_first.json']);

    const stored = storage.get('cred_first');
    expect(stored?.name).toBe('OpenAI');
    if (stored !== null) expect(storedLastFour(stored)).toBe('cdef');
    expect(storage.list()).toHaveLength(1);
  });

  it('narrows a wider directory and file mode instead of trusting it', () => {
    const root = directory();
    const path = credentialsDirectory(root);
    const storage = createFileCredentialStorage({ directory: path, masterKey: KEY });
    storage.save(credential('cred_wide'));
    chmodSync(path, 0o755);
    chmodSync(join(path, 'cred_wide.json'), 0o644);

    expect(storage.get('cred_wide')).not.toBeNull();
    expect(statSync(path).mode & 0o777).toBe(0o700);
    expect(statSync(join(path, 'cred_wide.json')).mode & 0o777).toBe(0o600);
  });

  it('writes through a temporary file and never leaves one behind', () => {
    const root = directory();
    const path = credentialsDirectory(root);
    const storage = createFileCredentialStorage({ directory: path, masterKey: KEY });
    storage.save(credential('cred_atomic'));
    expect(readdirSync(path).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('updates lastUsedAt and removes the document', () => {
    const root = directory();
    const storage = createFileCredentialStorage({
      directory: credentialsDirectory(root),
      masterKey: KEY,
    });
    storage.save(credential('cred_touch'));
    storage.touch('cred_touch', '2026-10-27T11:00:00.000Z');
    expect(storage.get('cred_touch')?.lastUsedAt).toBe('2026-10-27T11:00:00.000Z');

    storage.remove('cred_touch');
    expect(storage.get('cred_touch')).toBeNull();
    storage.remove('cred_touch');
  });

  it('refuses a traversal id and skips a malformed document', () => {
    const root = directory();
    const path = credentialsDirectory(root);
    const storage = createFileCredentialStorage({ directory: path, masterKey: KEY });
    expect(storage.get('../../etc/passwd')).toBeNull();
    expect(storage.get('cred_/../x')).toBeNull();

    mkdirSync(path, { recursive: true, mode: 0o700 });
    writeFileSync(join(path, 'cred_broken.json'), '{not json');
    writeFileSync(join(path, 'cred_shape.json'), JSON.stringify({ id: 'cred_shape' }));
    expect(storage.list()).toEqual([]);
  });

  it('reports an unconfigured store when there is no master key', () => {
    const storage = createFileCredentialStorage({
      directory: credentialsDirectory(directory()),
      masterKey: null,
    });
    expect(storage.configured).toBe(false);
    expect(storage.list()).toEqual([]);
  });

  it('sorts newest first and then by id', () => {
    const root = directory();
    const storage = createFileCredentialStorage({
      directory: credentialsDirectory(root),
      masterKey: KEY,
    });
    storage.save(credential('cred_b', { createdAt: '2026-10-27T10:00:01.000Z' }));
    storage.save(credential('cred_a', { createdAt: '2026-10-27T10:00:00.000Z' }));
    expect(storage.list().map((entry) => entry.id)).toEqual(['cred_b', 'cred_a']);
  });
});
