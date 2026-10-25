import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Health, Job, Providers, Run, Settings, Telemetry } from '@codebox/contracts';
import { idempotencyKeySchema } from '@codebox/contracts';
import { BACKUP_SCRIPT, UPGRADE_SCRIPT } from './commands.js';
import type { CommandRunner } from './commands.js';
import { run } from './main.js';
import type { CliIo } from './main.js';
import type { CliRequest, CliResponse, CliTransport } from './transport.js';

const TOKEN = 'cb-secret-value';
const BASE_URL = 'http://127.0.0.1:8787';
const UPGRADE_ARGS = ['--to', '0.2.0'];

const HEALTH: Health = {
  status: 'ok',
  db: 'ok',
  opencode: 'ok',
  disk: { freeBytes: 4_000, totalBytes: 10_000, usedPercent: 40 },
  queue: { pending: 1, running: 1, maxConcurrency: 2 },
  version: '0.0.0',
};

const RUN: Run = {
  id: 'run_ABC123',
  repoId: 'repo_ABC123',
  jobId: 'job_ABC123',
  state: 'queued',
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
  title: 'Nightly lockfile',
  prompt: 'Update the lockfile.',
  mode: 'work',
  agent: 'build',
  model: null,
  cron: '0 3 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  policy: 'auto',
  createdAt: '2026-10-24T18:03:11Z',
  nextFireAt: '2026-10-25T01:00:00Z',
};

const SETTINGS: Settings = {
  automerge: true,
  mergeMethod: 'squash',
  maxConcurrency: 2,
  dailyCostUsd: 10,
  protectedPaths: ['ops/**'],
  diffMaxFiles: 20,
  diffMaxLines: 500,
  timezone: 'UTC',
  quietHours: null,
};

const TELEMETRY: Telemetry = {
  range: '24h',
  since: '2026-10-24T18:03:11Z',
  spendUsd: 1.84,
  runs: { total: 3, succeeded: 2, failed: 1, cancelled: 0 },
  disk: HEALTH.disk,
  queueDepth: 0,
};

const PROVIDERS: Providers = {
  providers: [
    { provider: 'github', configured: true, mode: 'app', lastOkAt: null, fingerprint: '1234' },
  ],
};

const EVENTS: readonly unknown[] = [
  { ts: '2026-10-24T18:03:11Z', type: 'run.output', data: { delta: 'hello' } },
  { ts: '2026-10-24T18:03:12Z', type: 'run.gate', data: { gate: { status: 'passed' } } },
];

const NOT_FOUND: CliResponse = {
  status: 404,
  body: { error: { code: 'not_found', message: 'Not found', requestId: 'req_ABC123' } },
};

const UNAUTHORIZED: CliResponse = {
  status: 401,
  body: { error: { code: 'unauthorized', message: 'Missing token', requestId: 'req_ABC123' } },
};

interface TransportHarness {
  readonly transport: CliTransport;
  readonly requests: CliRequest[];
}

function transportOf(
  routes: Readonly<Record<string, CliResponse | (() => CliResponse | Promise<CliResponse>)>>,
): TransportHarness {
  const requests: CliRequest[] = [];
  const transport: CliTransport = {
    async send(request: CliRequest): Promise<CliResponse> {
      requests.push(request);
      const answer = routes[`${request.method} ${request.path}`] ?? routes[request.path];
      if (answer === undefined) return NOT_FOUND;
      return typeof answer === 'function' ? await answer() : answer;
    },
  };
  return { transport, requests };
}

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

function runnerOf(result: {
  readonly code: number;
  readonly stdout?: string;
  readonly stderr?: string;
}): CommandRunner & { readonly calls: { file: string; args: readonly string[] }[] } {
  const calls: { file: string; args: readonly string[] }[] = [];
  return {
    calls,
    async run(input) {
      calls.push({ file: input.file, args: input.args });
      return { code: result.code, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    },
  };
}

function successRoutes(): Record<string, CliResponse | (() => CliResponse)> {
  return {
    'POST /v1/pair/code': {
      status: 201,
      body: {
        code: '7K3M9QXB2F',
        expiresAt: '2026-10-25T00:05:00Z',
        scopes: ['read', 'admin'],
        name: 'Dani iPhone',
      },
    },
    'GET /v1/health': { status: 200, body: HEALTH },
    'GET /v1/runs': { status: 200, body: { data: [RUN], nextCursor: null } },
    'GET /v1/settings': { status: 200, body: SETTINGS },
    'GET /v1/jobs': { status: 200, body: { data: [JOB], nextCursor: null } },
    'GET /v1/runs/run_ABC123/events': {
      status: 200,
      body: { data: [...EVENTS], nextCursor: null },
    },
    'POST /v1/jobs/job_ABC123/run': { status: 202, body: RUN },
    'POST /v1/jobs/job_ABC123/pause': { status: 200, body: { ...JOB, enabled: false } },
    'POST /v1/jobs/job_ABC123/resume': { status: 200, body: JOB },
    'POST /v1/admin/brake': { status: 200, body: { enabled: true } },
    'POST /v1/runs/run_ABC123/revert': { status: 202, body: RUN },
    'GET /v1/providers': { status: 200, body: PROVIDERS },
    'GET /v1/telemetry': { status: 200, body: TELEMETRY },
  };
}

describe('requests', () => {
  it('sends POST /v1/jobs/{id}/run with a fresh idempotency key', async () => {
    const harness = transportOf(successRoutes());
    const { io, out } = capture();

    const code = await run({
      argv: ['run', 'job_ABC123'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });

    expect(code).toBe(0);
    const request = harness.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe('/v1/jobs/job_ABC123/run');
    expect(request?.token).toBe(TOKEN);
    const key = request?.idempotencyKey ?? '';
    expect(key.length).toBeGreaterThanOrEqual(1);
    expect(key.length).toBeLessThanOrEqual(255);
    expect(idempotencyKeySchema.safeParse(key).success).toBe(true);
    expect(out).toEqual(['run    run_ABC123', 'state  queued']);
  });

  it('mints a fresh key per invocation', async () => {
    const harness = transportOf(successRoutes());
    const { io } = capture();

    await run({
      argv: ['run', 'job_ABC123'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });
    await run({
      argv: ['run', 'job_ABC123'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });

    expect(harness.requests[0]?.idempotencyKey).not.toBe(harness.requests[1]?.idempotencyKey);
  });

  it('sends POST /v1/admin/brake with the enabled flag', async () => {
    const harness = transportOf(successRoutes());
    const { io, out } = capture();

    const on = await run({
      argv: ['brake', 'on'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });
    expect(on).toBe(0);
    expect(harness.requests[0]?.method).toBe('POST');
    expect(harness.requests[0]?.path).toBe('/v1/admin/brake');
    expect(harness.requests[0]?.body).toEqual({ enabled: true });
    expect(out).toEqual(['brake on']);

    await run({
      argv: ['brake', 'off'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });
    expect(harness.requests[1]?.body).toEqual({ enabled: false });
  });

  it('reads the brake switch from GET /v1/settings', async () => {
    const off = transportOf({
      'GET /v1/settings': { status: 200, body: { ...SETTINGS, automerge: false } },
    });
    const first = capture();
    expect(
      await run({
        argv: ['brake', 'status'],
        io: first.io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: off.transport,
      }),
    ).toBe(0);
    expect(first.out).toEqual(['brake on']);

    const on = transportOf({ 'GET /v1/settings': { status: 200, body: SETTINGS } });
    const second = capture();
    await run({
      argv: ['brake', 'status'],
      io: second.io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: on.transport,
    });
    expect(second.out).toEqual(['brake off']);
  });

  it('prints unsupported and exits 5 on a 404 from the brake', async () => {
    const harness = transportOf({
      'POST /v1/admin/brake': NOT_FOUND,
      'GET /v1/settings': NOT_FOUND,
    });
    const { io, err } = capture();

    expect(
      await run({
        argv: ['brake', 'on'],
        io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: harness.transport,
      }),
    ).toBe(5);
    expect(err).toEqual(['unsupported']);

    const status = capture();
    expect(
      await run({
        argv: ['brake', 'status'],
        io: status.io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: harness.transport,
      }),
    ).toBe(5);
    expect(status.err).toEqual(['unsupported']);
  });

  it('sends GET /v1/runs/{id}/events?after=0&limit=200', async () => {
    const harness = transportOf(successRoutes());
    const { io, out } = capture();

    const code = await run({
      argv: ['logs', 'run_ABC123'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });

    expect(code).toBe(0);
    expect(harness.requests[0]?.method).toBe('GET');
    expect(harness.requests[0]?.path).toBe('/v1/runs/run_ABC123/events');
    expect(harness.requests[0]?.query).toEqual({ after: 0, limit: 200 });
    expect(out).toEqual([
      '2026-10-24T18:03:11Z run.output {"delta":"hello"}',
      '2026-10-24T18:03:12Z run.gate {"gate":{"status":"passed"}}',
    ]);
  });

  it('renders cb events with the same request and the same lines', async () => {
    const harness = transportOf(successRoutes());
    const logs = capture();
    const events = capture();

    await run({
      argv: ['logs', 'run_ABC123'],
      io: logs.io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });
    await run({
      argv: ['events', 'run_ABC123'],
      io: events.io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });

    expect(harness.requests[1]?.path).toBe('/v1/runs/run_ABC123/events');
    expect(events.out).toEqual(logs.out);
  });

  it('lists jobs with the documented columns', async () => {
    const harness = transportOf(successRoutes());
    const { io, out } = capture();

    expect(
      await run({
        argv: ['jobs'],
        io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: harness.transport,
      }),
    ).toBe(0);
    expect(harness.requests[0]?.query).toEqual({ limit: 50 });
    expect(out[0]).toBe(
      'id          title             cron       timezone       enabled  nextFireAt',
    );
    expect(out[1]).toBe(
      'job_ABC123  Nightly lockfile  0 3 * * *  Europe/Madrid  true     2026-10-25T01:00:00Z',
    );
  });

  it('pauses and resumes one job', async () => {
    const harness = transportOf(successRoutes());
    const paused = capture();

    expect(
      await run({
        argv: ['jobs', '--pause', 'job_ABC123'],
        io: paused.io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: harness.transport,
      }),
    ).toBe(0);
    expect(harness.requests[0]?.path).toBe('/v1/jobs/job_ABC123/pause');
    expect(paused.out).toEqual(['job      job_ABC123', 'enabled  false']);

    await run({
      argv: ['jobs', '--resume', 'job_ABC123'],
      io: capture().io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });
    expect(harness.requests[1]?.path).toBe('/v1/jobs/job_ABC123/resume');
  });

  it('sends POST /v1/runs/{id}/revert with the job and a key', async () => {
    const harness = transportOf(successRoutes());
    const { io, out } = capture();

    expect(
      await run({
        argv: ['revert', 'run_ABC123', '--job', 'job_ABC123'],
        io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: harness.transport,
      }),
    ).toBe(0);
    expect(harness.requests[0]?.method).toBe('POST');
    expect(harness.requests[0]?.path).toBe('/v1/runs/run_ABC123/revert');
    expect(harness.requests[0]?.body).toEqual({ jobId: 'job_ABC123' });
    expect(idempotencyKeySchema.safeParse(harness.requests[0]?.idempotencyKey).success).toBe(true);
    expect(out).toEqual(['run  run_ABC123']);
  });

  it('mints a pairing code without a token', async () => {
    const harness = transportOf(successRoutes());
    const { io, out } = capture();

    expect(
      await run({
        argv: ['pair', '--name', 'Dani iPhone', '--ttl', '300'],
        io,
        env: {},
        transport: harness.transport,
      }),
    ).toBe(0);
    expect(harness.requests[0]?.method).toBe('POST');
    expect(harness.requests[0]?.path).toBe('/v1/pair/code');
    expect(harness.requests[0]?.body).toEqual({ name: 'Dani iPhone', ttlSeconds: 300 });
    expect(harness.requests[0]?.token).toBeNull();
    expect(out).toEqual([
      'code     7K3M9QXB2F',
      'expires  2026-10-25T00:05:00Z',
      `link     codebox://pair?url=${BASE_URL}&code=7K3M9QXB2F`,
    ]);
  });

  it('reads health, running runs and settings for status', async () => {
    const harness = transportOf(successRoutes());
    const { io, out } = capture();

    expect(
      await run({
        argv: ['status'],
        io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: harness.transport,
      }),
    ).toBe(0);
    expect(harness.requests.map((request) => request.path)).toEqual([
      '/v1/health',
      '/v1/runs',
      '/v1/settings',
    ]);
    expect(harness.requests[1]?.query).toEqual({ state: 'running', limit: 5 });
    expect(out).toEqual([
      'status   ok',
      'version  0.0.0',
      'queue    1 running, 1 pending, max 2',
      'running  run_ABC123',
      'brake    off',
    ]);
  });

  it('merges the status bodies under --json', async () => {
    const harness = transportOf(successRoutes());
    const { io, out } = capture();

    await run({
      argv: ['status', '--json'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: harness.transport,
    });

    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] ?? '')).toEqual({
      health: HEALTH,
      runs: [RUN],
      settings: SETTINGS,
    });
  });

  it('skips the brake line when settings is missing', async () => {
    const harness = transportOf({
      ...successRoutes(),
      'GET /v1/settings': NOT_FOUND,
    });
    const { io, out } = capture();

    expect(
      await run({
        argv: ['status'],
        io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: harness.transport,
      }),
    ).toBe(0);
    expect(out.some((line) => line.startsWith('brake'))).toBe(false);
  });

  it('imports nothing outside ./ , node:* and @codebox/contracts', () => {
    const directory = fileURLToPath(new URL('.', import.meta.url));
    const specifierOf = (source: string): string[] => {
      const found: string[] = [];
      const patterns = [
        /\bfrom\s+['"]([^'"]+)['"]/g,
        /\bimport\s+['"]([^'"]+)['"]/g,
        /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          if (match[1] !== undefined) found.push(match[1]);
        }
      }
      return found;
    };

    const files = readdirSync(directory).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(`${directory}${file}`, 'utf8');
      const isTest = file.endsWith('.test.ts');
      for (const specifier of specifierOf(source)) {
        expect(specifier, `${file} imports ${specifier}`).not.toContain('..');
        const allowed =
          specifier.startsWith('./') ||
          specifier.startsWith('node:') ||
          specifier === '@codebox/contracts' ||
          (isTest && specifier === 'vitest');
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
  });
});

describe('scripts', () => {
  it('runs upgrade.sh --to and passes the child exit code through', async () => {
    const runner = runnerOf({ code: 3, stdout: 'upgrading\n', stderr: 'verify failed\n' });
    const { io, out, err } = capture();

    const code = await run({
      argv: ['update', ...UPGRADE_ARGS],
      io,
      env: {},
      runner,
      transport: transportOf({}).transport,
    });

    expect(code).toBe(3);
    expect(runner.calls).toEqual([{ file: UPGRADE_SCRIPT, args: ['--to', '0.2.0'] }]);
    expect(UPGRADE_SCRIPT).toBe('/usr/local/lib/codebox/upgrade.sh');
    expect(out).toEqual(['upgrading']);
    expect(err).toEqual(['verify failed']);
  });

  it('runs upgrade.sh --rollback and runs nothing without flags', async () => {
    const runner = runnerOf({ code: 0 });
    const { io } = capture();

    expect(
      await run({
        argv: ['update', '--rollback'],
        io,
        env: {},
        runner,
        transport: transportOf({}).transport,
      }),
    ).toBe(0);
    expect(
      await run({ argv: ['update'], io, env: {}, runner, transport: transportOf({}).transport }),
    ).toBe(0);
    expect(runner.calls).toEqual([
      { file: UPGRADE_SCRIPT, args: ['--rollback'] },
      { file: UPGRADE_SCRIPT, args: [] },
    ]);
  });

  it('refuses --to together with --rollback and an invalid version', async () => {
    const runner = runnerOf({ code: 0 });
    const together = capture();

    expect(
      await run({
        argv: ['update', '--to', '0.2.0', '--rollback'],
        io: together.io,
        env: {},
        runner,
        transport: transportOf({}).transport,
      }),
    ).toBe(2);
    expect(together.err.join('\n')).toContain('--to');

    const invalid = capture();
    expect(
      await run({
        argv: ['update', '--to', '0.2.0;rm -rf /'],
        io: invalid.io,
        env: {},
        runner,
        transport: transportOf({}).transport,
      }),
    ).toBe(2);
    expect(runner.calls).toEqual([]);
  });

  it('runs backup.sh with --verify when asked and passes the code through', async () => {
    const runner = runnerOf({ code: 4, stderr: 'no recipient\n' });
    const { io, err } = capture();

    const code = await run({
      argv: ['backup', '--verify'],
      io,
      env: {},
      runner,
      transport: transportOf({}).transport,
    });

    expect(code).toBe(4);
    expect(runner.calls).toEqual([{ file: BACKUP_SCRIPT, args: ['--verify'] }]);
    expect(BACKUP_SCRIPT).toBe('/usr/local/lib/codebox/backup.sh');
    expect(err).toEqual(['no recipient']);

    const plain = runnerOf({ code: 0 });
    await run({
      argv: ['backup'],
      io: capture().io,
      env: {},
      runner: plain,
      transport: transportOf({}).transport,
    });
    expect(plain.calls).toEqual([{ file: BACKUP_SCRIPT, args: [] }]);
  });
});

describe('never prints a token', () => {
  const failingTransport = (): CliTransport => ({
    send: (): Promise<CliResponse> =>
      Promise.resolve({
        status: 500,
        body: {
          error: {
            code: 'internal',
            message: `boom with ${TOKEN} in it`,
            details: { authorization: `Bearer ${TOKEN}`, token: TOKEN },
            requestId: 'req_ABC123',
          },
        },
      }),
  });

  const echoingTransport = (): CliTransport => ({
    async send(request: CliRequest): Promise<CliResponse> {
      if (request.path === '/v1/pair/code') {
        return {
          status: 201,
          body: { code: TOKEN, expiresAt: `2026-10-25 ${TOKEN}`, scopes: [], name: TOKEN },
        };
      }
      if (request.path === '/v1/health')
        return { status: 200, body: { ...HEALTH, version: TOKEN } };
      if (request.path === '/v1/runs')
        return { status: 200, body: { data: [RUN], nextCursor: null } };
      if (request.path === '/v1/settings')
        return { status: 200, body: { ...SETTINGS, timezone: 'UTC' } };
      if (request.path === '/v1/jobs') {
        return { status: 200, body: { data: [{ ...JOB, title: TOKEN }], nextCursor: null } };
      }
      if (request.path === '/v1/runs/run_ABC123/events') {
        return {
          status: 200,
          body: { data: [{ ts: TOKEN, type: TOKEN, data: { token: TOKEN } }], nextCursor: null },
        };
      }
      if (request.path === '/v1/admin/brake') return { status: 200, body: { enabled: true } };
      if (request.path === '/v1/jobs/job_ABC123/run') return { status: 202, body: RUN };
      if (request.path === '/v1/jobs/job_ABC123/pause') return { status: 200, body: JOB };
      if (request.path === '/v1/runs/run_ABC123/revert') return { status: 202, body: RUN };
      if (request.path === '/v1/providers') return { status: 200, body: PROVIDERS };
      if (request.path === '/v1/telemetry') return { status: 200, body: TELEMETRY };
      return NOT_FOUND;
    },
  });

  const ARGVS: readonly (readonly string[])[] = [
    ['pair', '--name', 'Dani iPhone'],
    ['status'],
    ['status', '--json'],
    ['doctor'],
    ['doctor', '--json'],
    ['run', 'job_ABC123'],
    ['jobs'],
    ['jobs', '--pause', 'job_ABC123'],
    ['logs', 'run_ABC123'],
    ['logs', '--json', 'run_ABC123'],
    ['events', 'run_ABC123'],
    ['brake', 'on'],
    ['brake', 'off'],
    ['brake', 'status'],
    ['revert', 'run_ABC123'],
    ['update', '--to', '0.2.0'],
    ['backup', '--verify'],
    ['help'],
    ['version'],
  ];

  it('keeps the token and the bearer header out of stdout and stderr', async () => {
    const runner = runnerOf({
      code: 0,
      stdout: `script said ${TOKEN}`,
      stderr: `Authorization: Bearer ${TOKEN}`,
    });

    for (const argv of ARGVS) {
      for (const transport of [failingTransport(), echoingTransport()]) {
        const { io, out, err } = capture();
        const code = await run({
          argv,
          io,
          env: { CODEBOX_TOKEN: TOKEN },
          transport,
          runner,
        });
        const printed = [...out, ...err].join('\n');

        expect(code).toBeGreaterThanOrEqual(0);
        expect(printed).not.toContain(TOKEN);
        expect(printed).not.toContain('Bearer');
      }
    }
  });

  it('never puts the token in a request body or a URL', async () => {
    const harness = transportOf(successRoutes());

    for (const argv of ARGVS) {
      await run({
        argv,
        io: capture().io,
        env: { CODEBOX_TOKEN: TOKEN },
        transport: harness.transport,
      });
    }

    for (const request of harness.requests) {
      expect(request.path).not.toContain(TOKEN);
      expect(JSON.stringify(request.body ?? null)).not.toContain(TOKEN);
    }
  });

  it('reports a 401 without echoing the request', async () => {
    const { io, err } = capture();

    const code = await run({
      argv: ['status'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: transportOf({ 'GET /v1/health': UNAUTHORIZED }).transport,
    });

    expect(code).toBe(4);
    expect(err.join('\n')).toBe('unauthorized: Missing token (requestId req_ABC123)');
  });
});
