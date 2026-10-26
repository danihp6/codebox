import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ContractParseError } from '@codebox/contracts';
import type { PromptRoutine, ReminderRoutine } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { RoutinesApi } from './routines.api';

const ROUTINE_ID = 'rtn_01JABCDEFGHJKMNPQRSV';
const OTHER_ID = 'rtn_01JABCDEFGHJKMNPQRSW';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const CHAT_ID = 'chat_01JABCDEFGHJKMNPQRSV';
const TS = '2026-10-24T18:03:11Z';

const REMINDER: ReminderRoutine = {
  id: ROUTINE_ID,
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
  id: OTHER_ID,
  kind: 'prompt',
  title: 'Morning summary',
  cron: '0 8 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: false,
  repoId: REPO_ID,
  prompt: 'Summarise the repository in five bullets.',
  chatSessionId: CHAT_ID,
  createdAt: TS,
  nextFireAt: null,
  lastFiredAt: TS,
};

const ENVELOPE = {
  error: {
    code: 'not_found',
    message: 'Missing',
    requestId: 'req_01JABCDEFGHJKMNPQRSV',
    details: { path: 'routine.id' },
  },
};

describe('RoutinesApi', () => {
  let api: RoutinesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(RoutinesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('lists the routines with the explicit page size', () => {
    let count = -1;
    api.list({ limit: 100 }).subscribe((page) => {
      count = page.data.length;
    });

    const request = http.expectOne('/v1/routines?limit=100');
    expect(request.request.method).toBe('GET');
    request.flush({ data: [REMINDER, PROMPT], nextCursor: null });

    expect(count).toBe(2);
  });

  it('serialises the kind filter and the enabled boolean as strings', () => {
    api.list({ limit: 100, cursor: 'cur_1', kind: 'reminder', enabled: false }).subscribe();

    const request = http.expectOne((candidate) => candidate.url === '/v1/routines');
    expect(request.request.params.get('limit')).toBe('100');
    expect(request.request.params.get('cursor')).toBe('cur_1');
    expect(request.request.params.get('kind')).toBe('reminder');
    expect(request.request.params.get('enabled')).toBe('false');
    request.flush({ data: [], nextCursor: null });
  });

  it('reads one routine', () => {
    let routine: unknown;
    api.get(ROUTINE_ID).subscribe((value) => {
      routine = value;
    });

    http.expectOne({ method: 'GET', url: `/v1/routines/${ROUTINE_ID}` }).flush(REMINDER);

    expect(routine).toEqual(REMINDER);
  });

  it('patches only the defined keys and never a kind', () => {
    api
      .patch(ROUTINE_ID, { title: 'Stretch', cron: '30 7 * * *', notify: false })
      .subscribe();

    const request = http.expectOne({ method: 'PATCH', url: `/v1/routines/${ROUTINE_ID}` });
    expect(request.request.body).toEqual({
      title: 'Stretch',
      cron: '30 7 * * *',
      notify: false,
    });
    expect(Object.keys(request.request.body as Record<string, unknown>).sort()).toEqual([
      'cron',
      'notify',
      'title',
    ]);
    request.flush({ ...REMINDER, title: 'Stretch' });
  });

  it('pauses, resumes and runs now with a null body', () => {
    api.pause(ROUTINE_ID).subscribe();
    const pause = http.expectOne({ method: 'POST', url: `/v1/routines/${ROUTINE_ID}/pause` });
    expect(pause.request.body).toBeNull();
    pause.flush({ ...REMINDER, enabled: false, nextFireAt: null });

    api.resume(ROUTINE_ID).subscribe();
    http
      .expectOne({ method: 'POST', url: `/v1/routines/${ROUTINE_ID}/resume` })
      .flush(REMINDER);

    let fired: unknown;
    api.runNow(ROUTINE_ID).subscribe((value) => {
      fired = value;
    });
    http
      .expectOne({ method: 'POST', url: `/v1/routines/${ROUTINE_ID}/run` })
      .flush({ ...REMINDER, lastFiredAt: TS }, { status: 202, statusText: 'Accepted' });

    expect(fired).toMatchObject({ lastFiredAt: TS });
  });

  it('deletes a routine and resolves on the 204', () => {
    let resolved = false;
    api.remove(ROUTINE_ID).subscribe(() => {
      resolved = true;
    });

    http
      .expectOne({ method: 'DELETE', url: `/v1/routines/${ROUTINE_ID}` })
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(resolved).toBe(true);
  });

  it('surfaces a malformed routine body as a ContractParseError', () => {
    let failure: unknown;
    api.get(ROUTINE_ID).subscribe({ error: (error: unknown) => (failure = error) });

    http
      .expectOne({ method: 'GET', url: `/v1/routines/${ROUTINE_ID}` })
      .flush({ ...REMINDER, prompt: 'not a reminder field' });

    expect(failure).toBeInstanceOf(ContractParseError);
    expect(failure).not.toBeInstanceOf(ApiError);
  });

  it('maps a refusal envelope to an ApiError', () => {
    let failure: unknown;
    api.pause(ROUTINE_ID).subscribe({ error: (error: unknown) => (failure = error) });

    http
      .expectOne({ method: 'POST', url: `/v1/routines/${ROUTINE_ID}/pause` })
      .flush(ENVELOPE, { status: 404, statusText: 'Not Found' });

    expect(failure).toBeInstanceOf(ApiError);
    const error = failure as ApiError;
    expect(error.status).toBe(404);
    expect(error.code).toBe('not_found');
    expect(error.details?.['path']).toBe('routine.id');
  });
});
