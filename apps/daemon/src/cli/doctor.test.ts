import { describe, expect, it } from 'vitest';
import type { Health, Providers, Telemetry } from '@codebox/contracts';
import { CHECK_NAMES, doctorChecks, formatDoctor } from './doctor.js';
import { run } from './main.js';
import type { CliIo } from './main.js';
import { TransportError } from './transport.js';
import type { CliRequest, CliResponse, CliTransport } from './transport.js';

const NOT_FOUND: CliResponse = {
  status: 404,
  body: {
    error: { code: 'not_found', message: 'Not found', requestId: 'req_ABC123' },
  },
};

const HEALTHY: Health = {
  status: 'ok',
  db: 'ok',
  opencode: 'ok',
  disk: { freeBytes: 4_000, totalBytes: 10_000, usedPercent: 40 },
  queue: { pending: 0, running: 0, maxConcurrency: 2 },
  version: '0.0.0',
};

const PROVIDERS: Providers = {
  providers: [
    { provider: 'github', configured: true, mode: 'app', lastOkAt: null, fingerprint: '1234' },
  ],
};

const TELEMETRY: Telemetry = {
  range: '24h',
  since: '2026-10-24T18:03:11Z',
  spendUsd: 1.84,
  runs: { total: 3, succeeded: 2, failed: 1, cancelled: 0 },
  disk: HEALTHY.disk,
  queueDepth: 0,
};

interface Routes {
  readonly health?: CliResponse | (() => Promise<CliResponse>);
  readonly providers?: CliResponse;
  readonly telemetry?: CliResponse;
}

function fakeTransport(routes: Routes = {}): CliTransport {
  return {
    async send(request: CliRequest): Promise<CliResponse> {
      const route = request.path;
      if (route === '/v1/health') {
        if (typeof routes.health === 'function') return await routes.health();
        return routes.health ?? { status: 200, body: HEALTHY };
      }
      if (route === '/v1/providers') return routes.providers ?? { status: 200, body: PROVIDERS };
      if (route === '/v1/telemetry') return routes.telemetry ?? { status: 200, body: TELEMETRY };
      return NOT_FOUND;
    },
  };
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

const NOW = (): Date => new Date('2026-10-25T00:00:00Z');
const TOKEN = 'cb-doctor-token';

function downHealth(): Health {
  return {
    status: 'down',
    db: 'down',
    opencode: 'ok',
    disk: { freeBytes: 1, totalBytes: 100, usedPercent: 91 },
    queue: { pending: 1, running: 2, maxConcurrency: 2 },
    version: '0.0.0',
  };
}

describe('doctor', () => {
  it('reports exactly eight checks in the documented order', async () => {
    const transport = fakeTransport({
      health: { status: 503, body: downHealth() },
      providers: NOT_FOUND,
      telemetry: NOT_FOUND,
    });

    const report = await doctorChecks(transport, { now: NOW, token: TOKEN });

    expect(report.checks).toHaveLength(8);
    expect(report.checks.map((check) => check.name)).toEqual([...CHECK_NAMES]);
    expect(report.checks.map((check) => check.name)).toEqual([
      'db',
      'opencode',
      'tunnel',
      'github',
      'disk',
      'queue',
      'cost',
      'backup',
    ]);
    expect(formatDoctor(report)).toHaveLength(8);
    expect(report.ok).toBe(false);
  });

  it('marks db and disk as fail when the daemon says so', async () => {
    const transport = fakeTransport({
      health: { status: 503, body: downHealth() },
      providers: NOT_FOUND,
      telemetry: NOT_FOUND,
    });

    const report = await doctorChecks(transport, { now: NOW, token: TOKEN });
    const lines = formatDoctor(report);
    const db = lines.find((line) => line.startsWith('db'));
    const disk = lines.find((line) => line.startsWith('disk'));

    expect(db).toBe('db           fail   health.db = down');
    expect(db).toMatch(/^db\s+fail\b/);
    expect(disk).toMatch(/^disk\s+fail\b/);
    expect(lines.filter((line) => line.includes('fail'))).toHaveLength(3);
  });

  it('says ok for a healthy box and never fails a warn', async () => {
    const report = await doctorChecks(fakeTransport(), { now: NOW, token: TOKEN });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.status)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'skip',
    ]);
  });

  it('skips the routes that do not exist yet instead of failing them', async () => {
    const report = await doctorChecks(
      fakeTransport({ providers: NOT_FOUND, telemetry: NOT_FOUND }),
      { now: NOW, token: TOKEN },
    );
    const byName = new Map(report.checks.map((check) => [check.name, check]));

    expect(byName.get('github')).toEqual({
      name: 'github',
      status: 'skip',
      detail: 'missing_route',
    });
    expect(byName.get('cost')).toEqual({ name: 'cost', status: 'skip', detail: 'missing_route' });
    expect(byName.get('backup')).toEqual({
      name: 'backup',
      status: 'skip',
      detail: 'missing_route',
    });
    expect(report.ok).toBe(true);
  });

  it('warns for a github provider that is not configured', async () => {
    const report = await doctorChecks(
      fakeTransport({
        providers: {
          status: 200,
          body: {
            providers: [
              {
                provider: 'github',
                configured: false,
                mode: 'none',
                lastOkAt: null,
                fingerprint: null,
              },
            ],
          },
        },
      }),
      { now: NOW, token: TOKEN },
    );
    const github = report.checks.find((check) => check.name === 'github');

    expect(github?.status).toBe('warn');
    expect(report.ok).toBe(true);
  });

  it('applies the disk, queue and cost thresholds', async () => {
    const at = async (usedPercent: number, running: number, spendUsd: number): Promise<string[]> =>
      (
        await doctorChecks(
          fakeTransport({
            health: {
              status: 200,
              body: {
                ...HEALTHY,
                disk: { ...HEALTHY.disk, usedPercent },
                queue: { pending: 0, running, maxConcurrency: 2 },
              },
            },
            telemetry: { status: 200, body: { ...TELEMETRY, spendUsd } },
          }),
          { now: NOW, token: TOKEN },
        )
      ).checks.map((check) => `${check.name}:${check.status}`);

    expect(await at(69.9, 1, 9.99)).toEqual(
      expect.arrayContaining(['disk:ok', 'queue:ok', 'cost:ok']),
    );
    expect(await at(70, 2, 10)).toEqual(
      expect.arrayContaining(['disk:warn', 'queue:warn', 'cost:warn']),
    );
    expect(await at(85, 2, 20)).toEqual(
      expect.arrayContaining(['disk:fail', 'queue:warn', 'cost:fail']),
    );
  });

  it('names the URL it reached in the tunnel detail', async () => {
    const transport: CliTransport & { readonly baseUrl: string } = {
      ...fakeTransport(),
      baseUrl: 'http://127.0.0.1:8787',
    };

    const report = await doctorChecks(transport, { now: NOW, token: TOKEN });
    const tunnel = report.checks.find((check) => check.name === 'tunnel');

    expect(tunnel?.detail).toContain('http://127.0.0.1:8787');
  });

  it('renders the documented line format', () => {
    const lines = formatDoctor({
      checks: [
        { name: 'db', status: 'ok', detail: 'wal, 4 tables' },
        { name: 'opencode', status: 'warn', detail: 'health.opencode = degraded' },
      ],
      ok: true,
    });

    expect(lines).toEqual([
      'db           ok     wal, 4 tables',
      'opencode     warn   health.opencode = degraded',
    ]);
  });

  it('exits 1 with one line per failed check', async () => {
    const { io, out, err } = capture();
    const code = await run({
      argv: ['doctor'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: fakeTransport({
        health: { status: 503, body: downHealth() },
        providers: NOT_FOUND,
        telemetry: NOT_FOUND,
      }),
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(8);
    expect(out.filter((line) => /^db\s+fail\b/.test(line))).toHaveLength(1);
    expect(err).toEqual([]);
  });

  it('exits 0 for a healthy box', async () => {
    const { io } = capture();
    const code = await run({
      argv: ['doctor'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: fakeTransport(),
    });

    expect(code).toBe(0);
  });

  it('prints one JSON line under --json', async () => {
    const { io, out } = capture();
    const code = await run({
      argv: ['doctor', '--json'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: fakeTransport({ providers: NOT_FOUND, telemetry: NOT_FOUND }),
    });

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const parsed: unknown = JSON.parse(out[0] ?? '');
    expect(parsed).toEqual({
      checks: expect.any(Array) as unknown,
      ok: true,
    });
    expect((parsed as { checks: unknown[] }).checks).toHaveLength(8);
  });

  it('stops with exit 3 when the daemon cannot be reached', async () => {
    const { io, err } = capture();
    const code = await run({
      argv: ['doctor'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: {
        send: (): Promise<CliResponse> => Promise.reject(new TransportError('unreachable', 'nope')),
      },
    });

    expect(code).toBe(3);
    expect(err.join('\n')).toContain('daemon unreachable');
  });

  it('exits 4 on a 401 from the health route', async () => {
    const { io, err } = capture();
    const code = await run({
      argv: ['doctor'],
      io,
      env: { CODEBOX_TOKEN: TOKEN },
      transport: fakeTransport({
        health: {
          status: 401,
          body: {
            error: { code: 'unauthorized', message: 'Missing token', requestId: 'req_ABC123' },
          },
        },
      }),
    });

    expect(code).toBe(4);
    expect(err.join('\n')).toContain('unauthorized: Missing token (requestId req_ABC123)');
  });
});
