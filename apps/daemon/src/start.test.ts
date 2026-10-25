import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContractParseError, parseHealth, parseVersion } from '@codebox/contracts';
import { loadConfig } from './config.js';
import { runMain, startDaemon } from './main.js';
import type { DaemonHandle, MainIo } from './main.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const INDEX = '<!doctype html><title>cb</title>';

const temporaryDirectories: string[] = [];
const handles: DaemonHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop('test-teardown');
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cb-11-start-'));
  temporaryDirectories.push(directory);
  return directory;
}

interface Capture {
  readonly io: MainIo;
  readonly out: string[];
  readonly err: string[];
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line: string): void => {
        out.push(line);
      },
      err: (line: string): void => {
        err.push(line);
      },
    },
  };
}

function onlyLine(lines: readonly string[]): Record<string, unknown> {
  expect(lines).toHaveLength(1);
  const parsed: unknown = JSON.parse(lines[0] ?? '');
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

function liveEnv(root: string): NodeJS.ProcessEnv {
  return {
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_BIND: '127.0.0.1:0',
    CB_STATE_DIR: join(root, 'state'),
    CB_INSTALL_DIR: join(root, 'install'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    CB_LOG_LEVEL: 'debug',
  };
}

function installApp(root: string): string {
  const appDir = join(root, 'install', 'app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'index.html'), INDEX);
  return appDir;
}

describe('runMain — configuration', () => {
  it('fails fast on a missing required key without echoing a value', async () => {
    const { io, out, err } = capture();
    expect(await runMain({ env: {}, io })).toBe(1);
    expect(out).toEqual([]);
    const line = onlyLine(err);
    expect(line).toMatchObject({ level: 'fatal', msg: 'config_invalid' });
    expect(typeof line['ts']).toBe('string');
    expect(line['missing']).toContain('CB_SESSION_SECRET');
    expect(line['messages']).toContain('CB_SESSION_SECRET is required');
  });

  it('reports a short secret as invalid and never prints it', async () => {
    const { io, out, err } = capture();
    expect(await runMain({ env: { CB_ENV: 'test', CB_SESSION_SECRET: 'too-short' }, io })).toBe(1);
    const line = onlyLine(err);
    expect(line['msg']).toBe('config_invalid');
    expect(line['invalid']).toContain('CB_SESSION_SECRET');
    expect(line['messages']).toContain('CB_SESSION_SECRET is invalid');
    expect(err.join('\n')).not.toContain('too-short');
    expect(out.join('\n')).not.toContain('too-short');
  });

  it('rejects an unknown configuration key by name', async () => {
    const { io, err } = capture();
    const env: NodeJS.ProcessEnv = {
      CB_ENV: 'test',
      CB_SESSION_SECRET: SESSION_SECRET,
      CB_NOPE: '1',
    };
    expect(await runMain({ env, io })).toBe(1);
    const line = onlyLine(err);
    expect(line['msg']).toBe('config_invalid');
    expect(line['messages']).toContain('CB_NOPE is not a known configuration key');
  });

  it('leaves the exit code to the caller: loadConfig throws and never exits', () => {
    expect(() => loadConfig({})).toThrow(ContractParseError);
  });
});

describe('startDaemon', () => {
  it('serves health, version and the built app on the ephemeral port it reports', async () => {
    const root = temporaryRoot();
    installApp(root);
    const lines: string[] = [];
    const handle = await startDaemon({ env: liveEnv(root), sink: (line) => lines.push(line) });
    handles.push(handle);

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.hostname).toBe('127.0.0.1');
    expect(handle.report.failed).toEqual([]);
    expect(handle.report.absent).toHaveLength(10);
    expect(handle.report.loaded).toEqual(['auth']);

    const daemonFile = join(root, 'state', 'daemon.json');
    expect(existsSync(daemonFile)).toBe(true);
    const written: unknown = JSON.parse(readFileSync(daemonFile, 'utf8'));
    expect(written).toMatchObject({
      pid: process.pid,
      port: handle.port,
      hostname: '127.0.0.1',
      version: '0.0.0',
      startedAt: expect.any(String),
    });

    const listening = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line['msg'] === 'listening');
    expect(listening).toHaveLength(1);
    expect(listening[0]).toMatchObject({ port: handle.port, hostname: '127.0.0.1' });

    const base = `http://127.0.0.1:${handle.port}`;
    const health = await fetch(`${base}/v1/health`);
    expect(health.status).toBe(200);
    const healthBody: unknown = await health.json();
    expect(() => parseHealth(healthBody)).not.toThrow();
    expect((healthBody as { db: string }).db).toBe('ok');

    const version = await fetch(`${base}/v1/version`);
    expect(version.status).toBe(200);
    const versionBody: unknown = await version.json();
    expect(() => parseVersion(versionBody)).not.toThrow();
    expect((versionBody as { node: string }).node).toBe(process.version);

    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toBe(INDEX);

    const missing = await fetch(`${base}/v1/nope`);
    expect(missing.status).toBe(401);
    const missingBody: unknown = await missing.json();
    expect(missingBody).toMatchObject({ error: { code: 'unauthorized' } });

    await handle.stop('test');
    handles.length = 0;
    expect(existsSync(daemonFile)).toBe(false);
  });

  it('is idempotent on stop', async () => {
    const root = temporaryRoot();
    installApp(root);
    const handle = await startDaemon({ env: liveEnv(root), sink: () => undefined });
    await handle.stop('first');
    await handle.stop('second');
    expect(existsSync(join(root, 'state', 'daemon.json'))).toBe(false);
  });

  it('rejects when the state directory cannot be created', async () => {
    const root = temporaryRoot();
    const blocker = join(root, 'blocker');
    writeFileSync(blocker, 'not a directory');
    await expect(
      startDaemon({ env: { ...liveEnv(root), CB_STATE_DIR: join(blocker, 'state') } }),
    ).rejects.toThrow();
  });
});
