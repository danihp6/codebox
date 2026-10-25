import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Health, Job, Run, Settings } from '@codebox/contracts';
import { run } from './main.js';
import type { CliIo } from './main.js';
import { createRedactingIo, formatApiError, formatTable, jsonLine, redactToken } from './output.js';
import { TransportError } from './transport.js';
import type { CliRequest, CliResponse, CliTransport } from './transport.js';

const TOKEN = 'cb-secret-value';

const HEALTH: Health = {
  status: 'ok',
  db: 'ok',
  opencode: 'ok',
  disk: { freeBytes: 4_000, totalBytes: 10_000, usedPercent: 40 },
  queue: { pending: 0, running: 0, maxConcurrency: 2 },
  version: '0.0.0',
};

const RUN: Run = {
  id: 'run_ABC123',
  repoId: 'repo_ABC123',
  jobId: null,
  state: 'running',
  trigger: 'manual',
  branch: 'cb/run_ABC123-nightly',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  createdAt: '2026-10-24T18:03:11Z',
  finishedAt: null,
};

const JOB: Job = {
  id: 'job_ABC123',
  repoId: 'repo_ABC123',
  title: 'Nightly',
  prompt: 'p',
  mode: 'work',
  agent: 'build',
  model: null,
  cron: '0 3 * * *',
  timezone: 'UTC',
  enabled: true,
  policy: 'auto',
  createdAt: '2026-10-24T18:03:11Z',
  nextFireAt: null,
};

const SETTINGS: Settings = {
  automerge: false,
  mergeMethod: 'merge',
  maxConcurrency: 2,
  dailyCostUsd: 10,
  protectedPaths: [],
  diffMaxFiles: 10,
  diffMaxLines: 500,
  timezone: 'UTC',
  quietHours: null,
};

const NOT_FOUND: CliResponse = {
  status: 404,
  body: { error: { code: 'not_found', message: 'Not found', requestId: 'req_ABC123' } },
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function capture(): { readonly io: CliIo; readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (line: string): void => {
        out.push(line);
      },
      err: (line: string): void => {
        err.push(line);
      },
    },
    out,
    err,
  };
}

interface Harness {
  readonly transport: CliTransport;
  readonly requests: CliRequest[];
}

function transportOf(answer: (request: CliRequest) => CliResponse): Harness {
  const requests: CliRequest[] = [];
  return {
    requests,
    transport: {
      async send(request: CliRequest): Promise<CliResponse> {
        requests.push(request);
        return answer(request);
      },
    },
  };
}

function routes(): Harness {
  return transportOf((request) => {
    if (request.path === '/v1/health') return { status: 200, body: HEALTH };
    if (request.path === '/v1/runs')
      return { status: 200, body: { data: [RUN], nextCursor: null } };
    if (request.path === '/v1/settings') return { status: 200, body: SETTINGS };
    if (request.path === '/v1/jobs')
      return { status: 200, body: { data: [JOB], nextCursor: null } };
    if (request.path === '/v1/providers') return { status: 404, body: NOT_FOUND.body };
    if (request.path === '/v1/telemetry') return { status: 404, body: NOT_FOUND.body };
    return NOT_FOUND;
  });
}

describe('arguments', () => {
  it('prints usage and exits 2 without arguments', async () => {
    const { io, out, err } = capture();

    const code = await run({
      argv: [],
      io,
      env: {},
      transport: transportOf(() => NOT_FOUND).transport,
    });

    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err.join('\n')).toContain('usage: cb');
    expect(err.join('\n')).toContain('missing command');
  });

  it('exits 0 for --help and -h', async () => {
    for (const argv of [['--help'], ['-h'], ['help']]) {
      const { io, out } = capture();
      const code = await run({
        argv,
        io,
        env: {},
        transport: transportOf(() => NOT_FOUND).transport,
      });
      expect(code).toBe(0);
      expect(out[0]).toContain('usage: cb');
    }
  });

  it('prints the daemon package version for --version', async () => {
    const { io, out } = capture();

    expect(await run({ argv: ['--version'], io, env: {} })).toBe(0);
    expect(out).toEqual(['codebox 0.0.0']);

    const explicit = capture();
    await run({ argv: ['version'], io: explicit.io, env: {}, version: '9.9.9' });
    expect(explicit.out).toEqual(['codebox 9.9.9']);
  });

  it('exits 2 for an unknown command and names it', async () => {
    const { io, err } = capture();

    expect(await run({ argv: ['bogus'], io, env: {} })).toBe(2);
    expect(err.join('\n')).toContain('bogus');
  });

  it('exits 2 for an unknown flag and names it', async () => {
    const { io, err } = capture();

    expect(await run({ argv: ['status', '--bogus'], io, env: {} })).toBe(2);
    expect(err.join('\n')).toContain('--bogus');
  });

  it('exits 2 for --url without a value', async () => {
    const { io, err } = capture();

    expect(await run({ argv: ['status', '--url'], io, env: {} })).toBe(2);
    expect(err.join('\n')).toContain('--url');
  });

  it('exits 2 for a missing positional and an invalid value', async () => {
    expect(await run({ argv: ['logs'], io: capture().io, env: {} })).toBe(2);
    expect(
      await run({
        argv: ['brake', 'sideways'],
        io: capture().io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: routes().transport,
      }),
    ).toBe(2);
    expect(
      await run({ argv: ['pair', '--name', 'x', '--ttl', '5'], io: capture().io, env: {} }),
    ).toBe(2);
  });
});

describe('exit codes', () => {
  it('exits 4 when no token is set', async () => {
    const harness = routes();
    const { io, out, err } = capture();

    const code = await run({ argv: ['status'], io, env: {}, transport: harness.transport });

    expect(code).toBe(4);
    expect(err).toEqual(['no token: set CODEBOX_TOKEN or --token']);
    expect(out).toEqual([]);
    expect(harness.requests).toEqual([]);
  });

  it('exits 3 when the daemon cannot be reached', async () => {
    const { io, err } = capture();

    const code = await run({
      argv: ['status'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: {
        send: (): Promise<CliResponse> => Promise.reject(new TransportError('unreachable', 'nope')),
      },
    });

    expect(code).toBe(3);
    expect(err.join('\n')).toContain('daemon unreachable');
  });

  it('exits 3 on a timeout and on a non-JSON body', async () => {
    for (const kind of ['timeout', 'bad_response'] as const) {
      const { io } = capture();
      const code = await run({
        argv: ['status'],
        io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: {
          send: (): Promise<CliResponse> => Promise.reject(new TransportError(kind, 'x')),
        },
      });
      expect(code).toBe(3);
    }
  });

  it('exits 4 on 401 and 403 and 5 on any other non-2xx answer', async () => {
    const cases: readonly (readonly [number, number])[] = [
      [401, 4],
      [403, 4],
      [404, 5],
      [409, 5],
      [500, 5],
    ];
    for (const [status, expected] of cases) {
      const { io } = capture();
      const code = await run({
        argv: ['status'],
        io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: transportOf(() => ({
          status,
          body: { error: { code: 'not_found', message: 'Nope', requestId: 'req_ABC123' } },
        })).transport,
      });
      expect(code, `status ${status}`).toBe(expected);
    }
  });

  it('prints the envelope, never the raw response', async () => {
    const { io, err } = capture();

    await run({
      argv: ['jobs'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: transportOf(() => ({
        status: 422,
        body: {
          error: {
            code: 'validation_failed',
            message: 'limit is invalid',
            details: { path: 'limit' },
            requestId: 'req_ABC123',
          },
        },
      })).transport,
    });

    expect(err).toEqual(['validation_failed: limit is invalid (requestId req_ABC123)']);
  });

  it('exits 5 without an envelope when the body is not one', async () => {
    const { io, err } = capture();

    const code = await run({
      argv: ['jobs'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: transportOf(() => ({ status: 500, body: { unexpected: true } })).transport,
    });

    expect(code).toBe(5);
    expect(err).toEqual(['request failed with status 500']);
  });
});

describe('token resolution', () => {
  it('prefers --token over CODEBOX_TOKEN and sends it as a bearer token', async () => {
    const harness = routes();
    const { io } = capture();

    await run({
      argv: ['status', '--token', 'cb-flag-token'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });

    expect(harness.requests[0]?.token).toBe('cb-flag-token');
  });

  it('reads CODEBOX_TOKEN and the token file, in that order', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cb-cli-token-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'cli.token'), '  cb-file-token\n');

    const fromEnv = routes();
    await run({
      argv: ['status'],
      io: capture().io,
      env: { CODEBOX_TOKEN: TOKEN, CODEBOX_STATE_DIR: directory },
      transport: fromEnv.transport,
    });
    expect(fromEnv.requests[0]?.token).toBe(TOKEN);

    const fromFile = routes();
    await run({
      argv: ['status'],
      io: capture().io,
      env: { CODEBOX_STATE_DIR: directory },
      transport: fromFile.transport,
    });
    expect(fromFile.requests[0]?.token).toBe('cb-file-token');

    const missing = routes();
    const code = await run({
      argv: ['status'],
      io: capture().io,
      env: { CODEBOX_STATE_DIR: join(directory, 'nope') },
      transport: missing.transport,
    });
    expect(code).toBe(4);
    expect(missing.requests).toEqual([]);
  });

  it('caps the token file at 4096 bytes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cb-cli-token-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'cli.token'), `${'a'.repeat(5000)}\n`);

    const harness = routes();
    await run({
      argv: ['status'],
      io: capture().io,
      env: { CODEBOX_STATE_DIR: directory },
      transport: harness.transport,
    });

    expect(harness.requests[0]?.token).toHaveLength(4096);
  });
});

describe('base URL', () => {
  function stubDaemon(urls: string[]): void {
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      urls.push(url);
      if (url.includes('/v1/health')) return new Response(JSON.stringify(HEALTH), { status: 200 });
      if (url.includes('/v1/runs')) {
        return new Response(JSON.stringify({ data: [RUN], nextCursor: null }), { status: 200 });
      }
      if (url.includes('/v1/settings'))
        return new Response(JSON.stringify(SETTINGS), { status: 200 });
      return new Response(JSON.stringify(NOT_FOUND.body), { status: 404 });
    });
  }

  it('defaults to the loopback daemon', async () => {
    const urls: string[] = [];
    stubDaemon(urls);

    const { io } = capture();
    const code = await run({ argv: ['status'], io, env: { CODEBOX_TOKEN: TOKEN } });

    expect(code).toBe(0);
    expect(urls[0]).toBe('http://127.0.0.1:8787/v1/health');
  });

  it('honours --url and strips one trailing slash', async () => {
    const urls: string[] = [];
    stubDaemon(urls);

    const { io } = capture();
    await run({
      argv: ['status', '--url', 'http://127.0.0.1:9999/'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
    });

    expect(urls[0]).toBe('http://127.0.0.1:9999/v1/health');
  });

  it('honours CODEBOX_URL', async () => {
    const urls: string[] = [];
    stubDaemon(urls);

    await run({
      argv: ['status'],
      io: capture().io,
      env: { CODEBOX_TOKEN: TOKEN, CODEBOX_URL: 'http://127.0.0.1:8080' },
    });

    expect(urls[0]).toBe('http://127.0.0.1:8080/v1/health');
  });
});

describe('output', () => {
  it('pads the table columns and keeps the last column tight', () => {
    expect(
      formatTable([
        ['a', 'b'],
        ['longer', 'c'],
      ]),
    ).toEqual(['a       b', 'longer  c']);
    expect(formatTable([['id', 'x']], ['id', 'name'])).toEqual(['id  name', 'id  x']);
  });

  it('formats an API error exactly', () => {
    expect(
      formatApiError({
        error: { code: 'not_found', message: 'Not found', requestId: 'req_ABC123' },
      }),
    ).toBe('not_found: Not found (requestId req_ABC123)');
  });

  it('redacts the token, its bearer form and any bearer value', () => {
    expect(redactToken('x cb-secret-value y', 'cb-secret-value')).toBe('x <redacted> y');
    expect(redactToken('authorization: Bearer cb-secret-value', 'cb-secret-value')).toBe(
      'authorization: <redacted>',
    );
    expect(redactToken('Authorization: Bearer other-value-123', null)).toBe(
      'Authorization: <redacted>',
    );
    expect(redactToken('--token <token>  bearer token (default CODEBOX_TOKEN)', 'abc')).toBe(
      '--token <token>  bearer token (default CODEBOX_TOKEN)',
    );
  });

  it('renders JSON on one line', () => {
    expect(jsonLine({ a: 1 })).toBe('{"a":1}');
    expect(jsonLine(undefined)).toBe('null');
  });

  it('wraps a writer so no line leaks', () => {
    const lines: string[] = [];
    const io = createRedactingIo(
      {
        out: (line: string): void => {
          lines.push(line);
        },
        err: (line: string): void => {
          lines.push(line);
        },
      },
      'cb-secret-value',
    );

    io.out('token cb-secret-value');
    io.err('Authorization: Bearer cb-secret-value');

    expect(lines).toEqual(['token <redacted>', 'Authorization: <redacted>']);
  });
});
