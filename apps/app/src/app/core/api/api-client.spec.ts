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
});
