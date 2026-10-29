import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Repo } from '@codebox/contracts';
import { parseBacklog as parseBacklogMarkdown } from '@codebox/backlog';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { BacklogMissingError, BacklogRefError, createBacklogService } from './service.js';
import type { BacklogRuntime, BacklogService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-25T10:05:00.000Z';
const REVISION = '9f1c2ab';
const FIXTURE = readFileSync(
  new URL('../../../../packages/backlog/src/fixtures/todo.md', import.meta.url),
  'utf8',
);

const REPO: Repo = {
  id: 'repo_bl01',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'manual',
  protectedPaths: [],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const directories: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function contextFor(store: Store): DaemonContext {
  const config = loadConfig({ CB_ENV: 'test', CB_SESSION_SECRET: SESSION_SECRET });
  const logger = createLogger({ level: 'error', sink: () => undefined });
  return {
    config,
    store,
    logger,
    clock: () => new Date(NOW),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: '/nonexistent/app',
    shutdown: createShutdownRegistry(logger),
  };
}

function harness(markdown: string): {
  readonly context: DaemonContext;
  readonly store: Store;
  readonly service: BacklogService;
} {
  const store = openInMemoryStore();
  stores.push(store);
  store.repos.create(REPO);
  const context = contextFor(store);
  const runtime: BacklogRuntime = {
    readSnapshot: async () => ({ markdown, revision: REVISION }),
  };
  return { context, store, service: createBacklogService({ context, runtime }) };
}

describe('project', () => {
  it('projects the real TODO.md with the sections and items parseBacklog reports', async () => {
    const { service } = harness(FIXTURE);
    const project = await service.project(REPO);
    const parsed = parseBacklogMarkdown(FIXTURE);
    expect(project).not.toBeNull();
    if (project === null) return;
    expect(project.repoId).toBe(REPO.id);
    expect(project.path).toBe('TODO.md');
    expect(project.revision).toBe(REVISION);
    expect(project.sections).toHaveLength(parsed.sections.length);
    // `backlogSectionSchema.title` needs a heading, so an item above the first `## ` has no
    // section to be grouped in and is not part of the API object.
    expect(project.sections.flatMap((section) => section.items)).toHaveLength(
      parsed.sections.flatMap((section) => section.items).length,
    );
    expect(parsed.items.length).toBeGreaterThan(
      parsed.sections.flatMap((section) => section.items).length,
    );
    expect(project.sections.map((section) => section.title)).toEqual(
      parsed.sections.map((section) => section.title),
    );
    const first = project.sections.flatMap((section) => section.items)[0];
    expect(first).toMatchObject({ ref: 'Task-01', checked: true, work: null });
    expect(first?.line).toBeGreaterThan(0);
  });

  it('projects the dependency sentence of each item, and a root carries none', async () => {
    const markdown = [
      '## Batch',
      '',
      '- [x] **[Task-01]** Root.',
      '      *Dependencies:* none.',
      '- [ ] **[Task-02]** Child.',
      '      *Dependencies:* Task-01.',
    ].join('\n');
    const { service } = harness(markdown);

    const project = await service.project(REPO);
    const items = project?.sections.flatMap((section) => section.items) ?? [];
    expect(items.find((item) => item.ref === 'Task-02')?.needs).toEqual(['Task-01']);
    expect(items.find((item) => item.ref === 'Task-01')?.needs).toEqual([]);
  });

  it('joins a work and its run count onto the item it came from', async () => {
    const { service, store } = harness(FIXTURE);
    const at = NOW;
    store.works.create({
      id: 'wrk_bl01',
      repoId: REPO.id,
      backlogRef: 'Task-01',
      title: 'Done item.',
      prompt: 'Done item.',
      specSha: REVISION,
      state: 'merged',
      origin: 'backlog',
      attempts: 1,
      maxAttempts: 2,
      usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
      contextTokens: 0,
      contextEpoch: 1,
      reviewedAt: null,
      createdAt: at,
      updatedAt: at,
    });
    for (const [index, id] of ['run_bl001', 'run_bl002'].entries()) {
      store.runs.create({
        id,
        repoId: REPO.id,
        jobId: null,
        workId: 'wrk_bl01',
        state: 'succeeded',
        trigger: 'manual',
        branch: `cb/${id}-done`,
        baseRef: 'main',
        pr: null,
        gate: null,
        guardrails: [],
        blockers: [],
        diff: null,
        cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        finishedAt: null,
        baseSha: null,
        worktree: null,
        sessionId: null,
        prompt: 'done',
        promptHash: null,
        agent: 'build',
        model: null,
        gateCommand: null,
        scheduledFor: null,
        attempt: 1,
        failureCode: null,
        failureMessage: null,
        startedAt: null,
      });
    }

    const project = await service.project(REPO);
    const item = project?.sections
      .flatMap((section) => section.items)
      .find((entry) => entry.ref === 'Task-01');
    expect(item?.work).toEqual({ id: 'wrk_bl01', state: 'merged', runs: 2 });
  });

  it('answers an empty projection with the default-branch sha when TODO.md is absent', async () => {
    const store = openInMemoryStore();
    stores.push(store);
    store.repos.create(REPO);
    const context = contextFor(store);
    const service = createBacklogService({
      context,
      runtime: {
        readSnapshot: async () => {
          throw new BacklogMissingError(REVISION);
        },
      },
    });

    await expect(service.read(REPO)).resolves.toBeNull();
    await expect(service.project(REPO)).resolves.toEqual({
      repoId: REPO.id,
      revision: REVISION,
      path: 'TODO.md',
      sections: [],
    });
  });
});

describe('resolveItem', () => {
  function reasonOf(run: () => Promise<unknown>): Promise<string> {
    return run().then(
      () => Promise.reject(new Error('the call should have thrown')),
      (error: unknown) => (error instanceof BacklogRefError ? error.reason : Promise.reject(error)),
    );
  }

  it('resolves an unchecked item with the revision it was read at', async () => {
    const { service } = harness(FIXTURE);
    const resolved = await service.resolveItem(REPO, 'Task-02');
    expect(resolved.revision).toBe(REVISION);
    expect(resolved.item.ref).toBe('Task-02');
    expect(resolved.item.body).toContain('Body line one.');
  });

  it('names the three refusals', async () => {
    const { service } = harness(FIXTURE);
    await expect(reasonOf(() => service.resolveItem(REPO, 'Task-99'))).resolves.toBe(
      'backlog_ref_missing',
    );
    await expect(reasonOf(() => service.resolveItem(REPO, 'Task-05'))).resolves.toBe(
      'backlog_ref_ambiguous',
    );
    await expect(reasonOf(() => service.resolveItem(REPO, 'Task-01'))).resolves.toBe(
      'backlog_ref_checked',
    );
  });
});

describe('tick', () => {
  function worktreeWith(markdown: string): string {
    const directory = mkdtempSync(join(tmpdir(), 'cb-72-tick-'));
    directories.push(directory);
    writeFileSync(join(directory, 'TODO.md'), markdown, 'utf8');
    return directory;
  }

  it('flips exactly one checkbox and leaves every other byte alone', async () => {
    const { service } = harness(FIXTURE);
    const worktree = worktreeWith(FIXTURE);
    const outcome = await service.tick(worktree, 'Task-02');
    expect(outcome.kind).toBe('ticked');
    const written = readFileSync(join(worktree, 'TODO.md'), 'utf8');
    const before = FIXTURE.split('\n');
    const after = written.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after
      .map((line, index) => (line === before[index] ? null : index))
      .filter((index): index is number => index !== null);
    expect(changed).toHaveLength(1);
    expect(after[changed[0] ?? 0]).toBe((before[changed[0] ?? 0] ?? '').replace('- [ ]', '- [x]'));
  });

  it('changes nothing on disk for a missing or an ambiguous ref', async () => {
    const { service } = harness(FIXTURE);
    const worktree = worktreeWith(FIXTURE);
    await expect(service.tick(worktree, 'Task-99')).resolves.toEqual({ kind: 'missing' });
    expect(readFileSync(join(worktree, 'TODO.md'), 'utf8')).toBe(FIXTURE);
    const ambiguous = await service.tick(worktree, 'Task-05');
    expect(ambiguous.kind).toBe('ambiguous');
    expect(readFileSync(join(worktree, 'TODO.md'), 'utf8')).toBe(FIXTURE);
  });

  it('reports a worktree without TODO.md as missing', async () => {
    const { service } = harness(FIXTURE);
    const directory = mkdtempSync(join(tmpdir(), 'cb-72-tick-empty-'));
    directories.push(directory);
    await expect(service.tick(directory, 'Task-02')).resolves.toEqual({ kind: 'missing' });
  });
});
