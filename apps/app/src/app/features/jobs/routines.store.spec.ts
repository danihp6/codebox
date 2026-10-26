import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { PromptRoutine, ReminderRoutine, SseStreamEvent } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { RoutinesStore } from './routines.store';

const REMINDER_ID = 'rtn_01JABCDEFGHJKMNPQRSV';
const PROMPT_ID = 'rtn_01JABCDEFGHJKMNPQRSW';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const CHAT_ID = 'chat_01JABCDEFGHJKMNPQRSV';
const TS = '2026-10-24T18:03:11Z';
const ROUTINES_URL = '/v1/routines?limit=100';

const REMINDER: ReminderRoutine = {
  id: REMINDER_ID,
  kind: 'reminder',
  title: 'Stand up',
  cron: '0 7 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  createdAt: TS,
  nextFireAt: '2026-10-25T05:00:00Z',
  lastFiredAt: null,
};

const PROMPT: PromptRoutine = {
  id: PROMPT_ID,
  kind: 'prompt',
  title: 'Morning summary',
  cron: '0 8 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  repoId: REPO_ID,
  prompt: 'Summarise the repository.',
  chatSessionId: CHAT_ID,
  createdAt: TS,
  nextFireAt: null,
  lastFiredAt: TS,
};

const CONFLICT = {
  error: {
    code: 'conflict',
    message: 'Already paused',
    requestId: 'req_01JABCDEFGHJKMNPQRSV',
  },
};

const MISSING = {
  error: {
    code: 'not_found',
    message: 'Missing',
    requestId: 'req_01JABCDEFGHJKMNPQRSV',
  },
};

describe('RoutinesStore', () => {
  let store: RoutinesStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), RoutinesStore],
    });
    store = TestBed.inject(RoutinesStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function load(routines: readonly (ReminderRoutine | PromptRoutine)[]): void {
    store.load();
    http.expectOne(ROUTINES_URL).flush({ data: [...routines], nextCursor: null });
  }

  it('starts loading and fills the list from the first page', () => {
    expect(store.loading()).toBe(true);

    load([REMINDER, PROMPT]);

    expect(store.loading()).toBe(false);
    expect(store.routines().map((routine) => routine.id)).toEqual([REMINDER_ID, PROMPT_ID]);
    expect(store.error()).toBeNull();
  });

  it('keeps the error and stops loading when the read fails', () => {
    store.load();
    http.expectOne(ROUTINES_URL).flush(CONFLICT, { status: 409, statusText: 'Conflict' });

    expect(store.loading()).toBe(false);
    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.routines()).toHaveLength(0);
  });

  it('pauses optimistically and rolls back on a 409', () => {
    load([REMINDER]);

    store.pause(REMINDER);

    expect(store.routines()[0]).toMatchObject({ enabled: false, nextFireAt: null });
    expect(store.busy()).toBe(REMINDER_ID);

    http
      .expectOne({ method: 'POST', url: `/v1/routines/${REMINDER_ID}/pause` })
      .flush(CONFLICT, { status: 409, statusText: 'Conflict' });

    expect(store.routines()[0]).toEqual(REMINDER);
    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.busy()).toBeNull();
  });

  it('resumes optimistically and lets the server replace the row', () => {
    const paused: ReminderRoutine = { ...REMINDER, enabled: false, nextFireAt: null };
    load([paused]);

    store.resume(paused);

    expect(store.routines()[0]?.enabled).toBe(true);

    http
      .expectOne({ method: 'POST', url: `/v1/routines/${REMINDER_ID}/resume` })
      .flush(REMINDER);

    expect(store.routines()[0]).toEqual(REMINDER);
    expect(store.busy()).toBeNull();
  });

  it('merges the 202 routine of a run-now and clears the running id', () => {
    load([REMINDER]);

    store.runNow(REMINDER);
    expect(store.running()).toBe(REMINDER_ID);

    http
      .expectOne({ method: 'POST', url: `/v1/routines/${REMINDER_ID}/run` })
      .flush({ ...REMINDER, lastFiredAt: TS }, { status: 202, statusText: 'Accepted' });

    expect(store.running()).toBeNull();
    expect(store.routines()[0]?.lastFiredAt).toBe(TS);
  });

  it('drops the row on a 204 delete', () => {
    load([REMINDER, PROMPT]);

    store.remove(REMINDER);
    expect(store.busy()).toBe(REMINDER_ID);

    http
      .expectOne({ method: 'DELETE', url: `/v1/routines/${REMINDER_ID}` })
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(store.routines().map((routine) => routine.id)).toEqual([PROMPT_ID]);
    expect(store.busy()).toBeNull();
  });

  it('sets the error and reloads when the delete is already gone', () => {
    load([REMINDER]);

    store.remove(REMINDER);
    http
      .expectOne({ method: 'DELETE', url: `/v1/routines/${REMINDER_ID}` })
      .flush(MISSING, { status: 404, statusText: 'Not Found' });

    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.routines()).toHaveLength(1);

    http.expectOne(ROUTINES_URL).flush({ data: [], nextCursor: null });
    expect(store.routines()).toHaveLength(0);
  });

  it.each(['routine.fired', 'routine.replied', 'routine.failed'] as const)(
    'reloads exactly once on a %s frame',
    (event) => {
      load([REMINDER]);

      expect(store.applyStreamEvent(streamEvent(event))).toBe('applied');

      const request = http.expectOne(ROUTINES_URL);
      expect(request.request.method).toBe('GET');
      request.flush({ data: [REMINDER], nextCursor: null });
      http.expectNone(ROUTINES_URL);
    },
  );

  it('ignores a job.changed frame without a request', () => {
    load([REMINDER]);

    const changed: SseStreamEvent = {
      event: 'job.changed',
      data: { jobId: 'job_01JABCDEFGHJKMNPQRSV', change: 'paused', ts: TS },
    };

    expect(store.applyStreamEvent(changed)).toBe('ignored');
    http.expectNone(ROUTINES_URL);
    expect(store.routines()).toHaveLength(1);
  });

  it('replaces one routine in place', () => {
    load([REMINDER, PROMPT]);

    store.replace({ ...REMINDER, title: 'Stretch' });

    expect(store.routines().map((routine) => routine.title)).toEqual(['Stretch', PROMPT.title]);
  });
});

function streamEvent(
  event: 'routine.fired' | 'routine.replied' | 'routine.failed',
): SseStreamEvent {
  if (event === 'routine.fired') {
    return {
      event,
      data: { routineId: REMINDER_ID, kind: 'reminder', scheduledFor: TS, ts: TS },
    };
  }
  if (event === 'routine.replied') {
    return {
      event,
      data: {
        routineId: PROMPT_ID,
        chatId: CHAT_ID,
        messageId: 'message_01JABCDEFGHJKMNPQRSV',
        ts: TS,
      },
    };
  }
  return {
    event,
    data: { routineId: PROMPT_ID, code: 'agent_unavailable', message: 'No agent', ts: TS },
  };
}
