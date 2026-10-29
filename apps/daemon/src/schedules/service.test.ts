import { describe, expect, it } from 'vitest';
import { parseSchedule, parseScheduleDetail } from '@codebox/contracts';
import type { SchedulePatch } from '@codebox/store';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { ScheduleFireError } from './fire.js';
import type { ScheduleFirePort } from './fire.js';
import { createSchedulesService, newScheduleId, schedulesRuntimeOf } from './service.js';
import type { SchedulesService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const REPO_ID = 'repo_sched01';
const NOW = '2026-10-25T10:05:00.000Z';

const stores: Store[] = [];

function contextFor(store: Store, now: Date): DaemonContext {
  const config = loadConfig({ CB_ENV: 'test', CB_SESSION_SECRET: SESSION_SECRET });
  const logger = createLogger({ level: 'error', sink: () => undefined });
  return {
    config,
    store,
    logger,
    clock: () => now,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: '/nonexistent/app',
    shutdown: createShutdownRegistry(logger),
  };
}

interface FakePort extends ScheduleFirePort {
  readonly runs: { scheduleId: string; scheduledFor: string; costCapUsd: number | null }[];
  failure: ScheduleFireError | null;
}

/** The row `queueRun` would have created: the fake port writes it so the fire's FK holds. */
function queuedRun(store: Store, id: string): void {
  store.runs.create({
    id,
    repoId: REPO_ID,
    jobId: null,
    state: 'queued',
    trigger: 'schedule',
    branch: `cb/${id}-nightly-drain`,
    baseRef: 'main',
    pr: null,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    createdAt: NOW,
    finishedAt: null,
    baseSha: null,
    worktree: null,
    sessionId: null,
    prompt: 'Pick the next issue and open a PR.',
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

function fakePort(store: Store): FakePort {
  let counter = 0;
  const port: FakePort = {
    runs: [],
    failure: null,
    startRun(input): { readonly runId: string } {
      if (port.failure !== null) throw port.failure;
      counter += 1;
      port.runs.push({
        scheduleId: input.schedule.id,
        scheduledFor: input.scheduledFor,
        costCapUsd: input.costCapUsd,
      });
      const runId = `run_sched${String(counter).padStart(4, '0')}`;
      queuedRun(store, runId);
      return { runId };
    },
  };
  return port;
}

interface Harness {
  readonly store: Store;
  readonly service: SchedulesService;
  readonly port: FakePort;
  setNow(value: string): void;
  drain(): Promise<void>;
}

function harness(failure: ScheduleFireError | null = null): Harness {
  const store = openInMemoryStore();
  stores.push(store);
  store.repos.create({
    id: REPO_ID,
    slug: 'acme/widgets',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'manual',
    protectedPaths: [],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  let cursor = new Date(NOW);
  const port = fakePort(store);
  port.failure = failure;
  const service = createSchedulesService({
    context: contextFor(store, cursor),
    now: () => cursor,
    fire: port,
  });
  const runtime = schedulesRuntimeOf(service);
  return {
    store,
    service,
    port,
    setNow(value: string): void {
      cursor = new Date(value);
    },
    async drain(): Promise<void> {
      await Promise.all(runtime.pending());
    },
  };
}

function fixture(
  input: Record<string, unknown> & { id: string },
): ReturnType<typeof parseSchedule> {
  const base: Record<string, unknown> = {
    repoId: REPO_ID,
    chatSessionId: null,
    title: 'Nightly drain',
    prompt: 'Pick the next issue and open a PR.',
    mode: 'window',
    cron: null,
    timezone: 'Europe/Madrid',
    windowStart: '22:00',
    windowEnd: '06:00',
    cooldownMinutes: 20,
    maxFires: null,
    maxCostPerFireUsd: null,
    firePolicy: 'new_chat',
    consecutiveFailures: 0,
    firesCount: 0,
    spendUsd: 0,
    enabled: true,
    policy: 'manual',
    nextFireAt: null,
    lastFiredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...input,
  };
  return parseSchedule(base);
}

function windowInput(): Parameters<SchedulesService['create']>[0] {
  return {
    title: 'Nightly drain',
    prompt: 'Pick the next issue and open a PR.',
    mode: 'window',
    timezone: 'Europe/Madrid',
    windowStart: '22:00',
    windowEnd: '06:00',
    cooldownMinutes: 20,
    maxCostPerFireUsd: 1.5,
    repoId: REPO_ID,
  };
}

function errorOf(run: () => unknown): RunApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof RunApiError) return error;
    throw error;
  }
  throw new Error('the call should have thrown');
}

describe('newScheduleId', () => {
  it('mints the sch_ prefix the contract accepts', () => {
    const id = newScheduleId();
    expect(id.startsWith('sch_')).toBe(true);
    expect(fixture({ id }).id).toBe(id);
    expect(() => newScheduleId(() => Buffer.alloc(4))).toThrow(RangeError);
  });
});

describe('create', () => {
  it('stores a window schedule whose next fire is the coming opening', () => {
    const { service } = harness();
    const created = service.create(windowInput());
    expect(created.id).toMatch(/^sch_/);
    expect(created.mode).toBe('window');
    expect(created.cron).toBeNull();
    expect(created.enabled).toBe(true);
    expect(created.firesCount).toBe(0);
    expect(created.spendUsd).toBe(0);
    expect(created.policy).toBe('manual');
    expect(created.firePolicy).toBe('new_chat');
    expect(created.nextFireAt).toBe('2026-10-25T21:00:00Z');
    expect(parseSchedule(created)).toEqual(created);
  });

  it('stores an every schedule and a once schedule from their cron', () => {
    const { service } = harness();
    const every = service.create({
      ...windowInput(),
      mode: 'every',
      cron: '0 12 * * *',
      timezone: 'UTC',
      windowStart: null,
      windowEnd: null,
    });
    expect(every.cron).toBe('0 12 * * *');
    expect(every.windowStart).toBeNull();
    expect(every.nextFireAt).toBe('2026-10-25T12:00:00Z');

    const once = service.create({
      ...windowInput(),
      mode: 'once',
      cron: '30 9 1 1 *',
      timezone: 'UTC',
      windowStart: null,
      windowEnd: null,
    });
    expect(once.nextFireAt).toBe('2027-01-01T09:30:00Z');
  });

  it('refuses a missing repository, a missing target and a bad cron or zone', () => {
    const { service } = harness();
    expect(
      errorOf(() => service.create({ ...windowInput(), repoId: 'repo_000000' })).details,
    ).toEqual({ path: 'schedule.repoId', reason: 'repo_missing' });
    expect(errorOf(() => service.create({ ...windowInput(), repoId: null })).details).toEqual({
      path: 'schedule.repoId',
      reason: 'repo_required',
    });
    expect(
      errorOf(() =>
        service.create({
          ...windowInput(),
          mode: 'every',
          cron: '99 99 99 99 99',
          windowStart: null,
          windowEnd: null,
        }),
      ).details,
    ).toEqual({ path: 'schedule.cron', reason: 'range' });
    expect(
      errorOf(() =>
        service.create({
          ...windowInput(),
          mode: 'every',
          cron: '0 3 * *',
          windowStart: null,
          windowEnd: null,
        }),
      ).details,
    ).toEqual({ path: 'schedule.cron', reason: 'field_count' });
    expect(
      errorOf(() => service.create({ ...windowInput(), timezone: 'Mars/Olympus' })).details,
    ).toEqual({ path: 'schedule.timezone', reason: 'timezone' });
    expect(errorOf(() => service.create({ ...windowInput(), windowEnd: '22:00' })).details).toEqual(
      { path: 'schedule.windowStart', reason: 'window' },
    );
    expect(errorOf(() => service.create({ ...windowInput(), cron: '0 3 * * *' })).details).toEqual({
      path: 'schedule.cron',
      reason: 'window',
    });
  });

  it('refuses an unknown chat and a chat schedule that clears its chat', () => {
    const { service, store } = harness();
    expect(
      errorOf(() => service.create({ ...windowInput(), chatSessionId: 'chat_000000' })).details,
    ).toEqual({ path: 'schedule.chatSessionId', reason: 'repo_missing' });
    const chat = store.chats.createSession(
      {
        id: 'chat_000002',
        repoId: REPO_ID,
        title: 'Nightly drain',
        status: 'idle',
        createdAt: NOW,
        updatedAt: NOW,
        lastMessage: null,
      },
      { opencodeSessionId: null, worktree: null },
    );
    const schedule = service.create({
      ...windowInput(),
      repoId: null,
      chatSessionId: chat.id,
    });
    expect(schedule.firePolicy).toBe('continue');
    expect(errorOf(() => service.patch(schedule.id, { chatSessionId: null })).details).toEqual({
      path: 'schedule.chatSessionId',
      reason: 'repo_required',
    });
  });
});

describe('list, get, patch, pause, resume and remove', () => {
  it('reads a page and one detail with its preview', () => {
    const { service } = harness();
    const created = service.create(windowInput());
    expect(service.list({ limit: 10, cursor: null }).data.map((entry) => entry.id)).toEqual([
      created.id,
    ]);
    expect(service.list({ limit: 10, cursor: null, repoId: REPO_ID }).data).toHaveLength(1);
    expect(service.list({ limit: 10, cursor: null, enabled: false }).data).toEqual([]);

    const detail = service.get(created.id);
    expect(parseScheduleDetail(detail)).toEqual(detail);
    expect(detail.nextFires).toEqual([
      '2026-10-25T21:00:00Z',
      '2026-10-25T21:20:00Z',
      '2026-10-25T21:40:00Z',
      '2026-10-25T22:00:00Z',
      '2026-10-25T22:20:00Z',
    ]);
  });

  it('recomputes the next fire on the fields that change the schedule', () => {
    const { service, store } = harness();
    const created = service.create({
      ...windowInput(),
      mode: 'every',
      cron: '0 12 * * *',
      timezone: 'UTC',
      windowStart: null,
      windowEnd: null,
    });
    const renamed = service.patch(created.id, { title: 'Renamed', prompt: 'Do less.' });
    expect(renamed.title).toBe('Renamed');
    expect(renamed.nextFireAt).toBe('2026-10-25T12:00:00Z');

    expect(service.patch(created.id, { cron: '0 18 * * *' }).nextFireAt).toBe(
      '2026-10-25T18:00:00Z',
    );
    const paused = service.patch(created.id, { enabled: false });
    expect(paused.enabled).toBe(false);
    expect(paused.nextFireAt).toBeNull();
    const resumed = service.patch(created.id, { enabled: true });
    expect(resumed.enabled).toBe(true);
    expect(resumed.nextFireAt).toBe('2026-10-25T18:00:00Z');

    expect(errorOf(() => service.patch(created.id, { cron: 'nope' })).status).toBe(422);
    expect(store.schedules.get(created.id)?.cron).toBe('0 18 * * *');
  });

  it('refuses an unknown id on every verb', () => {
    const { service } = harness();
    const missing = errorOf(() => service.get('sch_999999'));
    expect(missing.code).toBe('not_found');
    expect(missing.details).toEqual({ path: 'schedule.id' });
    expect(errorOf(() => service.patch('sch_999999', {})).status).toBe(404);
    expect(errorOf(() => service.remove('sch_999999')).status).toBe(404);
    expect(errorOf(() => service.pause('sch_999999')).status).toBe(404);
    expect(errorOf(() => service.resume('sch_999999')).status).toBe(404);
  });

  it('pauses, resumes and removes', () => {
    const { service, store } = harness();
    const created = service.create(windowInput());
    const paused = service.pause(created.id);
    expect(paused.enabled).toBe(false);
    expect(paused.nextFireAt).toBeNull();
    expect(service.pause(created.id).enabled).toBe(false);

    const resumed = service.resume(created.id);
    expect(resumed.enabled).toBe(true);
    expect(resumed.nextFireAt).toBe('2026-10-25T21:00:00Z');

    service.remove(created.id);
    expect(store.schedules.get(created.id)).toBeNull();
  });
});

describe('tick', () => {
  function dueEvery(store: Store, scheduledFor: string, patch: SchedulePatch = {}): string {
    return store.schedules.create(
      fixture({
        id: 'sch_000900',
        mode: 'every',
        cron: '0 10 * * *',
        timezone: 'UTC',
        windowStart: null,
        windowEnd: null,
        nextFireAt: scheduledFor,
        ...patch,
      }),
    ).id;
  }

  it('claims a fire inside the grace, starts the work and records it', async () => {
    const h = harness();
    const id = dueEvery(h.store, '2026-10-25T10:00:00Z');
    expect(await h.service.tick()).toEqual({ due: 1, fired: 1, skipped: 0, lost: 0 });
    expect(h.port.runs).toEqual([
      { scheduleId: id, scheduledFor: '2026-10-25T10:00:00Z', costCapUsd: null },
    ]);
    await h.drain();
    const fires = h.store.scheduleFires.listBySchedule(id, 10);
    expect(fires).toHaveLength(1);
    expect(fires[0]?.outcome).toBe('fired');
    expect(fires[0]?.runId).toBe('run_sched0001');
    const schedule = h.store.schedules.get(id);
    expect(schedule?.firesCount).toBe(1);
    expect(schedule?.lastFiredAt).toBe('2026-10-25T10:05:00Z');
    expect(schedule?.consecutiveFailures).toBe(0);
    expect(schedule?.nextFireAt).toBe('2026-10-26T10:00:00Z');
  });

  it('skips a fire outside the grace and leaves the last fire alone', async () => {
    const h = harness();
    const id = dueEvery(h.store, '2026-10-25T09:00:00Z');
    expect(await h.service.tick()).toEqual({ due: 1, fired: 0, skipped: 1, lost: 0 });
    expect(h.port.runs).toEqual([]);
    const fires = h.store.scheduleFires.listBySchedule(id, 10);
    expect(fires).toHaveLength(1);
    expect(fires[0]?.outcome).toBe('skipped');
    const schedule = h.store.schedules.get(id);
    expect(schedule?.lastFiredAt).toBeNull();
    expect(schedule?.firesCount).toBe(0);
    expect(schedule?.nextFireAt).toBe('2026-10-26T10:00:00Z');
  });

  it('counts a claim somebody else won as lost and never throws', async () => {
    const h = harness();
    const id = dueEvery(h.store, '2026-10-25T10:00:00Z');
    expect(
      h.store.scheduleFires.claim({
        scheduleId: id,
        scheduledFor: '2026-10-25T10:00:00Z',
        firedAt: '2026-10-25T10:01:00Z',
        nextFireAt: '2026-10-25T10:00:00Z',
      }),
    ).not.toBeNull();
    expect(await h.service.tick()).toEqual({ due: 1, fired: 0, skipped: 0, lost: 1 });
    expect(h.store.scheduleFires.listBySchedule(id, 10)).toHaveLength(1);
  });

  it('returns a zero report while a tick is already running', async () => {
    const h = harness();
    dueEvery(h.store, '2026-10-25T10:00:00Z');
    const first = h.service.tick();
    expect(await h.service.tick()).toEqual({ due: 0, fired: 0, skipped: 0, lost: 0 });
    expect(await first).toEqual({ due: 1, fired: 1, skipped: 0, lost: 0 });
  });

  it('pauses a schedule after three consecutive failed fires', async () => {
    const h = harness(new ScheduleFireError('repo_missing'));
    const id = dueEvery(h.store, '2026-10-25T10:00:00Z');
    for (const [now, scheduledFor] of [
      ['2026-10-25T10:05:00.000Z', '2026-10-25T10:00:00Z'],
      ['2026-10-25T10:06:00.000Z', '2026-10-25T10:01:00Z'],
      ['2026-10-25T10:07:00.000Z', '2026-10-25T10:02:00Z'],
    ] as [string, string][]) {
      h.setNow(now);
      h.store.schedules.update(id, { nextFireAt: scheduledFor, enabled: true });
      await h.service.tick();
      await h.drain();
    }
    const fires = h.store.scheduleFires.listBySchedule(id, 10);
    expect(fires.map((fire) => fire.outcome)).toEqual(['failed', 'failed', 'failed']);
    expect(fires[0]?.detail).toBe('repo_missing');
    const schedule = h.store.schedules.get(id);
    expect(schedule?.consecutiveFailures).toBe(3);
    expect(schedule?.enabled).toBe(false);
    expect(schedule?.nextFireAt).toBeNull();
  });

  it('stops a schedule that reached maxFires', async () => {
    const h = harness();
    const id = dueEvery(h.store, '2026-10-25T10:00:00Z', { maxFires: 1 });
    await h.service.tick();
    await h.drain();
    const schedule = h.store.schedules.get(id);
    expect(schedule?.firesCount).toBe(1);
    expect(schedule?.nextFireAt).toBeNull();
    expect(schedule?.enabled).toBe(true);
  });

  it('anchors the next window fire on the finish instant, not the claim', async () => {
    const h = harness();
    const created = h.service.create(windowInput());
    h.store.schedules.update(created.id, { nextFireAt: '2026-10-25T10:00:00Z' });
    h.setNow('2026-10-25T10:04:00.000Z');
    await h.service.tick();
    await h.drain();
    // 10:04 + 20 minutes is outside 22:00–06:00, so the next fire is the coming opening.
    expect(h.store.schedules.get(created.id)?.nextFireAt).toBe('2026-10-25T21:00:00Z');
    expect(h.store.schedules.get(created.id)?.firesCount).toBe(1);
  });

  it('fails a repo-less schedule with repo_required', async () => {
    const h = harness();
    // The legacy chat row is what the FK on `schedules.chat_session_id` still points at.
    h.store.chats.createSession(
      {
        id: 'chat_000001',
        repoId: REPO_ID,
        title: 'Nightly drain',
        status: 'idle',
        createdAt: NOW,
        updatedAt: NOW,
        lastMessage: null,
      },
      { opencodeSessionId: null, worktree: null },
    );
    const created = h.store.schedules.create(
      fixture({
        id: 'sch_000901',
        repoId: null,
        chatSessionId: 'chat_000001',
        firePolicy: 'continue',
        mode: 'every',
        cron: '0 10 * * *',
        windowStart: null,
        windowEnd: null,
        nextFireAt: '2026-10-25T10:00:00Z',
      }),
    );
    expect(await h.service.tick()).toEqual({ due: 1, fired: 1, skipped: 0, lost: 0 });
    await h.drain();
    expect(h.port.runs).toEqual([]);
    const fires = h.store.scheduleFires.listBySchedule(created.id, 10);
    expect(fires[0]).toMatchObject({
      outcome: 'failed',
      detail: 'repo_required',
      chatId: null,
    });
  });

  it('does nothing when no schedule is due', async () => {
    const h = harness();
    h.service.create(windowInput());
    expect(await h.service.tick()).toEqual({ due: 0, fired: 0, skipped: 0, lost: 0 });
    expect(h.port.runs).toEqual([]);
  });
});
