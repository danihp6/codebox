import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openInMemoryStore } from '@codebox/store';
import { createApp } from './app.js';
import { loadConfig, readBuildInfo, resolvePaths } from './config.js';
import { createLogger } from './logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry, loadModules } from './modules.js';
import type { DaemonApp, DaemonContext } from './modules.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const RETIRED = ['/v1/chat', '/v1/routines', '/v1/reminders'] as const;
const SURVIVING = ['/v1/jobs', '/v1/runs', '/v1/sessions', '/v1/works'] as const;

const contexts: DaemonContext[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.shutdown.run();
    context.store.close();
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Mounted {
  readonly app: DaemonApp;
  readonly context: DaemonContext;
  readonly loaded: readonly string[];
  readonly failed: readonly { readonly name: string; readonly error: string }[];
}

async function mountAll(): Promise<Mounted> {
  const root = mkdtempSync(join(tmpdir(), 'cb-76-routes-'));
  roots.push(root);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(root, 'state'),
    CB_INSTALL_DIR: join(root, 'install'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const context: DaemonContext = {
    config,
    store: openInMemoryStore(),
    logger: createLogger({ level: 'error', sink: () => undefined }),
    clock: () => new Date('2026-10-28T10:00:00.000Z'),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(root, 'install', 'app'),
    shutdown: createShutdownRegistry(createLogger({ level: 'error', sink: () => undefined })),
  };
  contexts.push(context);
  const app = createApp({ context });
  const report = await loadModules({ app, context });
  return { app, context, loaded: report.loaded, failed: report.failed };
}

function count(context: DaemonContext, table: string): number {
  const row = context.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

describe('the mounted /v1 table', () => {
  it('mounts nothing under a retired prefix', async () => {
    const { app } = await mountAll();
    const paths = app.routes.map((route) => route.path);
    for (const prefix of RETIRED) {
      expect(
        paths.filter((path) => path === prefix || path.startsWith(`${prefix}/`)),
        prefix,
      ).toEqual([]);
    }
  });

  it('keeps the jobs, runs, sessions and works routes', async () => {
    const { app } = await mountAll();
    const paths = app.routes.map((route) => route.path);
    for (const path of SURVIVING) expect(paths, path).toContain(path);
  });

  it('loads no chat or routines subsystem', async () => {
    const { loaded, failed } = await mountAll();
    expect(failed).toEqual([]);
    expect(loaded).not.toContain('chat');
    expect(loaded).not.toContain('routines');
  });

  it('never writes a retired table', async () => {
    const { context } = await mountAll();
    expect(count(context, 'chat_sessions')).toBe(0);
    expect(count(context, 'chat_messages')).toBe(0);
  });
});
