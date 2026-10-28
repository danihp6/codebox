import type { Repo, Work } from '@codebox/contracts';
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

const WORK: Work = {
  id: 'wrk_000001',
  repoId: REPO.id,
  backlogRef: 'Task-35',
  title: 'Routine engine',
  prompt: 'Build the routine engine and its tests.',
  specSha: '9f1c2ab',
  state: 'queued',
  origin: 'backlog',
  attempts: 0,
  maxAttempts: 2,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  reviewedAt: null,
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

function seed(): Store {
  store = openInMemoryStore();
  store.repos.create(REPO);
  store.repos.create(OTHER_REPO);
  return store;
}

beforeEach(() => {
  seed();
});

afterEach(() => {
  store.close();
});

describe('works.create and get', () => {
  it('round-trips a work with its backlog ref and attempts', () => {
    const created = store.works.create(WORK);
    expect(created).toEqual(WORK);
    expect(store.works.get(WORK.id)).toEqual(WORK);
    expect(store.works.get('wrk_999999')).toBeNull();
    expect(store.works.get(WORK.id)?.backlogRef).toBe('Task-35');
    expect(store.works.get(WORK.id)?.attempts).toBe(0);
  });

  it('maps a missing repository to foreign_key_violation', () => {
    const error = storeErrorOf(() =>
      store.works.create({ ...WORK, id: 'wrk_000002', repoId: 'repo_000404' }),
    );
    expect(error?.code).toBe('foreign_key_violation');
    expect(error?.message).toBe('work repository is missing');
  });

  it('maps a bad state to check_violation', () => {
    const error = storeErrorOf(() =>
      store.works.create({ ...WORK, id: 'wrk_000003', state: 'done' as Work['state'] }),
    );
    expect(error?.code).toBe('check_violation');
  });

  it('refuses a second live work for the same backlog item', () => {
    store.works.create(WORK);
    const error = storeErrorOf(() =>
      store.works.create({ ...WORK, id: 'wrk_000004', createdAt: LATER, updatedAt: LATER }),
    );
    expect(error?.code).toBe('unique_violation');
    expect(error?.message).toBe('work already in flight for this backlog item');
    expect(store.works.list({ limit: 10, cursor: null }).data).toHaveLength(1);
  });

  it('allows a second work for the same item once the first one is merged', () => {
    store.works.create({ ...WORK, state: 'merged' });
    const second = store.works.create({
      ...WORK,
      id: 'wrk_000005',
      state: 'queued',
      createdAt: LATER,
      updatedAt: LATER,
    });
    expect(second.state).toBe('queued');
    expect(store.works.findByBacklogRef(REPO.id, 'Task-35')?.id).toBe('wrk_000005');
  });
});

describe('works.update', () => {
  it('writes the attempts and stamps updated_at from the patch', () => {
    store.works.create(WORK);
    const updated = store.works.update(WORK.id, { attempts: 1, updatedAt: LATER });
    expect(updated.attempts).toBe(1);
    expect(updated.updatedAt).toBe(LATER);
    expect(updated.createdAt).toBe(NOW);
    expect(store.works.get(WORK.id)?.attempts).toBe(1);
  });

  it('accepts a state, a usage rollup and a cleared reviewedAt', () => {
    store.works.create({ ...WORK, reviewedAt: NOW });
    const updated = store.works.update(WORK.id, {
      state: 'needs_decision',
      usage: { usd: 0.5, tokensIn: 900, tokensOut: 100 },
      contextTokens: 1000,
      contextEpoch: 2,
      reviewedAt: null,
      updatedAt: LATER,
    });
    expect(updated.state).toBe('needs_decision');
    expect(updated.usage).toEqual({ usd: 0.5, tokensIn: 900, tokensOut: 100 });
    expect(updated.contextTokens).toBe(1000);
    expect(updated.contextEpoch).toBe(2);
    expect(updated.reviewedAt).toBeNull();
  });

  it('maps an unknown id to not_found and a bad value to check_violation', () => {
    const missing = storeErrorOf(() => store.works.update('wrk_999999', { updatedAt: LATER }));
    expect(missing?.code).toBe('not_found');
    expect(missing?.message).toBe('work not found');

    store.works.create(WORK);
    const refused = storeErrorOf(() =>
      store.works.update(WORK.id, { attempts: -1, updatedAt: LATER }),
    );
    expect(refused?.code).toBe('check_violation');
    expect(refused?.message).toBe('work violates a state constraint');
  });
});

describe('works.findByBacklogRef', () => {
  it('returns the newest work of the item, in any state', () => {
    expect(store.works.findByBacklogRef(REPO.id, 'Task-35')).toBeNull();
    store.works.create({ ...WORK, state: 'merged' });
    const newest = store.works.create({
      ...WORK,
      id: 'wrk_000006',
      createdAt: LATER,
      updatedAt: LATER,
    });
    expect(store.works.findByBacklogRef(REPO.id, 'Task-35')).toEqual(newest);
    expect(store.works.findByBacklogRef(REPO.id, 'Task-36')).toBeNull();
    expect(store.works.findByBacklogRef(OTHER_REPO.id, 'Task-35')).toBeNull();
  });
});

describe('works.list', () => {
  it('pages newest first and filters by repository and state', () => {
    store.works.create({ ...WORK, updatedAt: '2026-10-01T00:00:00.000Z' });
    store.works.create({
      ...WORK,
      id: 'wrk_000007',
      backlogRef: 'Task-36',
      state: 'merged',
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    store.works.create({
      ...WORK,
      id: 'wrk_000008',
      repoId: OTHER_REPO.id,
      backlogRef: 'Task-37',
      updatedAt: '2026-10-03T00:00:00.000Z',
    });

    const page = store.works.list({ limit: 10, cursor: null });
    expect(page.data.map((work) => work.id)).toEqual(['wrk_000008', 'wrk_000007', 'wrk_000001']);
    expect(page.nextCursor).toBeNull();

    const first = store.works.list({ repoId: REPO.id, state: 'queued', limit: 10, cursor: null });
    expect(first.data.map((work) => work.id)).toEqual(['wrk_000001']);
    expect(first.nextCursor).toBeNull();

    const second = store.works.list({ limit: 2, cursor: null });
    expect(second.data.map((work) => work.id)).toEqual(['wrk_000008', 'wrk_000007']);
    expect(second.nextCursor).not.toBeNull();
    const rest = store.works.list({ limit: 2, cursor: second.nextCursor });
    expect(rest.data.map((work) => work.id)).toEqual(['wrk_000001']);
    expect(rest.nextCursor).toBeNull();
  });
});
