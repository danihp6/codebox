import type { Schedule } from '@codebox/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from './errors.js';
import { openInMemoryStore, openStore, type Store } from './store.js';

const NOW = '2026-10-24T18:03:11.000Z';

const WINDOW: Schedule = {
  id: 'sch_000001',
  repoId: 'repo_000001',
  chatSessionId: null,
  title: 'Nightly drain',
  prompt: 'Pick the next issue and open a PR.',
  mode: 'window',
  cron: null,
  timezone: 'Europe/Madrid',
  windowStart: '22:00',
  windowEnd: '06:00',
  cooldownMinutes: 20,
  maxFires: 12,
  maxCostPerFireUsd: 1.5,
  firePolicy: 'new_chat',
  consecutiveFailures: 0,
  firesCount: 0,
  spendUsd: 0,
  enabled: true,
  policy: 'auto',
  nextFireAt: '2026-10-25T20:00:00Z',
  lastFiredAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const EVERY: Schedule = {
  ...WINDOW,
  id: 'sch_000002',
  title: 'Morning summary',
  mode: 'every',
  cron: '0 8 * * *',
  windowStart: null,
  windowEnd: null,
  maxFires: null,
  maxCostPerFireUsd: null,
  firePolicy: 'continue',
  nextFireAt: '2026-10-25T07:00:00Z',
};

const REPO = {
  id: 'repo_000001',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto' as const,
  protectedPaths: [],
  enabled: true,
  createdAt: NOW,
};

function storeErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error.code : 'unexpected-error';
  }
  return 'no-error';
}

let directory: string;
const stores: Store[] = [];

function track(store: Store): Store {
  stores.push(store);
  return store;
}

function seed(): Store {
  const store = track(openInMemoryStore());
  store.repos.create(REPO);
  return store;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'codebox-schedules-'));
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('schedules.create', () => {
  it('round-trips a window schedule and an every schedule', () => {
    const store = seed();
    expect(store.schedules.create(WINDOW)).toEqual(WINDOW);
    expect(store.schedules.create(EVERY)).toEqual(EVERY);
    expect(store.schedules.get(WINDOW.id)).toEqual(WINDOW);
    expect(store.schedules.get('sch_999999')).toBeNull();
  });

  it('rejects a duplicate id and a missing repository', () => {
    const store = seed();
    store.schedules.create(WINDOW);
    expect(storeErrorCode(() => store.schedules.create(WINDOW))).toBe('unique_violation');
    expect(
      storeErrorCode(() =>
        store.schedules.create({ ...WINDOW, id: 'sch_000003', repoId: 'repo_9' }),
      ),
    ).toBe('foreign_key_violation');
  });

  it('enforces the window and cron shapes in SQL as well as in the contract', () => {
    const store = seed();
    expect(storeErrorCode(() => store.schedules.create({ ...WINDOW, cron: '0 3 * * *' }))).toBe(
      'check_violation',
    );
    expect(storeErrorCode(() => store.schedules.create({ ...EVERY, cron: null }))).toBe(
      'check_violation',
    );
    expect(storeErrorCode(() => store.schedules.create({ ...WINDOW, windowEnd: '22:00' }))).toBe(
      'check_violation',
    );
    expect(
      storeErrorCode(() =>
        store.schedules.create({ ...WINDOW, repoId: null, chatSessionId: null }),
      ),
    ).toBe('check_violation');
  });

  it('keeps a chat schedule with no repository', () => {
    const store = seed();
    const chat = store.chats.createSession(
      {
        id: 'chat_000001',
        repoId: REPO.id,
        title: 'Nightly drain',
        status: 'idle',
        createdAt: NOW,
        updatedAt: NOW,
        lastMessage: null,
      },
      { opencodeSessionId: null, worktree: null },
    );
    const created = store.schedules.create({
      ...WINDOW,
      id: 'sch_000004',
      repoId: null,
      chatSessionId: chat.id,
      firePolicy: 'continue',
    });
    expect(created.repoId).toBeNull();
    expect(created.chatSessionId).toBe('chat_000001');
  });
});

describe('schedules.list', () => {
  function seedThree(store: Store): void {
    store.schedules.create({ ...WINDOW, createdAt: '2026-10-01T00:00:00.000Z' });
    store.schedules.create({
      ...EVERY,
      createdAt: '2026-10-02T00:00:00.000Z',
      enabled: false,
      nextFireAt: null,
    });
    store.schedules.create({
      ...WINDOW,
      id: 'sch_000003',
      createdAt: '2026-10-03T00:00:00.000Z',
    });
  }

  it('pages newest first and filters by repository and enabled', () => {
    const store = seed();
    seedThree(store);

    const page = store.schedules.list({ limit: 2, cursor: null });
    expect(page.data.map((schedule) => schedule.id)).toEqual(['sch_000003', 'sch_000002']);
    expect(page.nextCursor).not.toBeNull();
    const second = store.schedules.list({ limit: 2, cursor: page.nextCursor });
    expect(second.data.map((schedule) => schedule.id)).toEqual(['sch_000001']);
    expect(second.nextCursor).toBeNull();

    expect(store.schedules.list({ limit: 10, cursor: null, enabled: false }).data).toHaveLength(1);
    expect(
      store.schedules.list({ limit: 10, cursor: null, repoId: 'repo_000001' }).data,
    ).toHaveLength(3);
    expect(store.schedules.list({ limit: 10, cursor: null, repoId: 'repo_9' }).data).toEqual([]);
  });
});

describe('schedules.update', () => {
  it('writes the fields present and bumps updated_at', () => {
    const store = seed();
    store.schedules.create(WINDOW);
    const updated = store.schedules.update(WINDOW.id, {
      title: 'Nightly drain v2',
      prompt: 'Pick two issues.',
      cooldownMinutes: 30,
      maxFires: null,
      maxCostPerFireUsd: null,
      nextFireAt: null,
      enabled: false,
      policy: 'manual',
    });
    expect(updated).toMatchObject({
      title: 'Nightly drain v2',
      prompt: 'Pick two issues.',
      cooldownMinutes: 30,
      maxFires: null,
      maxCostPerFireUsd: null,
      nextFireAt: null,
      enabled: false,
      policy: 'manual',
    });
    expect(updated.updatedAt).not.toBe(WINDOW.updatedAt);
    expect(Number.isNaN(Date.parse(updated.updatedAt))).toBe(false);
    expect(store.schedules.get(WINDOW.id)?.title).toBe('Nightly drain v2');
  });

  it('switches the mode with its field family', () => {
    const store = seed();
    store.schedules.create(WINDOW);
    const asEvery = store.schedules.update(WINDOW.id, {
      mode: 'every',
      cron: '0 3 * * *',
      windowStart: null,
      windowEnd: null,
    });
    expect(asEvery.mode).toBe('every');
    expect(asEvery.cron).toBe('0 3 * * *');
    expect(asEvery.windowStart).toBeNull();
    expect(storeErrorCode(() => store.schedules.update(WINDOW.id, { mode: 'window' }))).toBe(
      'check_violation',
    );
    expect(storeErrorCode(() => store.schedules.update(WINDOW.id, { cooldownMinutes: -1 }))).toBe(
      'check_violation',
    );
    expect(storeErrorCode(() => store.schedules.update('sch_999999', { title: 'x' }))).toBe(
      'not_found',
    );
  });
});

describe('schedules.delete and listDue', () => {
  it('deletes a schedule and cascades its fires', () => {
    const store = seed();
    store.schedules.create(WINDOW);
    store.scheduleFires.claim({
      scheduleId: WINDOW.id,
      scheduledFor: '2026-10-25T20:00:00Z',
      firedAt: '2026-10-25T20:00:05Z',
      nextFireAt: null,
    });
    store.schedules.delete(WINDOW.id);
    expect(store.schedules.get(WINDOW.id)).toBeNull();
    expect(store.scheduleFires.listBySchedule(WINDOW.id, 10)).toEqual([]);
    expect(storeErrorCode(() => store.schedules.delete(WINDOW.id))).toBe('not_found');
  });

  it('selects the due rows oldest first and only the enabled ones', () => {
    const store = seed();
    store.schedules.create({ ...WINDOW, nextFireAt: '2026-10-25T22:00:00Z' });
    store.schedules.create({ ...EVERY, nextFireAt: '2026-10-25T07:00:00Z' });
    store.schedules.create({
      ...WINDOW,
      id: 'sch_000003',
      nextFireAt: '2026-10-25T21:00:00Z',
    });
    store.schedules.create({
      ...WINDOW,
      id: 'sch_000004',
      enabled: false,
      nextFireAt: '2026-10-25T06:00:00Z',
    });
    store.schedules.create({ ...WINDOW, id: 'sch_000005', nextFireAt: null });

    const due = store.schedules.listDue('2026-10-25T21:30:00Z', 10);
    expect(due.map((schedule) => schedule.id)).toEqual(['sch_000002', 'sch_000003']);
    expect(store.schedules.listDue('2026-10-25T21:30:00Z', 1).map((row) => row.id)).toEqual([
      'sch_000002',
    ]);
    expect(store.schedules.listDue('2026-10-24T00:00:00Z', 10)).toEqual([]);
  });
});

describe('the file database', () => {
  it('keeps the schedules after reopening', () => {
    const path = join(directory, 'state.db');
    const writer = openStore({ path });
    writer.repos.create(REPO);
    writer.schedules.create(WINDOW);
    writer.close();

    const reader = track(openStore({ path }));
    expect(reader.schemaVersion).toBe(7);
    expect(reader.schedules.get(WINDOW.id)).toEqual(WINDOW);
  });
});
