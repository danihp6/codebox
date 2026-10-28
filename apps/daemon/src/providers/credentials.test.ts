import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { credentialsDirectory } from '../credentials/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { createProviderCredentialPort } from './credentials.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-28T10:00:00.000Z';
const MASTER_KEY = Buffer.alloc(32, 2).toString('base64');
const TOKEN = 'tok_Q7mZ4xR9pL2vB6nK8wT3';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function makeContext(configured: boolean): DaemonContext {
  const directory = mkdtempSync(join(tmpdir(), 'cb-73-credential-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    ...(configured ? { CB_SECRETS_KEY: MASTER_KEY } : {}),
  });
  const store = openInMemoryStore();
  stores.push(store);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  return {
    config,
    store,
    logger,
    clock: () => new Date(NOW),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
}

describe('createProviderCredentialPort', () => {
  it('seals one model_key credential exposed to the daemon only', () => {
    const context = makeContext(true);
    const port = createProviderCredentialPort(context);
    const created = port.create({ name: 'OpenCode Go · main', value: TOKEN });

    expect(created.lastFour).toBe('8wT3');
    expect(port.lastFour(created.id)).toBe('8wT3');
    expect(JSON.stringify(created)).not.toContain(TOKEN);

    const file = join(credentialsDirectory(context.paths.stateDir), `${created.id}.json`);
    const document: unknown = JSON.parse(readFileSync(file, 'utf8'));
    expect(document).toMatchObject({
      id: created.id,
      name: 'OpenCode Go · main',
      kind: 'model_key',
      expose: 'daemon',
    });
    expect(readFileSync(file, 'utf8')).not.toContain(TOKEN);
  });

  it('answers an empty last-four for an unknown credential', () => {
    const port = createProviderCredentialPort(makeContext(true));
    expect(port.lastFour('cred_unknown000')).toBe('');
  });

  it('removes the credential and tolerates a second removal', () => {
    const port = createProviderCredentialPort(makeContext(true));
    const created = port.create({ name: 'OpenCode Go · spare', value: TOKEN });
    expect(port.lastFour(created.id)).toBe('8wT3');
    port.remove(created.id);
    expect(port.lastFour(created.id)).toBe('');
    expect(() => port.remove(created.id)).not.toThrow();
  });

  it('refuses to seal without a master key', () => {
    const port = createProviderCredentialPort(makeContext(false));
    let thrown: unknown;
    try {
      port.create({ name: 'OpenCode Go · main', value: TOKEN });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RunApiError);
    expect((thrown as RunApiError).status).toBe(503);
    expect((thrown as RunApiError).details).toEqual({ reason: 'secrets_not_configured' });
  });
});
