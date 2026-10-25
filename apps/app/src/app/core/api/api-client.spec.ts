import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from './api-client';

const HEALTH = {
  status: 'ok',
  db: 'ok',
  opencode: 'degraded',
  disk: { freeBytes: 1024, totalBytes: 4096, usedPercent: 75 },
  queue: { pending: 1, running: 0, maxConcurrency: 2 },
  version: '0.1.0',
};

const RUN = {
  id: 'run_01JABCDEFGHJKMNPQRSV',
  repoId: 'repo_01JABCDEFGHJKMNPQRSV',
  jobId: null,
  state: 'running',
  trigger: 'manual',
  branch: 'cb/run-01JABCDEFGHJKMNPQRSV',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [{ id: 'gate', state: 'pass' }],
  blockers: [],
  diff: { files: 6, added: 184, removed: 22 },
  cost: { usd: 0.42, tokensIn: 18200, tokensOut: 3100 },
  createdAt: '2026-10-24T18:03:11Z',
  finishedAt: null,
};

const RUN_DIFF = {
  files: 6,
  added: 184,
  removed: 22,
  changedFiles: [
    { path: 'src/a.ts', status: 'modified', added: 12, removed: 3 },
  ],
};

const EVENT_PAGE = {
  data: [
    {
      id: 1842,
      seq: null,
      type: 'approval.created',
      data: {
        approvalId: 'apv_01JABCDEFGHJKMNPQRSV',
        runId: 'run_01JABCDEFGHJKMNPQRSV',
        chatId: null,
        tool: 'bash',
        title: 'Run a command',
        expiresAt: '2026-10-24T18:20:00Z',
        ts: '2026-10-24T18:04:02Z',
      },
      ts: '2026-10-24T18:04:02Z',
    },
  ],
  nextCursor: '1842',
};

function refusal(code: string, reason: string): Record<string, unknown> {
  return {
    error: {
      code,
      message: 'Refused',
      requestId: 'req_01JABCDEFGHJKMNPQRSV',
      details: { reason },
    },
  };
}

describe('ApiClient', () => {
  let http: HttpTestingController;
  let api: ApiClient;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ApiClient);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('parses a health body through the contracts schema', async () => {
    const health = firstValueFrom(api.health());
    const request = http.expectOne('/v1/health');
    expect(request.request.method).toBe('GET');
    request.flush(HEALTH);

    await expect(health).resolves.toMatchObject({ status: 'ok', opencode: 'degraded' });
  });

  it('maps an invalid body to a contract ApiError', async () => {
    const health = firstValueFrom(api.health());
    const request = http.expectOne('/v1/health');
    request.flush({ status: 'ok' });

    const error = await health.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: 'contract', requestId: null });
  });

  it('maps an error envelope to an ApiError with its code and request id', async () => {
    const health = firstValueFrom(api.health());
    const request = http.expectOne('/v1/health');
    request.flush(
      {
        error: {
          code: 'rate_limited',
          message: 'Slow down',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
          details: { retryAfter: 5 },
        },
      },
      { status: 429, statusText: 'Too Many Requests' },
    );

    const error = await health.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'rate_limited',
      requestId: 'req_01JABCDEFGHJKMNPQRSV',
      details: { retryAfter: 5 },
    });
  });

  it('sends pagination query parameters to the runs list', () => {
    api.listRuns({ state: 'failed', limit: 20, cursor: 'c_01JABCDEFGHJKMNPQRSV' }).subscribe();
    const request = http.expectOne(
      (candidate) => candidate.url === '/v1/runs' && candidate.method === 'GET',
    );

    expect(request.request.params.get('state')).toBe('failed');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('cursor')).toBe('c_01JABCDEFGHJKMNPQRSV');
    request.flush({ data: [], nextCursor: null });
  });

  it('rejects a malformed run payload with a contract ApiError', async () => {
    const run = firstValueFrom(api.getRun('run_01JABCDEFGHJKMNPQRSV'));
    const request = http.expectOne('/v1/runs/run_01JABCDEFGHJKMNPQRSV');
    expect(request.request.method).toBe('GET');
    request.flush({ id: 'run_01JABCDEFGHJKMNPQRSV' });

    const error = await run.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: 'contract', requestId: null });
  });

  it('sends the event replay query and parses a page whose sequence is null', async () => {
    const events = firstValueFrom(
      api.runEvents('run_01JABCDEFGHJKMNPQRSV', { after: 0, limit: 200 }),
    );
    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/v1/runs/run_01JABCDEFGHJKMNPQRSV/events' && candidate.method === 'GET',
    );
    expect(request.request.params.get('after')).toBe('0');
    expect(request.request.params.get('limit')).toBe('200');
    request.flush(EVENT_PAGE);

    const parsed = await events;
    expect(parsed.nextCursor).toBe('1842');
    expect(parsed.data[0]).toMatchObject({ id: 1842, seq: null, type: 'approval.created' });
  });

  it('rejects a page with an unknown event type', async () => {
    const events = firstValueFrom(api.runEvents('run_01JABCDEFGHJKMNPQRSV'));
    http.expectOne('/v1/runs/run_01JABCDEFGHJKMNPQRSV/events').flush({
      data: [{ id: 1, seq: 1, type: 'run.unknown', data: {}, ts: '2026-10-24T18:04:02Z' }],
      nextCursor: null,
    });

    const error = await events.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: 'contract' });
  });

  it('rejects a page whose next cursor is not a string', async () => {
    const events = firstValueFrom(api.runEvents('run_01JABCDEFGHJKMNPQRSV'));
    http
      .expectOne('/v1/runs/run_01JABCDEFGHJKMNPQRSV/events')
      .flush({ data: [], nextCursor: 1842 });

    const error = await events.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: 'contract' });
  });

  it('sends the idempotency key on revert and parses the new run', async () => {
    const run = firstValueFrom(api.revertRun('run_01JABCDEFGHJKMNPQRSV', 'k1'));
    const request = http.expectOne('/v1/runs/run_01JABCDEFGHJKMNPQRSV/revert');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).toBe('k1');
    request.flush({ ...RUN, id: 'run_01JABCDEFGHJKMNPQRSW', trigger: 'revert' });

    await expect(run).resolves.toMatchObject({ trigger: 'revert' });
  });

  it('maps a cancel refusal to a conflict ApiError with its reason', async () => {
    const run = firstValueFrom(api.cancelRun('run_01JABCDEFGHJKMNPQRSV'));
    const request = http.expectOne('/v1/runs/run_01JABCDEFGHJKMNPQRSV/cancel');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    request.flush(refusal('conflict', 'run_not_cancellable'), {
      status: 409,
      statusText: 'Conflict',
    });

    const error = await run.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'conflict',
      details: { reason: 'run_not_cancellable' },
    });
  });

  it('maps an unavailable diff refusal to a conflict ApiError', async () => {
    const diff = firstValueFrom(api.runDiff('run_01JABCDEFGHJKMNPQRSV'));
    http
      .expectOne('/v1/runs/run_01JABCDEFGHJKMNPQRSV/diff')
      .flush(refusal('conflict', 'diff_unavailable'), { status: 409, statusText: 'Conflict' });

    const error = await diff.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'conflict' });
    expect((error as ApiError).details?.['reason']).toBe('diff_unavailable');
  });

  it('parses a diff payload through the contracts schema', async () => {
    const diff = firstValueFrom(api.runDiff('run_01JABCDEFGHJKMNPQRSV'));
    http.expectOne('/v1/runs/run_01JABCDEFGHJKMNPQRSV/diff').flush(RUN_DIFF);

    await expect(diff).resolves.toMatchObject({ files: 6, added: 184, removed: 22 });
  });
});
