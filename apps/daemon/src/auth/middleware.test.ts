import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Scope } from '@codebox/contracts';
import type { AppVariables } from '../modules.js';
import {
  API_RATE_LIMIT,
  API_RATE_WINDOW_SECONDS,
  WORK_RATE_LIMIT,
  WORK_RATE_WINDOW_SECONDS,
  createApiRateLimiters,
  createAuthMiddleware,
  isWorkRoute,
} from './middleware.js';
import type { AuthService, AuthenticatedDevice } from './service.js';

const REQUEST_ID = 'req_01JABCDEFGHJKMNPQRSTVWXYZ0';
const FIRST = 'token-first';
const SECOND = 'token-second';
const SCOPES: readonly Scope[] = ['read', 'runs'];

function deviceFor(token: string): AuthenticatedDevice | null {
  if (token === FIRST) return { id: 'dev_first0000000000000', scopes: SCOPES };
  if (token === SECOND) return { id: 'dev_second000000000000', scopes: SCOPES };
  return null;
}

function service(): AuthService {
  const unused = (): Promise<never> => Promise.reject(new Error('not part of this test'));
  return {
    issueCode: unused,
    exchange: unused,
    refresh: unused,
    logout: (): void => undefined,
    authenticate: (accessToken: string): AuthenticatedDevice | null => deviceFor(accessToken),
  };
}

interface Harness {
  readonly app: Hono<{ Variables: AppVariables }>;
  readonly seconds: (value: number) => void;
}

interface HarnessOptions {
  /** No pair means the middleware does not limit at all, which is the daemon's default. */
  readonly unlimited?: boolean;
}

function harness(options: HarnessOptions = {}): Harness {
  let nowMs = Date.parse('2026-10-25T00:00:00.000Z');
  const limiters = createApiRateLimiters({ now: () => new Date(nowMs) });
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('requestId', REQUEST_ID);
    await next();
  });
  app.use('/v1/*', createAuthMiddleware(service(), options.unlimited === true ? undefined : limiters));
  app.get('/v1/me', (c) => c.json({ ok: true }, 200));
  app.post('/v1/runs', (c) => c.json({ ok: true }, 202));
  app.post('/v1/jobs/:id/pause', (c) => c.json({ ok: true }, 200));
  return {
    app,
    seconds: (value: number): void => {
      nowMs += value * 1000;
    },
  };
}

function get(app: Harness['app'], token: string): Promise<Response> {
  return Promise.resolve(app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } }));
}

function post(app: Harness['app'], token: string, path: string): Promise<Response> {
  return Promise.resolve(
    app.request(path, { method: 'POST', headers: { authorization: `Bearer ${token}` } }),
  );
}

describe('the rate limit values', () => {
  it('pins the two budgets and their windows', () => {
    expect(API_RATE_LIMIT).toBe(120);
    expect(API_RATE_WINDOW_SECONDS).toBe(60);
    expect(WORK_RATE_LIMIT).toBe(10);
    expect(WORK_RATE_WINDOW_SECONDS).toBe(60);
  });
});

describe('isWorkRoute', () => {
  it('is true for the run-creating routes', () => {
    expect(isWorkRoute('POST', '/v1/runs')).toBe(true);
    expect(isWorkRoute('POST', '/v1/jobs/job_01JABCDEF/run')).toBe(true);
  });

  it('is false for a read and for a non-run mutation', () => {
    expect(isWorkRoute('GET', '/v1/runs')).toBe(false);
    expect(isWorkRoute('POST', '/v1/jobs/job_01JABCDEF/pause')).toBe(false);
    expect(isWorkRoute('POST', '/v1/runs/run_01JABCDEF/cancel')).toBe(false);
  });
});

describe('per-device rate limiting', () => {
  it('answers 429 on the 121st request of one device on an ordinary route', async () => {
    const test = harness();
    for (let index = 0; index < API_RATE_LIMIT; index += 1) {
      expect((await get(test.app, FIRST)).status, `request ${index + 1}`).toBe(200);
    }

    const limited = await get(test.app, FIRST);

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await limited.json()) as { error: Record<string, unknown> };
    expect(body.error).toMatchObject({
      code: 'rate_limited',
      details: { retryAfter: expect.any(Number) },
    });
  });

  it('counts a work route in its own budget only and answers 429 on the eleventh', async () => {
    const test = harness();
    for (let index = 0; index < WORK_RATE_LIMIT; index += 1) {
      expect((await post(test.app, FIRST, '/v1/runs')).status, `run ${index + 1}`).toBe(202);
    }
    expect((await get(test.app, FIRST)).status).toBe(200);

    const limited = await post(test.app, FIRST, '/v1/runs');

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('leaves a second device unaffected', async () => {
    const test = harness();
    for (let index = 0; index <= API_RATE_LIMIT; index += 1) await get(test.app, FIRST);
    expect((await get(test.app, FIRST)).status).toBe(429);
    expect((await get(test.app, SECOND)).status).toBe(200);
  });

  it('lets the window roll over', async () => {
    const test = harness();
    for (let index = 0; index < API_RATE_LIMIT; index += 1) await get(test.app, FIRST);
    expect((await get(test.app, FIRST)).status).toBe(429);
    test.seconds(API_RATE_WINDOW_SECONDS + 1);
    expect((await get(test.app, FIRST)).status).toBe(200);
  });

  it('does not limit when the middleware was built without a limiter pair', async () => {
    const test = harness({ unlimited: true });
    for (let index = 0; index < API_RATE_LIMIT + 30; index += 1) {
      expect((await get(test.app, FIRST)).status).toBe(200);
    }
  });
});
