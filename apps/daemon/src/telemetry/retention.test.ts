import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodeboxConfig } from '@codebox/contracts';
import { loadConfig } from '../config.js';
import { pruneLogDirectories, retentionCutoffs } from './retention.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const AT = new Date('2026-10-25T12:00:00.000Z');
const DAY_MS = 86_400_000;

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cb-27-retention-'));
  directories.push(directory);
  return directory;
}

function config(overrides: Record<string, string> = {}): CodeboxConfig {
  return loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    ...overrides,
  });
}

function age(path: string, days: number): void {
  const at = new Date(AT.getTime() - days * DAY_MS);
  utimesSync(path, at, at);
}

describe('retentionCutoffs', () => {
  it('derives the five cutoffs from the shipped defaults', () => {
    expect(retentionCutoffs(AT, config())).toEqual({
      runs: '2026-07-27T12:00:00.000Z',
      events: '2026-10-11T12:00:00.000Z',
      chats: '2026-07-27T12:00:00.000Z',
      approvals: '2026-10-18T12:00:00.000Z',
      logs: '2026-09-25T12:00:00.000Z',
    });
  });

  it('follows the five CB_RETENTION_*_DAYS values', () => {
    const cutoffs = retentionCutoffs(
      AT,
      config({
        CB_RETENTION_RUNS_DAYS: '1',
        CB_RETENTION_EVENTS_DAYS: '2',
        CB_RETENTION_CHAT_DAYS: '3',
        CB_RETENTION_APPROVALS_DAYS: '4',
        CB_RETENTION_LOGS_DAYS: '5',
      }),
    );
    expect(cutoffs).toEqual({
      runs: '2026-10-24T12:00:00.000Z',
      events: '2026-10-23T12:00:00.000Z',
      chats: '2026-10-22T12:00:00.000Z',
      approvals: '2026-10-21T12:00:00.000Z',
      logs: '2026-10-20T12:00:00.000Z',
    });
  });
});

describe('pruneLogDirectories', () => {
  it('removes only the stale run log directories', () => {
    const root = temporaryDirectory();
    const logs = join(root, 'logs');
    mkdirSync(logs, { recursive: true });
    const stale = join(logs, 'run-run_01JABCDEF');
    const fresh = join(logs, 'run-run_01JFRESH');
    const other = join(logs, 'keepalive');
    mkdirSync(stale);
    mkdirSync(fresh);
    mkdirSync(other);
    writeFileSync(join(stale, 'gate.log'), 'gate output');
    writeFileSync(join(logs, 'keepalive.jsonl'), '{}\n');
    age(stale, 40);
    age(fresh, 1);
    age(other, 40);

    expect(pruneLogDirectories(logs, '2026-09-25T12:00:00.000Z')).toBe(1);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(join(logs, 'keepalive.jsonl'))).toBe(true);
  });

  it('keeps a directory whose mtime equals the cutoff', () => {
    const root = temporaryDirectory();
    const logs = join(root, 'logs');
    mkdirSync(logs, { recursive: true });
    const entry = join(logs, 'run-run_01JBOUNDARY');
    mkdirSync(entry);
    age(entry, 30);

    expect(pruneLogDirectories(logs, '2026-09-25T12:00:00.000Z')).toBe(0);
    expect(existsSync(entry)).toBe(true);
    expect(statSync(entry).isDirectory()).toBe(true);
  });

  it('returns 0 for a missing directory and never throws', () => {
    const root = temporaryDirectory();
    expect(pruneLogDirectories(join(root, 'absent'), '2026-09-25T12:00:00.000Z')).toBe(0);
    expect(pruneLogDirectories(join(root, 'absent'), 'not-a-date')).toBe(0);
  });

  it('never follows a symlink out of the log directory', () => {
    const root = temporaryDirectory();
    const logs = join(root, 'logs');
    const outside = join(root, 'outside');
    mkdirSync(logs, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, 'kept.txt'), 'kept');
    age(outside, 400);
    const link = join(logs, 'run-run_01JSYMLINK');
    let linked = true;
    try {
      symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      linked = false;
    }
    age(logs, 400);

    expect(pruneLogDirectories(logs, '2026-09-25T12:00:00.000Z')).toBe(0);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(join(outside, 'kept.txt'))).toBe(true);
    if (linked) expect(existsSync(link)).toBe(true);
  });
});
