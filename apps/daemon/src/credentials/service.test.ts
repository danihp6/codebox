import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeMasterKey } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { createCredentialsService, integrationsOf } from './service.js';
import { createFileCredentialStorage, credentialsDirectory, storedLastFour } from './storage.js';
import type { CredentialStorage, StoredCredential } from './storage.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-27T10:00:00.000Z';
const MASTER_KEY = Buffer.alloc(32, 4).toString('base64');
const PLAINTEXT = 'sk-live-SECRETVALUE-abcdef';

const directories: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(options: { readonly configured?: boolean } = {}): DaemonContext {
  const root = mkdtempSync(join(tmpdir(), 'cb-58-credentials-service-'));
  directories.push(root);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(root, 'state'),
    CB_REPO_ROOT: join(root, 'repos'),
    CB_WORKSPACE_ROOT: join(root, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    ...(options.configured === false ? {} : { CB_SECRETS_KEY: MASTER_KEY }),
  });
  const store = openInMemoryStore();
  stores.push(store);
  const now = new Date(NOW);
  const logger = createLogger({ level: 'trace', sink: () => undefined });
  return {
    config,
    store,
    logger,
    clock: () => now,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(root, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
}

function errorOf(run: () => unknown): RunApiError | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof RunApiError ? error : null;
  }
}

describe('credentials service', () => {
  it('seals a value, reports only metadata and opens it on demand', () => {
    const context = fixture();
    const service = createCredentialsService({ context, now: () => new Date(NOW) });
    const created = service.create({
      name: 'OpenAI',
      kind: 'model_key',
      expose: 'env',
      value: PLAINTEXT,
    });

    expect(created.id).toMatch(/^cred_[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(created).toEqual({
      id: created.id,
      name: 'OpenAI',
      kind: 'model_key',
      expose: 'env',
      configured: true,
      lastFour: 'cdef',
      createdAt: NOW,
      updatedAt: NOW,
      lastUsedAt: null,
    });
    expect(JSON.stringify(created)).not.toContain(PLAINTEXT);

    expect(service.open(created.id)).toBe(PLAINTEXT);
    expect(service.list()).toHaveLength(1);
    expect(service.list()[0]?.lastFour).toBe('cdef');

    const directory = credentialsDirectory(context.config.CB_STATE_DIR);
    const file = readdirSync(directory)[0] ?? '';
    const document = readFileSync(join(directory, file), 'utf8');
    expect(document).not.toContain(PLAINTEXT);
    expect(document).not.toContain(PLAINTEXT.slice(-8));
  });

  it('refuses expose env on anything but a model_key', () => {
    const context = fixture();
    const service = createCredentialsService({ context });
    const error = errorOf(() =>
      service.create({ name: 'API', kind: 'api_key', expose: 'env', value: PLAINTEXT }),
    );
    expect(error?.status).toBe(422);
    expect(error?.details).toEqual({ path: 'credential.expose', reason: 'env_not_allowed' });
    expect(service.list()).toEqual([]);
  });

  it('is 503 secrets_not_configured when CB_SECRETS_KEY is absent', () => {
    const context = fixture({ configured: false });
    const service = createCredentialsService({ context });
    expect(service.storage.configured).toBe(false);
    expect(service.list()).toEqual([]);
    const error = errorOf(() =>
      service.create({ name: 'OpenAI', kind: 'model_key', expose: 'env', value: PLAINTEXT }),
    );
    expect(error?.status).toBe(503);
    expect(error?.details).toEqual({ reason: 'secrets_not_configured' });
  });

  it('rotates the seal, updates lastFour and never logs the value', () => {
    const lines: string[] = [];
    const context = fixture();
    const logger = createLogger({ level: 'trace', sink: (line) => lines.push(line) });
    const service = createCredentialsService({
      context: { ...context, logger },
      now: () => new Date(NOW),
    });
    const created = service.create({
      name: 'OpenAI',
      kind: 'model_key',
      expose: 'env',
      value: PLAINTEXT,
    });
    const rotated = service.rotate(created.id, { value: 'sk-live-NEXTVALUE-9999zzzz' });
    expect(rotated.id).toBe(created.id);
    expect(rotated.lastFour).toBe('zzzz');
    expect(service.open(created.id)).toBe('sk-live-NEXTVALUE-9999zzzz');

    const logs = lines.join('\n');
    expect(logs).toContain('credential_saved');
    expect(logs).toContain('credential_rotated');
    expect(logs).not.toContain(PLAINTEXT);
    expect(logs).not.toContain('NEXTVALUE');
  });

  it('removes a credential and refuses an unknown id', () => {
    const context = fixture();
    const service = createCredentialsService({ context });
    const created = service.create({
      name: 'OpenAI',
      kind: 'model_key',
      expose: 'env',
      value: PLAINTEXT,
    });
    service.remove(created.id);
    expect(service.list()).toEqual([]);
    expect(errorOf(() => service.remove(created.id))?.status).toBe(404);
    expect(errorOf(() => service.remove(created.id))?.details).toEqual({ path: 'credential.id' });
    expect(errorOf(() => service.open(created.id))?.details).toEqual({ path: 'credential.id' });
  });

  it('lists a seal without opening it', () => {
    const context = fixture();
    const root = mkdtempSync(join(tmpdir(), 'cb-58-credentials-injected-'));
    directories.push(root);
    const storage: CredentialStorage = createFileCredentialStorage({
      directory: join(root, 'credentials'),
      masterKey: decodeMasterKey(MASTER_KEY),
    });
    const broken: StoredCredential = {
      id: 'cred_unopenable',
      name: 'Broken',
      kind: 'api_key',
      expose: 'daemon',
      sealed: { v: 1, iv: 'AAAA', tag: 'AAAA', ciphertext: 'AAAA' },
      createdAt: NOW,
      updatedAt: NOW,
      lastUsedAt: null,
      ...{ lastFour: 'wxyz' },
    } as StoredCredential;
    storage.save(broken);

    const service = createCredentialsService({ context, storage });
    const listed = service.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.lastFour).toBe(storedLastFour(broken));
    expect(errorOf(() => service.open('cred_unopenable'))?.status).toBe(503);
  });

  it('exposes the integration surface through the same service', () => {
    const context = fixture();
    const service = createCredentialsService({ context });
    expect(integrationsOf(service).list()).toEqual([]);
    expect(service.listIntegrations()).toEqual([]);
    expect(typeof service.request).toBe('function');
    expect(typeof service.createIntegration).toBe('function');
    expect(typeof service.removeIntegration).toBe('function');
  });
});
