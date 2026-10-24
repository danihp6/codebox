import type { Approval, ChatMessage, ChatSession, Device, Job, Repo } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from './errors.js';
import { toChatSession } from './chats.js';
import type { DeviceRecord } from './devices.js';
import type { RunRecord } from './runs.js';
import { openInMemoryStore, type Store } from './store.js';

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'octo/hello',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**', 'ops/**'],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const OTHER_REPO: Repo = {
  ...REPO,
  id: 'repo_000002',
  slug: 'octo/other',
  createdAt: '2026-01-02T00:00:00.000Z',
};

function job(id: string, repoId: string, createdAt: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    repoId,
    title: 'Nightly lockfile',
    prompt: 'update the lockfile and run the gate',
    mode: 'work',
    agent: 'build',
    model: null,
    cron: '0 1 * * *',
    timezone: 'UTC',
    enabled: true,
    policy: 'auto',
    createdAt,
    nextFireAt: null,
    ...overrides,
  };
}

function runRecord(
  id: string,
  repoId: string,
  createdAt: string,
  overrides: Partial<RunRecord> = {},
): RunRecord {
  return {
    id,
    repoId,
    jobId: null,
    state: 'queued',
    trigger: 'manual',
    branch: `cb/${id}-work`,
    baseRef: 'main',
    pr: null,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    createdAt,
    finishedAt: null,
    baseSha: null,
    worktree: null,
    sessionId: null,
    prompt: 'do the work',
    promptHash: null,
    agent: 'build',
    model: null,
    gateCommand: null,
    scheduledFor: null,
    attempt: 1,
    failureCode: null,
    failureMessage: null,
    startedAt: null,
    ...overrides,
  };
}

function approval(id: string, createdAt: string, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    state: 'pending',
    tool: 'bash',
    title: 'Run the gate',
    runId: null,
    chatId: 'chat_000001',
    input: { command: 'npm test' },
    createdAt,
    expiresAt: '2026-01-01T00:10:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function chatSession(
  id: string,
  updatedAt: string,
  overrides: Partial<ChatSession> = {},
): ChatSession {
  return {
    id,
    repoId: REPO.id,
    title: 'Chat',
    status: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    lastMessage: null,
    ...overrides,
  };
}

function message(id: string, chatId: string, createdAt: string): ChatMessage {
  return { id, chatId, role: 'user', text: `message ${id}`, createdAt };
}

function deviceRecord(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: 'dev_000001',
    name: 'Pixel',
    platform: 'android',
    scopes: ['read', 'runs'],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: null,
    publicKey: null,
    fingerprint: null,
    refreshTokenHash: 'hash-current',
    refreshPreviousHash: null,
    refreshExpiresAt: '2026-02-01T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

function storeErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error.code : 'unexpected-error';
  }
  return 'no-error';
}

let store: Store;

beforeEach(() => {
  store = openInMemoryStore();
  store.repos.create(REPO);
  store.repos.create(OTHER_REPO);
  store.chats.createSession(chatSession('chat_000001', '2026-01-01T00:00:00.000Z'), {
    opencodeSessionId: null,
    worktree: null,
  });
});

afterEach(() => {
  store.close();
});

describe('repos', () => {
  it('a deleted repo refuses to orphan a live run', () => {
    const live = store.runs.create(
      runRecord('run_0000001', REPO.id, '2026-01-01T00:00:00.000Z', { state: 'running' }),
    );
    expect(storeErrorCode(() => store.repos.delete(REPO.id))).toBe('repo_has_live_run');

    expect(
      storeErrorCode(() =>
        store.runs.create(runRecord('run_0000002', 'repo_000404', '2026-01-01T00:00:00.000Z')),
      ),
    ).toBe('foreign_key_violation');

    store.runs.update(live.id, { state: 'succeeded', finishedAt: '2026-01-01T01:00:00.000Z' });
    expect(storeErrorCode(() => store.repos.delete(REPO.id))).toBe('foreign_key_violation');
    expect(store.repos.get(REPO.id)).not.toBeNull();

    expect(() => store.repos.delete(OTHER_REPO.id)).not.toThrow();
    expect(store.repos.get(OTHER_REPO.id)).toBeNull();
    expect(storeErrorCode(() => store.repos.delete(OTHER_REPO.id))).toBe('not_found');
  });

  it('reads, updates and pages repositories', () => {
    expect(store.repos.get(REPO.id)).toEqual(REPO);
    expect(store.repos.getBySlug(REPO.slug)).toEqual(REPO);
    expect(store.repos.getBySlug('octo/missing')).toBeNull();
    expect(store.repos.list().map((repo) => repo.id)).toEqual([OTHER_REPO.id, REPO.id]);

    const updated = store.repos.update(REPO.id, {
      gate: 'npm run gate',
      policy: 'manual',
      protectedPaths: ['infra/**'],
      enabled: false,
    });
    expect(updated.gate).toBe('npm run gate');
    expect(updated.policy).toBe('manual');
    expect(updated.protectedPaths).toEqual(['infra/**']);
    expect(updated.enabled).toBe(false);
    expect(store.repos.getBySlug(REPO.slug)?.enabled).toBe(false);

    expect(storeErrorCode(() => store.repos.update('repo_000404', { gate: 'x' }))).toBe(
      'not_found',
    );
    expect(storeErrorCode(() => store.repos.create({ ...OTHER_REPO, id: 'repo_000003' }))).toBe(
      'unique_violation',
    );
  });
});

describe('jobs', () => {
  it('filters, patches and pages jobs', () => {
    store.jobs.create(job('job_0000001', REPO.id, '2026-01-01T00:00:00.000Z'));
    store.jobs.create(job('job_0000002', REPO.id, '2026-01-02T00:00:00.000Z', { enabled: false }));
    store.jobs.create(job('job_0000003', OTHER_REPO.id, '2026-01-03T00:00:00.000Z'));

    expect(store.jobs.get('job_0000001')).toEqual(
      job('job_0000001', REPO.id, '2026-01-01T00:00:00.000Z'),
    );
    expect(store.jobs.list({ repoId: REPO.id, limit: 10, cursor: null }).data).toHaveLength(2);
    expect(
      store.jobs
        .list({ repoId: REPO.id, enabled: true, limit: 10, cursor: null })
        .data.map((entry) => entry.id),
    ).toEqual(['job_0000001']);

    const first = store.jobs.list({ limit: 2, cursor: null });
    expect(first.data.map((entry) => entry.id)).toEqual(['job_0000003', 'job_0000002']);
    expect(first.nextCursor).not.toBeNull();
    const second = store.jobs.list({ limit: 2, cursor: first.nextCursor });
    expect(second.data.map((entry) => entry.id)).toEqual(['job_0000001']);
    expect(second.nextCursor).toBeNull();

    const patched = store.jobs.update('job_0000002', {
      title: 'Renamed',
      model: 'opencode-go/deepseek-v4.1-flash',
      maxCostUsd: 2.5,
      nextFireAt: '2026-01-04T01:00:00.000Z',
      enabled: true,
    });
    expect(patched.title).toBe('Renamed');
    expect(patched.model).toBe('opencode-go/deepseek-v4.1-flash');
    expect(patched.enabled).toBe(true);
    expect(patched.nextFireAt).toBe('2026-01-04T01:00:00.000Z');
    expect(Object.keys(patched)).not.toContain('maxCostUsd');

    store.jobs.setNextFire('job_0000001', '2026-01-05T01:00:00.000Z');
    expect(store.jobs.get('job_0000001')?.nextFireAt).toBe('2026-01-05T01:00:00.000Z');
    store.jobs.setNextFire('job_0000001', null);
    expect(store.jobs.get('job_0000001')?.nextFireAt).toBeNull();

    expect(storeErrorCode(() => store.jobs.update('job_0000404', { title: 'x' }))).toBe(
      'not_found',
    );
    expect(storeErrorCode(() => store.jobs.setNextFire('job_0000404', null))).toBe('not_found');
    expect(
      storeErrorCode(() =>
        store.jobs.create(job('job_0000004', 'repo_000404', '2026-01-04T00:00:00.000Z')),
      ),
    ).toBe('foreign_key_violation');
  });

  it('selects due jobs in order and keeps runs when a job is deleted', () => {
    store.jobs.create(
      job('job_0000001', REPO.id, '2026-01-01T00:00:00.000Z', {
        nextFireAt: '2026-01-02T01:00:00.000Z',
      }),
    );
    store.jobs.create(
      job('job_0000002', REPO.id, '2026-01-02T00:00:00.000Z', {
        nextFireAt: '2026-01-03T01:00:00.000Z',
      }),
    );
    store.jobs.create(
      job('job_0000003', REPO.id, '2026-01-03T00:00:00.000Z', {
        enabled: false,
        nextFireAt: '2026-01-02T00:00:00.000Z',
      }),
    );
    store.jobs.create(job('job_0000004', REPO.id, '2026-01-04T00:00:00.000Z'));

    expect(store.jobs.listDue('2026-01-03T01:00:00.000Z', 10).map((entry) => entry.id)).toEqual([
      'job_0000001',
      'job_0000002',
    ]);
    expect(store.jobs.listDue('2025-12-31T00:00:00.000Z', 10)).toEqual([]);
    expect(store.jobs.listDue('2026-01-03T01:00:00.000Z', 1)).toHaveLength(1);

    store.runs.create(
      runRecord('run_0000001', REPO.id, '2026-01-01T00:00:00.000Z', {
        jobId: 'job_0000001',
      }),
    );
    store.jobs.delete('job_0000001');
    expect(store.runs.get('run_0000001')?.jobId).toBeNull();
    expect(storeErrorCode(() => store.jobs.delete('job_0000001'))).toBe('not_found');
    expect(store.jobs.get('job_0000001')).toBeNull();
  });
});

describe('approvals', () => {
  it('lists pending approvals oldest first and resolves once', () => {
    store.approvals.create(approval('apv_0000001', '2026-01-02T00:00:00.000Z'));
    store.approvals.create(approval('apv_0000002', '2026-01-01T00:00:00.000Z'));
    store.approvals.create(
      approval('apv_0000003', '2026-01-03T00:00:00.000Z', { state: 'allowed' }),
    );

    expect(store.approvals.listPending(10).map((entry) => entry.id)).toEqual([
      'apv_0000002',
      'apv_0000001',
    ]);
    expect(store.approvals.get('apv_0000001')).toEqual(
      approval('apv_0000001', '2026-01-02T00:00:00.000Z'),
    );

    const first = store.approvals.list('pending', { limit: 1, cursor: null });
    expect(first.data.map((entry) => entry.id)).toEqual(['apv_0000002']);
    expect(first.nextCursor).not.toBeNull();
    const second = store.approvals.list('pending', { limit: 1, cursor: first.nextCursor });
    expect(second.data.map((entry) => entry.id)).toEqual(['apv_0000001']);
    expect(second.nextCursor).toBeNull();

    const resolved = store.approvals.resolve({
      id: 'apv_0000001',
      state: 'allowed',
      resolvedAt: '2026-01-02T00:05:00.000Z',
    });
    expect(resolved.state).toBe('allowed');
    expect(resolved.resolvedAt).toBe('2026-01-02T00:05:00.000Z');
    const again = store.approvals.resolve({
      id: 'apv_0000001',
      state: 'denied',
      resolvedAt: '2026-01-02T00:06:00.000Z',
    });
    expect(again.state).toBe('allowed');
    expect(again.resolvedAt).toBe('2026-01-02T00:05:00.000Z');

    expect(
      storeErrorCode(() =>
        store.approvals.resolve({
          id: 'apv_0000404',
          state: 'expired',
          resolvedAt: '2026-01-02T00:06:00.000Z',
        }),
      ),
    ).toBe('not_found');
  });
});

describe('chats', () => {
  it('orders sessions by recency and messages oldest first', () => {
    const created = store.chats.createSession(
      chatSession('chat_000002', '2026-01-02T00:00:00.000Z', {
        repoId: OTHER_REPO.id,
        title: 'Second',
        status: 'working',
      }),
      { opencodeSessionId: 'ses_1', worktree: '/srv/codebox/worktrees/run_0000001' },
    );
    expect(created.title).toBe('Second');
    expect(created.lastMessage).toBeNull();

    expect(
      store.chats.listSessions({ limit: 10, cursor: null }).data.map((entry) => entry.id),
    ).toEqual(['chat_000002', 'chat_000001']);
    expect(
      store.chats
        .listSessions({ repoId: REPO.id, limit: 10, cursor: null })
        .data.map((entry) => entry.id),
    ).toEqual(['chat_000001']);

    store.chats.appendMessage(
      {
        id: 'msg_000001',
        chatId: 'chat_000001',
        role: 'user',
        text: 'hi',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      { origin: 'user' },
    );
    store.chats.appendMessage(
      {
        id: 'msg_000002',
        chatId: 'chat_000001',
        role: 'assistant',
        text: 'hello',
        createdAt: '2026-01-01T00:00:02.000Z',
      },
      { origin: 'routine' },
    );
    store.chats.appendMessage(message('msg_000003', 'chat_000001', '2026-01-01T00:00:03.000Z'), {
      origin: 'user',
    });

    const appended = store.chats.appendMessage(
      {
        id: 'msg_000004',
        chatId: 'chat_000001',
        role: 'system',
        text: 'note',
        createdAt: '2026-01-01T00:00:04.000Z',
      },
      { origin: 'routine' },
    );
    expect(Object.keys(appended).sort()).toEqual(['chatId', 'createdAt', 'id', 'role', 'text']);
    expect(store.chats.lastMessage('chat_000001')?.id).toBe('msg_000004');

    const first = store.chats.listMessages('chat_000001', { limit: 2, cursor: null });
    expect(first.data.map((entry) => entry.id)).toEqual(['msg_000001', 'msg_000002']);
    expect(first.nextCursor).not.toBeNull();
    const second = store.chats.listMessages('chat_000001', { limit: 2, cursor: first.nextCursor });
    expect(second.data.map((entry) => entry.id)).toEqual(['msg_000003', 'msg_000004']);
    expect(second.nextCursor).toBeNull();

    const updated = store.chats.updateSession('chat_000001', {
      title: 'Renamed',
      status: 'archived',
      opencodeSessionId: 'ses_2',
      worktree: null,
      updatedAt: '2026-01-05T00:00:00.000Z',
    });
    expect(updated.title).toBe('Renamed');
    expect(updated.status).toBe('archived');
    expect(updated.updatedAt).toBe('2026-01-05T00:00:00.000Z');
    expect(updated.lastMessage?.id).toBe('msg_000004');
    expect(toChatSession({ ...updated, lastMessage: null }, updated.lastMessage)).toEqual(updated);

    expect(store.chats.getSession('chat_000404')).toBeNull();
    expect(store.chats.lastMessage('chat_000404')).toBeNull();
    expect(
      storeErrorCode(() =>
        store.chats.updateSession('chat_000404', { updatedAt: '2026-01-05T00:00:00.000Z' }),
      ),
    ).toBe('not_found');
    expect(
      storeErrorCode(() =>
        store.chats.createSession(
          chatSession('chat_000003', '2026-01-03T00:00:00.000Z', { repoId: 'repo_000404' }),
          { opencodeSessionId: null, worktree: null },
        ),
      ),
    ).toBe('foreign_key_violation');
  });
});

describe('devices', () => {
  it('matches the previous refresh hash and revokes without deleting', () => {
    const created = store.devices.create(deviceRecord());
    expect(created.refreshTokenHash).toBe('hash-current');
    const device: Device | null = store.devices.get(created.id);
    expect(device).toEqual({
      id: 'dev_000001',
      name: 'Pixel',
      platform: 'android',
      scopes: ['read', 'runs'],
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: null,
    });
    expect(Object.keys(device ?? {})).not.toContain('refreshTokenHash');
    expect(store.devices.getByRefreshHash('nope')).toBeNull();

    store.devices.rotateRefresh(created.id, {
      refreshTokenHash: 'hash-next',
      refreshPreviousHash: 'hash-current',
      refreshExpiresAt: '2026-03-01T00:00:00.000Z',
    });
    expect(store.devices.getByRefreshHash('hash-next')?.id).toBe('dev_000001');
    expect(store.devices.getByRefreshHash('hash-current')?.id).toBe('dev_000001');

    store.devices.touch(created.id, '2026-01-06T00:00:00.000Z');
    expect(store.devices.getRecord(created.id)?.lastSeenAt).toBe('2026-01-06T00:00:00.000Z');

    store.devices.revoke(created.id, '2026-01-07T00:00:00.000Z');
    store.devices.revoke(created.id, '2026-01-08T00:00:00.000Z');
    expect(store.devices.getRecord(created.id)?.revokedAt).toBe('2026-01-07T00:00:00.000Z');
    expect(store.devices.get(created.id)).not.toBeNull();

    const page = store.devices.list({ limit: 1, cursor: null });
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).toBeNull();

    store.devices.create(deviceRecord({ id: 'dev_000002', refreshTokenHash: 'hash-other' }));
    expect(store.devices.list({ limit: 10, cursor: null }).data).toHaveLength(2);
    expect(
      storeErrorCode(() =>
        store.devices.create(deviceRecord({ id: 'dev_000003', refreshTokenHash: 'hash-other' })),
      ),
    ).toBe('unique_violation');
    expect(
      storeErrorCode(() =>
        store.devices.rotateRefresh('dev_000404', {
          refreshTokenHash: 'hash-x',
          refreshPreviousHash: 'hash-y',
          refreshExpiresAt: '2026-03-01T00:00:00.000Z',
        }),
      ),
    ).toBe('not_found');
  });
});

describe('settings', () => {
  it('stores JSON values per key and returns undefined when missing', () => {
    store.settings.set('automerge', true, '2026-01-01T00:00:00.000Z');
    store.settings.set('quietHours', null, '2026-01-01T00:00:00.000Z');
    store.settings.set('protectedPaths', ['.github/**'], '2026-01-01T00:00:00.000Z');
    expect(store.settings.get('automerge')).toBe(true);
    expect(store.settings.get('quietHours')).toBeNull();
    expect(store.settings.get('protectedPaths')).toEqual(['.github/**']);
    expect(store.settings.get('missing')).toBeUndefined();
    expect(store.settings.getAll()).toEqual({
      automerge: true,
      protectedPaths: ['.github/**'],
      quietHours: null,
    });

    store.settings.set('automerge', false, '2026-01-02T00:00:00.000Z');
    expect(store.settings.get('automerge')).toBe(false);
    expect(
      store.db.prepare("SELECT updated_at FROM settings WHERE key = 'automerge'").get()?.[
        'updated_at'
      ],
    ).toBe('2026-01-02T00:00:00.000Z');

    store.settings.delete('automerge');
    expect(store.settings.get('automerge')).toBeUndefined();
    expect(() => store.settings.delete('automerge')).not.toThrow();
  });
});

describe('usage', () => {
  it('sums the day and aggregates per day and repo', () => {
    store.runs.create(runRecord('run_0000001', REPO.id, '2026-01-01T00:00:00.000Z'));
    store.usage.record({
      runId: 'run_0000001',
      repoId: REPO.id,
      day: '2026-01-02',
      model: 'm',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.5,
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    store.usage.record({
      runId: null,
      repoId: null,
      day: '2026-01-02',
      model: null,
      tokensIn: 3,
      tokensOut: 2,
      costUsd: 0.25,
      createdAt: '2026-01-02T01:00:00.000Z',
    });
    const last = store.usage.record({
      runId: 'run_0000001',
      repoId: REPO.id,
      day: '2026-01-03',
      model: 'm',
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0.1,
      createdAt: '2026-01-03T00:00:00.000Z',
    });
    expect(last.id).toBe(3);

    expect(store.usage.spendOnDay('2026-01-02')).toBeCloseTo(0.75);
    expect(store.usage.spendOnDay('2026-01-05')).toBe(0);
    expect(store.usage.listByDay('2026-01-02').map((entry) => entry.id)).toEqual([1, 2]);
    expect(store.usage.aggregate('2026-01-01', '2026-01-03')).toEqual([
      { day: '2026-01-02', repoId: null, tokensIn: 3, tokensOut: 2, costUsd: 0.25, runs: 0 },
      { day: '2026-01-02', repoId: REPO.id, tokensIn: 10, tokensOut: 5, costUsd: 0.5, runs: 1 },
      { day: '2026-01-03', repoId: REPO.id, tokensIn: 1, tokensOut: 1, costUsd: 0.1, runs: 1 },
    ]);
    expect(store.usage.aggregate('2026-01-03', '2026-01-03')).toHaveLength(1);
    expect(store.usage.aggregate('2026-02-01', '2026-02-02')).toEqual([]);
    expect(
      storeErrorCode(() =>
        store.usage.record({
          runId: 'run_0000404',
          repoId: null,
          day: '2026-01-02',
          model: null,
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
          createdAt: '2026-01-02T00:00:00.000Z',
        }),
      ),
    ).toBe('foreign_key_violation');
  });
});
