import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { SealedSecret } from '@codebox/security';
import type { CredentialKind, ExposeKind } from './schemas.js';
import { storedCredentialSchema } from './schemas.js';

export const SECRETS_DIRECTORY = 'secrets';
export const CREDENTIALS_DIRECTORY = 'credentials';
export const DIRECTORY_MODE = 0o700;
export const FILE_MODE = 0o600;

const FILE_PATTERN = /^[A-Za-z0-9_-]+\.json$/;
const ID_PATTERN = /^[A-Za-z0-9_]+$/;

export interface StoredCredential {
  readonly id: string;
  readonly name: string;
  readonly kind: CredentialKind;
  readonly expose: ExposeKind;
  readonly sealed: SealedSecret;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
}

export interface CredentialStorage {
  readonly configured: boolean;
  list(): readonly StoredCredential[];
  get(id: string): StoredCredential | null;
  save(credential: StoredCredential): void;
  remove(id: string): void;
  touch(id: string, at: string): void;
}

/** `${CB_STATE_DIR}/secrets/credentials`, the one path the vault owns. */
export function credentialsDirectory(stateDir: string): string {
  return join(stateDir, SECRETS_DIRECTORY, CREDENTIALS_DIRECTORY);
}

/**
 * `lastFour` is metadata beside the frozen `StoredCredential`: it travels in the same JSON
 * document so `list` can report it without opening a seal it does not need.
 */
export function storedLastFour(credential: StoredCredential): string {
  const candidate = (credential as StoredCredential & { readonly lastFour?: unknown }).lastFour;
  return typeof candidate === 'string' ? candidate : '';
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function ensureMode(path: string, mode: number): void {
  const current = statSync(path).mode & 0o777;
  if (current !== mode) chmodSync(path, mode);
}

export function createFileCredentialStorage(options: {
  readonly directory: string;
  readonly masterKey: Uint8Array | null;
}): CredentialStorage {
  const directory = options.directory;

  function ensureDirectory(): void {
    mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
    ensureMode(directory, DIRECTORY_MODE);
  }

  function fileFor(id: string): string | null {
    return ID_PATTERN.test(id) ? join(directory, `${id}.json`) : null;
  }

  function read(file: string): StoredCredential | null {
    ensureMode(file, FILE_MODE);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    const parsed = storedCredentialSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  function write(file: string, credential: StoredCredential): void {
    const lastFour = storedLastFour(credential);
    const document = lastFour === '' ? credential : { ...credential, lastFour };
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(document)}\n`, {
      encoding: 'utf8',
      mode: FILE_MODE,
    });
    chmodSync(temporary, FILE_MODE);
    renameSync(temporary, file);
  }

  function get(id: string): StoredCredential | null {
    const file = fileFor(id);
    if (file === null) return null;
    ensureDirectory();
    if (!isFile(file)) return null;
    return read(file);
  }

  function save(credential: StoredCredential): void {
    const file = fileFor(credential.id);
    if (file === null) throw new Error('invalid credential id');
    ensureDirectory();
    write(file, credential);
  }

  function remove(id: string): void {
    const file = fileFor(id);
    if (file === null) return;
    rmSync(file, { force: true });
    rmSync(`${file}.tmp`, { force: true });
  }

  function touch(id: string, at: string): void {
    const credential = get(id);
    if (credential === null) return;
    save({ ...credential, lastUsedAt: at });
  }

  return {
    configured: options.masterKey !== null,
    list(): readonly StoredCredential[] {
      ensureDirectory();
      const entries = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name))
        .map((entry) => entry.name);
      const credentials: StoredCredential[] = [];
      for (const name of entries) {
        const path = join(directory, name);
        if (!isFile(path)) continue;
        const credential = read(path);
        if (credential !== null) credentials.push(credential);
      }
      return credentials.sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : right.createdAt.localeCompare(left.createdAt),
      );
    },
    get,
    save,
    remove,
    touch,
  };
}
