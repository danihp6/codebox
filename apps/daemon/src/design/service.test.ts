import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Repo } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { GitCommandInput, GitResult, GitRunner } from '@codebox/workspaces';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import {
  DesignReadError,
  DesignRevisionError,
  createDesignRuntime,
  createDesignService,
  designService,
} from './service.js';
import type { DesignRuntime, DesignSnapshot } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-29T10:00:00.000Z';
const SHORT = '9f1c2ab';
const FULL = '9f1c2ab0123456789abcdef0123456789abcdef0';
const REPO_ROOT = '/var/lib/codebox/repos';

const REPO: Repo = {
  id: 'repo_01JABCDEFGHJKMNPQRSV',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'manual',
  protectedPaths: [],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const TOKENS = '{"color":{"ink":{"$value":"#0b1120","$type":"color"}}}';
const ROUTES =
  '{"routes":[{"path":"/repos/:id","screen":"Repo · backlog","component":"RepoBacklogPage"}]}';
const SCREEN =
  '{"screen":"Repo · backlog","route":"/repos/:id","states":{"loading":"a","empty":"b","error":"c"}}';

interface ScriptedCall {
  readonly args: readonly string[];
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

interface FakeGit {
  readonly git: GitRunner;
  readonly calls: readonly (readonly string[])[];
}

/**
 * A GitRunner that answers by command shape, so every test states the exact git conversation the
 * runtime holds and a command nobody scripted is a failure, not a silent default.
 */
function fakeGit(calls: readonly ScriptedCall[]): FakeGit {
  const seen: (readonly string[])[] = [];
  return {
    calls: seen,
    git: {
      async run(input: GitCommandInput): Promise<GitResult> {
        seen.push([...input.args]);
        const match = calls.find(
          (call) =>
            call.args.length === input.args.length &&
            call.args.every((arg, index) => arg === input.args[index]),
        );
        if (match === undefined) throw new Error(`unexpected git ${input.args.join(' ')}`);
        return {
          code: match.code ?? 0,
          stdout: match.stdout ?? '',
          stderr: match.stderr ?? '',
        };
      },
    },
  };
}

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function makeContext(): DaemonContext {
  const directory = mkdtempSync(join(tmpdir(), 'cb-79-design-service-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
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

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return null;
}

describe('createDesignRuntime', () => {
  it('resolves the default branch head and reads the three document kinds', async () => {
    const fake = fakeGit([
      { args: ['rev-parse', 'refs/heads/main'], stdout: `${FULL}\n` },
      { args: ['show', `${FULL}:design/tokens.json`], stdout: TOKENS },
      { args: ['show', `${FULL}:design/routes.json`], stdout: ROUTES },
      {
        args: ['ls-tree', '--name-only', '-r', FULL, '--', 'design/screens'],
        stdout: 'design/screens/notes.txt\ndesign/screens/repo-backlog.json\n',
      },
      { args: ['show', `${FULL}:design/screens/repo-backlog.json`], stdout: SCREEN },
    ]);
    const runtime = createDesignRuntime({ git: fake.git, repoRoot: REPO_ROOT, timeoutMs: 5_000 });

    const snapshot = await runtime.readDesign(REPO, null);

    expect(snapshot.revision).toBe(FULL);
    expect(snapshot.source.tokens).toBe(TOKENS);
    expect(snapshot.source.routes).toBe(ROUTES);
    expect(snapshot.source.screens).toEqual([
      { file: 'design/screens/repo-backlog.json', text: SCREEN },
    ]);
    expect(fake.calls[0]).toEqual(['rev-parse', 'refs/heads/main']);
  });

  it('resolves a short revision to its commit and reads at the resolved sha', async () => {
    const fake = fakeGit([
      { args: ['rev-parse', '--verify', `${SHORT}^{commit}`], stdout: `${FULL}\n` },
      { args: ['show', `${FULL}:design/tokens.json`], stdout: TOKENS },
      {
        args: ['show', `${FULL}:design/routes.json`],
        code: 128,
        stderr: `fatal: path 'design/routes.json' does not exist in '${FULL}'`,
      },
      { args: ['ls-tree', '--name-only', '-r', FULL, '--', 'design/screens'], stdout: '' },
    ]);
    const runtime = createDesignRuntime({ git: fake.git, repoRoot: REPO_ROOT, timeoutMs: 5_000 });

    const snapshot = await runtime.readDesign(REPO, SHORT);

    expect(snapshot.revision).toBe(FULL);
    expect(snapshot.source.routes).toBeNull();
    expect(snapshot.source.screens).toEqual([]);
    expect(fake.calls).toContainEqual(['rev-parse', '--verify', `${SHORT}^{commit}`]);
    expect(fake.calls).toContainEqual(['show', `${FULL}:design/tokens.json`]);
  });

  it('names the revision the clone does not know', async () => {
    const fake = fakeGit([
      {
        args: ['rev-parse', '--verify', `${SHORT}^{commit}`],
        code: 128,
        stderr: 'fatal: bad revision',
      },
    ]);
    const runtime = createDesignRuntime({ git: fake.git, repoRoot: REPO_ROOT, timeoutMs: 5_000 });

    const error = await failure(runtime.readDesign(REPO, SHORT));

    expect(error).toBeInstanceOf(DesignRevisionError);
    expect((error as DesignRevisionError).revision).toBe(SHORT);
    expect((error as DesignRevisionError).name).toBe('DesignRevisionError');
  });

  it('turns an absent path into null for show and into no screens for ls-tree', async () => {
    const fake = fakeGit([
      { args: ['rev-parse', 'refs/heads/main'], stdout: `${FULL}\n` },
      {
        args: ['show', `${FULL}:design/tokens.json`],
        code: 128,
        stderr: "fatal: path 'design/tokens.json' does not exist in 'HEAD'",
      },
      {
        args: ['show', `${FULL}:design/routes.json`],
        code: 128,
        stderr: "fatal: path 'design/routes.json' exists on disk, but not in 'HEAD'",
      },
      {
        args: ['ls-tree', '--name-only', '-r', FULL, '--', 'design/screens'],
        code: 128,
        stderr: "fatal: path 'design/screens' does not exist in 'HEAD'",
      },
    ]);
    const runtime = createDesignRuntime({ git: fake.git, repoRoot: REPO_ROOT, timeoutMs: 5_000 });

    const snapshot = await runtime.readDesign(REPO, null);

    expect(snapshot.source).toEqual({ tokens: null, routes: null, screens: [] });
  });

  it('skips a screen file whose show says it does not exist', async () => {
    const fake = fakeGit([
      { args: ['rev-parse', 'refs/heads/main'], stdout: `${FULL}\n` },
      { args: ['show', `${FULL}:design/tokens.json`], stdout: TOKENS },
      { args: ['show', `${FULL}:design/routes.json`], stdout: ROUTES },
      {
        args: ['ls-tree', '--name-only', '-r', FULL, '--', 'design/screens'],
        stdout: 'design/screens/a.json\ndesign/screens/b.json\n',
      },
      {
        args: ['show', `${FULL}:design/screens/a.json`],
        code: 128,
        stderr: "fatal: path 'design/screens/a.json' does not exist in 'HEAD'",
      },
      { args: ['show', `${FULL}:design/screens/b.json`], stdout: SCREEN },
    ]);
    const runtime = createDesignRuntime({ git: fake.git, repoRoot: REPO_ROOT, timeoutMs: 5_000 });

    const snapshot = await runtime.readDesign(REPO, null);

    expect(snapshot.source.screens.map((screen) => screen.file)).toEqual(['design/screens/b.json']);
  });

  it('maps every other git failure to DesignReadError with its command and code', async () => {
    const showFailure = fakeGit([
      { args: ['rev-parse', 'refs/heads/main'], stdout: `${FULL}\n` },
      { args: ['show', `${FULL}:design/tokens.json`], code: 128, stderr: 'fatal: bad object' },
    ]);
    const showRuntime = createDesignRuntime({
      git: showFailure.git,
      repoRoot: REPO_ROOT,
      timeoutMs: 5_000,
    });
    const shown = await failure(showRuntime.readDesign(REPO, null));
    expect(shown).toBeInstanceOf(DesignReadError);
    expect((shown as DesignReadError).command).toBe('show');
    expect((shown as DesignReadError).code).toBe(128);
    expect((shown as DesignReadError).name).toBe('DesignReadError');

    const treeFailure = fakeGit([
      { args: ['rev-parse', 'refs/heads/main'], stdout: `${FULL}\n` },
      { args: ['show', `${FULL}:design/tokens.json`], stdout: TOKENS },
      { args: ['show', `${FULL}:design/routes.json`], stdout: ROUTES },
      {
        args: ['ls-tree', '--name-only', '-r', FULL, '--', 'design/screens'],
        code: 129,
        stderr: 'error: bad usage',
      },
    ]);
    const treeRuntime = createDesignRuntime({
      git: treeFailure.git,
      repoRoot: REPO_ROOT,
      timeoutMs: 5_000,
    });
    const listed = await failure(treeRuntime.readDesign(REPO, null));
    expect(listed).toBeInstanceOf(DesignReadError);
    expect((listed as DesignReadError).command).toBe('ls-tree');
    expect((listed as DesignReadError).code).toBe(129);
  });

  it('maps an unusable default branch to rev-parse, an empty answer included', async () => {
    const failing = fakeGit([
      { args: ['rev-parse', 'refs/heads/main'], code: 128, stderr: 'fatal: bad ref' },
    ]);
    const runtime = createDesignRuntime({
      git: failing.git,
      repoRoot: REPO_ROOT,
      timeoutMs: 5_000,
    });
    const error = await failure(runtime.readDesign(REPO, null));
    expect(error).toBeInstanceOf(DesignReadError);
    expect((error as DesignReadError).command).toBe('rev-parse');
    expect((error as DesignReadError).code).toBe(128);

    const empty = fakeGit([{ args: ['rev-parse', 'refs/heads/main'], stdout: '\n' }]);
    const emptyRuntime = createDesignRuntime({
      git: empty.git,
      repoRoot: REPO_ROOT,
      timeoutMs: 5_000,
    });
    const missing = await failure(emptyRuntime.readDesign(REPO, null));
    expect(missing).toBeInstanceOf(DesignReadError);
    expect((missing as DesignReadError).command).toBe('rev-parse');
    expect((missing as DesignReadError).code).toBe(0);
  });

  it('maps a failed clone refresh to a fetch failure before any read', async () => {
    const fake = fakeGit([]);
    const runtime = createDesignRuntime({
      git: fake.git,
      repoRoot: REPO_ROOT,
      timeoutMs: 5_000,
      ensureClone: async () => {
        throw new Error('clone failed');
      },
    });

    const error = await failure(runtime.readDesign(REPO, null));

    expect(error).toBeInstanceOf(DesignReadError);
    expect((error as DesignReadError).command).toBe('fetch');
    expect((error as DesignReadError).code).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it('refreshes the clone before reading when ensureClone is given', async () => {
    const order: string[] = [];
    const fake = fakeGit([
      { args: ['rev-parse', 'refs/heads/main'], stdout: `${FULL}\n` },
      { args: ['show', `${FULL}:design/tokens.json`], stdout: TOKENS },
      { args: ['show', `${FULL}:design/routes.json`], stdout: ROUTES },
      { args: ['ls-tree', '--name-only', '-r', FULL, '--', 'design/screens'], stdout: '' },
    ]);
    const runtime = createDesignRuntime({
      git: fake.git,
      repoRoot: REPO_ROOT,
      timeoutMs: 5_000,
      ensureClone: async (repo: Repo) => {
        order.push(`clone:${repo.slug}:${fake.calls.length}`);
      },
    });

    await runtime.readDesign(REPO, null);

    expect(order).toEqual(['clone:acme/widgets:0']);
    expect(fake.calls.length).toBeGreaterThan(0);
  });
});

describe('createDesignService', () => {
  const SNAPSHOT: DesignSnapshot = {
    revision: FULL,
    source: {
      tokens: TOKENS,
      routes: ROUTES,
      screens: [{ file: 'design/screens/a.json', text: SCREEN }],
    },
  };

  function runtimeOf(): { runtime: DesignRuntime; seen: (string | null)[] } {
    const seen: (string | null)[] = [];
    return {
      seen,
      runtime: {
        async readDesign(_repo: Repo, requested: string | null): Promise<DesignSnapshot> {
          seen.push(requested);
          return { revision: SNAPSHOT.revision, source: SNAPSHOT.source };
        },
      },
    };
  }

  it('projects the runtime snapshot with the injected clock', async () => {
    const context = makeContext();
    const stub = runtimeOf();
    const service = createDesignService({ context, runtime: stub.runtime });

    const preview = await service.preview(REPO, SHORT);

    expect(stub.seen).toEqual([SHORT]);
    expect(preview.repoId).toBe(REPO.id);
    expect(preview.revision).toBe(FULL);
    expect(preview.checkedAt).toBe(NOW);
    expect(preview.present).toBe(true);
    expect(preview.screens).toHaveLength(1);
  });

  it('writes nothing and shares one service per context', () => {
    const context = makeContext();
    const first = designService(context);
    const second = designService(context);
    expect(second).toBe(first);
    expect(createDesignService({ context, runtime: runtimeOf().runtime })).not.toBe(first);
    expect(context.store.works.list({ limit: 10, cursor: null }).data).toEqual([]);
  });
});
