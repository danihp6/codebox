import type {
  ChatSession,
  PromptRoutine,
  ReminderRoutine,
  Repo,
  Routine,
} from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseRoutine,
  promptRoutineSchema,
  reminderRoutineSchema,
} from '../../contracts/src/routines.js';
import { isCheckViolation } from './db.js';
import { StoreError } from './errors.js';
import { openInMemoryStore, type Store } from './store.js';

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'octo/hello',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const CHAT: ChatSession = {
  id: 'chat_000001',
  repoId: REPO.id,
  title: 'Chat',
  status: 'idle',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastMessage: null,
};

const PROMPT: PromptRoutine = {
  id: 'rtn_000001',
  kind: 'prompt',
  title: 'Refresh the lockfile',
  cron: '0 8 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  repoId: REPO.id,
  prompt: 'refresh the lockfile and run the gate',
  chatSessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  nextFireAt: '2026-01-02T07:00:00Z',
  lastFiredAt: null,
};

const REMINDER: ReminderRoutine = {
  id: 'rtn_000002',
  kind: 'reminder',
  title: 'Take the pill',
  cron: '30 8 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  createdAt: '2026-01-02T00:00:00.000Z',
  nextFireAt: null,
  lastFiredAt: null,
};

function storeErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error.code : 'unexpected-error';
  }
  return 'no-error';
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

let store: Store;

beforeEach(() => {
  store = openInMemoryStore();
  store.repos.create(REPO);
});

afterEach(() => {
  store.close();
});

describe('routines.create', () => {
  it('round-trips the discriminated union with exactly the declared keys', () => {
    const prompt = store.routines.create(PROMPT);
    const reminder = store.routines.create(REMINDER);

    expect(parseRoutine(prompt)).toEqual(PROMPT);
    expect(parseRoutine(reminder)).toEqual(REMINDER);
    expect(Object.keys(prompt).sort()).toEqual(Object.keys(promptRoutineSchema.shape).sort());
    expect(Object.keys(reminder).sort()).toEqual(Object.keys(reminderRoutineSchema.shape).sort());
    expect(Object.keys(reminder)).not.toContain('repoId');
    expect(Object.keys(reminder)).not.toContain('prompt');
    expect(Object.keys(reminder)).not.toContain('chatSessionId');
  });

  it('stores a prompt routine bound to a chat session and a null one', () => {
    store.chats.createSession(CHAT, { opencodeSessionId: null, worktree: null });
    const bound = store.routines.create({ ...PROMPT, chatSessionId: CHAT.id });
    expect(bound).toEqual({ ...PROMPT, chatSessionId: CHAT.id });
    expect(store.routines.get(PROMPT.id)).toEqual({ ...PROMPT, chatSessionId: CHAT.id });

    const free = store.routines.create(REMINDER);
    expect(free.lastFiredAt).toBeNull();
    expect(free.nextFireAt).toBeNull();
  });

  it('does not carry an updatedAt on the routine shape', () => {
    const created = store.routines.create(PROMPT);
    expect(created).not.toHaveProperty('updatedAt');
  });

  it('classifies a duplicate id, a missing repo and a check violation', () => {
    store.routines.create(PROMPT);
    expect(storeErrorCode(() => store.routines.create(PROMPT))).toBe('unique_violation');
    expect(
      storeErrorCode(() =>
        store.routines.create({ ...PROMPT, id: 'rtn_000010', repoId: 'repo_999999' }),
      ),
    ).toBe('foreign_key_violation');
    expect(
      storeErrorCode(() => store.routines.create({ ...PROMPT, id: 'rtn_000011', prompt: '' })),
    ).toBe('check_violation');
  });

  it('refuses a reminder that carries a prompt or a chat session', () => {
    store.routines.create(REMINDER);
    expect(storeErrorCode(() => store.routines.update(REMINDER.id, { prompt: 'x' }))).toBe(
      'check_violation',
    );
    expect(
      storeErrorCode(() => store.routines.update(REMINDER.id, { chatSessionId: CHAT.id })),
    ).toBe('check_violation');
  });

  it('refuses a reminder with a repo id at the table, not only in the schema', () => {
    const error = captureError(() =>
      store.db
        .prepare(
          `INSERT INTO routines (id, kind, title, cron, timezone, enabled, notify, repo_id,
             prompt, chat_session_id, next_fire_at, last_fired_at, created_at)
           VALUES ('rtn_000020', 'reminder', 'Bad', '30 8 * * *', 'UTC', 1, 1, ?, NULL, NULL, NULL, NULL,
             '2026-01-03T00:00:00.000Z')`,
        )
        .run(REPO.id),
    );
    expect(isCheckViolation(error)).toBe(true);
    expect(store.routines.get('rtn_000020')).toBeNull();
  });
});

describe('routines.list', () => {
  it('lists newest first with the created-at cursor', () => {
    const third: PromptRoutine = {
      ...PROMPT,
      id: 'rtn_000003',
      createdAt: '2026-01-03T00:00:00.000Z',
    };
    store.routines.create(PROMPT);
    store.routines.create(REMINDER);
    store.routines.create(third);

    const first = store.routines.list({ limit: 2, cursor: null });
    expect(first.data.map((routine) => routine.id)).toEqual(['rtn_000003', 'rtn_000002']);
    expect(first.nextCursor).not.toBeNull();

    const second = store.routines.list({ limit: 2, cursor: first.nextCursor });
    expect(second.data.map((routine) => routine.id)).toEqual(['rtn_000001']);
    expect(second.nextCursor).toBeNull();
  });

  it('filters by kind and by enabled', () => {
    store.routines.create(PROMPT);
    store.routines.create(REMINDER);
    store.routines.create({ ...PROMPT, id: 'rtn_000004', enabled: false });

    const prompts = store.routines.list({ kind: 'prompt', limit: 10, cursor: null });
    expect(prompts.data.map((routine) => routine.id)).toEqual(['rtn_000004', 'rtn_000001']);
    expect(prompts.data.every((routine) => routine.kind === 'prompt')).toBe(true);

    const enabled = store.routines.list({ enabled: true, limit: 10, cursor: null });
    expect(enabled.data.map((routine) => routine.id)).toEqual(['rtn_000002', 'rtn_000001']);

    const paused = store.routines.list({ enabled: false, limit: 10, cursor: null });
    expect(paused.data.map((routine) => routine.id)).toEqual(['rtn_000004']);
  });
});

describe('routines.update', () => {
  it('applies only the keys the patch carries', () => {
    store.routines.create(PROMPT);
    const patched: Routine = store.routines.update(PROMPT.id, {
      title: 'Nightly lockfile',
      enabled: false,
      notify: false,
    });
    expect(patched.title).toBe('Nightly lockfile');
    expect(patched.enabled).toBe(false);
    expect(patched.notify).toBe(false);
    expect(patched.cron).toBe(PROMPT.cron);
    expect(patched.prompt).toBe(PROMPT.prompt);
    expect(parseRoutine(patched)).toEqual(patched);
  });

  it('writes an explicit null and refuses an unknown routine', () => {
    store.routines.create({ ...PROMPT, chatSessionId: null, lastFiredAt: PROMPT.createdAt });
    const cleared = store.routines.update(PROMPT.id, { nextFireAt: null, lastFiredAt: null });
    expect(cleared.nextFireAt).toBeNull();
    expect(cleared.lastFiredAt).toBeNull();
    expect(storeErrorCode(() => store.routines.update('rtn_000404', { title: 'x' }))).toBe(
      'not_found',
    );
  });
});

describe('routines.setNextFire and listDue', () => {
  it('sets, clears and refuses an unknown routine', () => {
    store.routines.create(PROMPT);
    store.routines.setNextFire(PROMPT.id, '2026-01-02T07:00:00Z');
    expect(store.routines.get(PROMPT.id)?.nextFireAt).toBe('2026-01-02T07:00:00Z');
    store.routines.setNextFire(PROMPT.id, null);
    expect(store.routines.get(PROMPT.id)?.nextFireAt).toBeNull();
    expect(storeErrorCode(() => store.routines.setNextFire('rtn_000404', null))).toBe('not_found');
  });

  it('lists enabled rows due at or before the instant, oldest first', () => {
    store.routines.create(PROMPT);
    store.routines.create({ ...PROMPT, id: 'rtn_000005', nextFireAt: '2026-01-02T09:00:00Z' });
    store.routines.create({ ...PROMPT, id: 'rtn_000006', nextFireAt: '2026-01-02T08:00:00Z' });
    store.routines.create({ ...PROMPT, id: 'rtn_000007', nextFireAt: '2026-01-03T08:00:00Z' });
    store.routines.create({
      ...PROMPT,
      id: 'rtn_000008',
      nextFireAt: '2026-01-02T08:00:00Z',
      enabled: false,
    });
    store.routines.create(REMINDER);

    const due = store.routines.listDue('2026-01-02T08:00:00Z', 10);
    expect(due.map((routine) => routine.id)).toEqual(['rtn_000001', 'rtn_000006']);
    expect(store.routines.listDue('2026-01-02T08:00:00Z', 1).map((routine) => routine.id)).toEqual([
      'rtn_000001',
    ]);
  });
});

describe('routines.delete', () => {
  it('cascades to the fires of the routine', () => {
    store.routines.create(PROMPT);
    const fire = store.routineFires.claim({
      routineId: PROMPT.id,
      scheduledFor: '2026-01-02T07:00:00Z',
      firedAt: '2026-01-02T07:00:01Z',
      nextFireAt: null,
    });
    expect(fire).not.toBeNull();

    store.routines.delete(PROMPT.id);
    expect(store.routines.get(PROMPT.id)).toBeNull();
    const remaining = store.db
      .prepare('SELECT COUNT(*) AS total FROM routine_fires WHERE routine_id = ?')
      .get(PROMPT.id);
    expect(Number(remaining?.['total'])).toBe(0);
    expect(storeErrorCode(() => store.routines.delete(PROMPT.id))).toBe('not_found');
  });

  it('keeps the routine when its chat session is deleted and nulls the session', () => {
    store.chats.createSession(CHAT, { opencodeSessionId: null, worktree: null });
    store.routines.create({ ...PROMPT, chatSessionId: CHAT.id });

    store.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(CHAT.id);

    const kept = store.routines.get(PROMPT.id);
    expect(kept?.kind).toBe('prompt');
    if (kept === null || kept.kind !== 'prompt') return;
    expect(kept.chatSessionId).toBeNull();
    expect(parseRoutine(kept)).toEqual(kept);
  });
});
