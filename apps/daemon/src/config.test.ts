import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContractParseError } from '@codebox/contracts';
import type { ConfigInput } from '@codebox/contracts';
import {
  describeConfigFailure,
  ensureDirectories,
  loadConfig,
  parseBind,
  readBuildInfo,
  resolvePaths,
} from './config.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

function baseEnv(overrides: ConfigInput = {}): ConfigInput {
  return { CB_ENV: 'test', CB_SESSION_SECRET: SESSION_SECRET, ...overrides };
}

function failureOf(input: ConfigInput): {
  readonly error: ContractParseError;
  readonly raw: string;
} {
  try {
    loadConfig(input);
  } catch (error) {
    if (error instanceof ContractParseError) return { error, raw: JSON.stringify(error.issues) };
    throw error;
  }
  throw new Error('loadConfig accepted an invalid input');
}

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cb-11-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('loadConfig', () => {
  it('applies the documented defaults once the session secret is set', () => {
    const config = loadConfig(baseEnv());
    expect(config.CB_LOG_LEVEL).toBe('info');
    expect(config.CB_BIND).toBe('127.0.0.1:8787');
    expect(config.CB_INSTANCE_NAME).toBe('cb-instance');
    expect(config.CB_STATE_DIR).toBe('/var/lib/codebox');
    expect(config.CB_TMP_DIR).toBe('/var/tmp/codebox');
    expect(config.CB_INSTALL_DIR).toBe('/opt/codebox');
    expect(config.CB_OPENCODE_HEALTH_PATH).toBe('/api/info');
    expect(config.CB_MAX_CONCURRENCY).toBe(2);
    expect(config.CB_COMMIT).toBeNull();
  });

  it('throws a ContractParseError and never exits the process', () => {
    expect(() => loadConfig({ CB_ENV: 'test' })).toThrow(ContractParseError);
  });
});

describe('describeConfigFailure', () => {
  it('reports a missing secret by key and fixed phrase', () => {
    const input: ConfigInput = { CB_ENV: 'test' };
    const { error } = failureOf(input);
    const failure = describeConfigFailure(error, input);
    expect(failure.missing).toEqual(['CB_SESSION_SECRET']);
    expect(failure.invalid).toEqual([]);
    expect(failure.messages).toEqual(['CB_SESSION_SECRET is required']);
  });

  it('reports a short secret as invalid without echoing its value', () => {
    const input: ConfigInput = { CB_ENV: 'test', CB_SESSION_SECRET: 'too-short' };
    const { error, raw } = failureOf(input);
    const failure = describeConfigFailure(error, input);
    expect(failure.invalid).toEqual(['CB_SESSION_SECRET']);
    expect(failure.missing).toEqual([]);
    expect(failure.messages).toEqual(['CB_SESSION_SECRET is invalid']);
    expect(JSON.stringify(failure)).not.toContain('too-short');
    expect(raw).not.toContain('too-short');
  });

  it('names an unknown configuration key', () => {
    const input = baseEnv({ CB_NOPE: '1' });
    const { error } = failureOf(input);
    const failure = describeConfigFailure(error, input);
    expect(failure.invalid).toEqual(['CB_NOPE']);
    expect(failure.messages).toEqual(['CB_NOPE is not a known configuration key']);
  });

  it('sorts and de-duplicates the messages', () => {
    const input = baseEnv({ CB_LOG_LEVEL: 'shout', CB_ENV: 'mars' });
    const { error } = failureOf(input);
    const failure = describeConfigFailure(error, input);
    expect([...failure.invalid]).toEqual(['CB_ENV', 'CB_LOG_LEVEL']);
    expect([...failure.messages]).toEqual(['CB_ENV is invalid', 'CB_LOG_LEVEL is invalid']);
  });
});

describe('parseBind', () => {
  it('splits host and port', () => {
    expect(parseBind('127.0.0.1:8787')).toEqual({ hostname: '127.0.0.1', port: 8787 });
    expect(parseBind('127.0.0.1:0')).toEqual({ hostname: '127.0.0.1', port: 0 });
    expect(parseBind('localhost:65535')).toEqual({ hostname: 'localhost', port: 65535 });
  });

  it('strips the brackets around an IPv6 host', () => {
    expect(parseBind('[::1]:8787')).toEqual({ hostname: '::1', port: 8787 });
  });

  it('throws on an unparseable value', () => {
    expect(() => parseBind('nonsense')).toThrow();
    expect(() => parseBind('127.0.0.1:')).toThrow();
    expect(() => parseBind('127.0.0.1:65536')).toThrow();
    expect(() => parseBind('127.0.0.1:port')).toThrow();
    expect(() => parseBind(':8787')).toThrow();
  });
});

describe('resolvePaths', () => {
  it('derives every state path from CB_STATE_DIR', () => {
    const config = loadConfig(baseEnv({ CB_STATE_DIR: '/srv/cb', CB_TMP_DIR: '/srv/tmp' }));
    expect(resolvePaths(config)).toEqual({
      stateDir: '/srv/cb',
      tmpDir: '/srv/tmp',
      dbFile: '/srv/cb/state.db',
      locksDir: '/srv/cb/locks',
      daemonFile: '/srv/cb/daemon.json',
    });
  });
});

describe('ensureDirectories', () => {
  it('creates the state and lock directories with mode 0750 and is idempotent', () => {
    const root = temporaryDirectory();
    const config = loadConfig(baseEnv({ CB_STATE_DIR: join(root, 'state') }));
    const paths = resolvePaths(config);
    ensureDirectories(paths);
    ensureDirectories(paths);
    expect(statSync(paths.stateDir).isDirectory()).toBe(true);
    expect(statSync(paths.locksDir).isDirectory()).toBe(true);
    expect(statSync(paths.stateDir).mode & 0o777).toBe(0o750);
    expect(statSync(paths.locksDir).mode & 0o777).toBe(0o750);
  });
});

describe('readBuildInfo', () => {
  it('reads the daemon version and carries the configured commit', () => {
    expect(readBuildInfo(loadConfig(baseEnv()))).toEqual({
      version: '0.0.0',
      commit: null,
      builtAt: null,
    });
    expect(readBuildInfo(loadConfig(baseEnv({ CB_COMMIT: 'abc1234' }))).commit).toBe('abc1234');
  });
});
