import type { Repo, RepoSchedule } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from './errors.js';
import { openInMemoryStore, type Store } from './store.js';

const NOW = '2026-10-28T09:12:00.000Z';
const LATER = '2026-10-28T10:12:00.000Z';

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: NOW,
};

const OTHER_REPO: Repo = { ...REPO, id: 'repo_000002', slug: 'acme/gadgets' };

const SCHEDULE: RepoSchedule = {
  id: 'sch_000001',
  repoId: REPO.id,
  mode: 'window',
  cron: null,
  timezone: 'Europe/Madrid',
  windowStart: '22:00',
  windowEnd: '06:00',
  cooldownMinutes: 20,
  selection: 'nextPending',
  refs: [],
  maxAttempts: 2,
  maxFires: 6,
  maxCostPerFireUsd: 0.75,
  consecutiveFailures: 0,
  firesCount: 0,
  spendUsd: 0,
  enabled: true,
  nextFireAt: '2026-10-28T21:00:00Z',
  lastFiredAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function storeErrorOf(run: () => unknown): StoreError | null {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error : null;
  }
  return null;
}

let store: Store;

beforeEach(() => {
  store = openInMemoryStore();
  store.repos.create(REPO);
  store.repos.create(OTHER_REPO);
});

afterEach(() => {
  store.close();
});

describe('repoSchedules.create', () => {
  it('round-trips a D56 schedule through get and getByRepo', () => {
    const created = store.repoSchedules.create(SCHEDULE);
    expect(created).toEqual(SCHEDULE);
    expect(store.repoSchedules.get(SCHEDULE.id)).toEqual(SCHEDULE);
    expect(store.repoSchedules.getByRepo(REPO.id)).toEqual(SCHEDULE);
    expect(store.repoSchedules.get('sch_999999')).toBeNull();
    expect(store.repoSchedules.getByRepo(OTHER_REPO.id)).toBeNull();
  });

  it('writes the legacy sentinel columns so the legacy reader still parses the row', () => {
    store.repoSchedules.create(SCHEDULE);
    const legacy = store.schedules.get(SCHEDULE.id);
    expect(legacy?.title).toBe('');
    expect(legacy?.prompt).toBe('');
    expect(legacy?.firePolicy).toBe('new_chat');
    expect(legacy?.policy).toBe('auto');
    expect(legacy?.chatSessionId).toBeNull();
  });

  it('refuses a second schedule on one repository, and accepts one on another', () => {
    store.repoSchedules.create(SCHEDULE);
    const duplicate = storeErrorOf(() =>
      store.repoSchedules.create({
        ...SCHEDULE,
        id: 'sch_000002',
        createdAt: LATER,
        updatedAt: LATER,
      }),
    );
    expect(duplicate?.code).toBe('unique_violation');
    expect(duplicate?.message).toBe('schedule already exists for this repository');

    const other = store.repoSchedules.create({
      ...SCHEDULE,
      id: 'sch_000003',
      repoId: OTHER_REPO.id,
      createdAt: LATER,
      updatedAt: LATER,
    });
    expect(other.repoId).toBe(OTHER_REPO.id);
    expect(store.repoSchedules.getByRepo(OTHER_REPO.id)?.id).toBe('sch_000003');
  });

  it('maps a missing repository to foreign_key_violation and a bad shape to check_violation', () => {
    const missing = storeErrorOf(() =>
      store.repoSchedules.create({ ...SCHEDULE, id: 'sch_000004', repoId: 'repo_000404' }),
    );
    expect(missing?.code).toBe('foreign_key_violation');

    const shaped = storeErrorOf(() =>
      store.repoSchedules.create({ ...SCHEDULE, id: 'sch_000005', cron: '0 3 * * *' }),
    );
    expect(shaped?.code).toBe('check_violation');
  });

  it('keeps a refs selection in its JSON column', () => {
    const created = store.repoSchedules.create({
      ...SCHEDULE,
      id: 'sch_000006',
      repoId: OTHER_REPO.id,
      selection: 'refs',
      refs: ['Task-35', 'Task-36'],
    });
    expect(created.refs).toEqual(['Task-35', 'Task-36']);
    expect(store.repoSchedules.get(created.id)?.selection).toBe('refs');
  });
});

describe('repoSchedules.update', () => {
  it('writes the patch and stamps updated_at from the argument', () => {
    store.repoSchedules.create(SCHEDULE);
    const updated = store.repoSchedules.update(SCHEDULE.id, {
      selection: 'refs',
      refs: ['Task-35'],
      maxAttempts: 3,
      consecutiveFailures: 1,
      spendUsd: 0.4,
      firesCount: 2,
      enabled: false,
      nextFireAt: null,
      updatedAt: LATER,
    });
    expect(updated).toMatchObject({
      selection: 'refs',
      refs: ['Task-35'],
      maxAttempts: 3,
      consecutiveFailures: 1,
      spendUsd: 0.4,
      firesCount: 2,
      enabled: false,
      nextFireAt: null,
      updatedAt: LATER,
    });
    expect(updated.createdAt).toBe(NOW);
  });

  it('maps an unknown id to not_found and a broken mode to check_violation', () => {
    const missing = storeErrorOf(() =>
      store.repoSchedules.update('sch_999999', { updatedAt: LATER }),
    );
    expect(missing?.code).toBe('not_found');

    store.repoSchedules.create(SCHEDULE);
    const broken = storeErrorOf(() =>
      store.repoSchedules.update(SCHEDULE.id, { mode: 'every', updatedAt: LATER }),
    );
    expect(broken?.code).toBe('check_violation');
    expect(broken?.message).toBe('schedule violates a mode constraint');
  });
});

describe('repoSchedules.list and listDue', () => {
  it('pages newest first and filters by repository and enabled', () => {
    store.repoSchedules.create({ ...SCHEDULE, createdAt: '2026-10-01T00:00:00.000Z' });
    store.repoSchedules.create({
      ...SCHEDULE,
      id: 'sch_000007',
      repoId: OTHER_REPO.id,
      createdAt: '2026-10-02T00:00:00.000Z',
      enabled: false,
    });

    const page = store.repoSchedules.list({ limit: 10, cursor: null });
    expect(page.data.map((schedule) => schedule.id)).toEqual(['sch_000007', 'sch_000001']);
    expect(page.nextCursor).toBeNull();
    expect(
      store.repoSchedules.list({ limit: 10, cursor: null, repoId: REPO.id }).data,
    ).toHaveLength(1);
    expect(
      store.repoSchedules
        .list({ limit: 10, cursor: null, enabled: false })
        .data.map((schedule) => schedule.id),
    ).toEqual(['sch_000007']);
  });

  it('returns only the enabled rows whose next fire is due', () => {
    store.repoSchedules.create({ ...SCHEDULE, nextFireAt: '2026-10-28T22:00:00Z' });
    store.repoSchedules.create({
      ...SCHEDULE,
      id: 'sch_000008',
      repoId: OTHER_REPO.id,
      nextFireAt: '2026-10-28T20:00:00Z',
    });
    const due = store.repoSchedules.listDue('2026-10-28T21:00:00Z', 10);
    expect(due.map((schedule) => schedule.id)).toEqual(['sch_000008']);
    expect(store.repoSchedules.listDue('2026-10-28T19:00:00Z', 10)).toEqual([]);

    store.repoSchedules.update('sch_000008', { enabled: false, updatedAt: LATER });
    expect(
      store.repoSchedules.listDue('2026-10-28T23:00:00Z', 10).map((entry) => entry.id),
    ).toEqual(['sch_000001']);
  });
});

describe('repoSchedules.delete', () => {
  it('removes the row and refuses an unknown id', () => {
    store.repoSchedules.create(SCHEDULE);
    store.repoSchedules.delete(SCHEDULE.id);
    expect(store.repoSchedules.get(SCHEDULE.id)).toBeNull();
    expect(store.repoSchedules.getByRepo(REPO.id)).toBeNull();
    expect(storeErrorOf(() => store.repoSchedules.delete(SCHEDULE.id))?.code).toBe('not_found');
  });
});
