import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildRelease } from './build.mjs';

const upgrade = path.resolve(import.meta.dirname, '..', '..', 'ops', 'vm', 'upgrade.sh');
const BUILT_AT = '2026-01-01T00:00:00Z';
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-upgrade-'));
  tempDirs.push(dir);
  return dir;
}

/** The two entries `install.sh` needs, and nothing else. */
function stage() {
  const dir = path.join(tempDir(), 'stage');
  fs.mkdirSync(path.join(dir, 'apps', 'daemon', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps', 'daemon', 'dist', 'main.js'), '// cbd\n');
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'index.html'), '<!doctype html>\n');
  return dir;
}

function isolatedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CB_') || key.startsWith('OCI_') || key === 'ROOT') continue;
    env[key] = value;
  }
  return env;
}

function run(args) {
  return spawnSync('bash', [upgrade, ...args], { env: isolatedEnv(), encoding: 'utf8' });
}

function current(root) {
  return fs.readlinkSync(path.join(root, 'opt', 'codebox', 'current'));
}

describe('upgrade.sh', () => {
  it('upgrade.sh refuses a checksum mismatch', async () => {
    const source = stage();
    const first = await buildRelease({
      stage: source,
      out: path.join(tempDir(), 'releases'),
      version: '0.0.0',
      builtAt: BUILT_AT,
      commit: null,
    });
    const second = await buildRelease({
      stage: source,
      out: path.join(tempDir(), 'releases'),
      version: '0.1.0',
      builtAt: BUILT_AT,
      commit: null,
    });
    const root = tempDir();

    const installed = run([
      '--artifact',
      first.archive,
      '--version',
      '0.0.0',
      '--sha256',
      first.sha256,
      '--root',
      root,
      '--no-restart',
    ]);
    expect(installed.status).toBe(0);
    expect(current(root)).toBe('releases/0.0.0');

    const corrupted = `${second.sha256[0] === '0' ? '1' : '0'}${second.sha256.slice(1)}`;
    const refused = run([
      '--artifact',
      second.archive,
      '--version',
      '0.1.0',
      '--sha256',
      corrupted,
      '--root',
      root,
      '--no-restart',
    ]);

    expect(refused.status).toBe(3);
    expect(refused.stderr).toContain('checksum mismatch');
    expect(current(root)).toBe('releases/0.0.0');
    expect(current(root).endsWith('releases/0.0.0')).toBe(true);
    expect(fs.existsSync(path.join(root, 'opt', 'codebox', 'releases', '0.1.0'))).toBe(false);

    const upgraded = run([
      '--artifact',
      second.archive,
      '--version',
      '0.1.0',
      '--sha256',
      second.sha256,
      '--root',
      root,
      '--no-restart',
    ]);
    expect(upgraded.status).toBe(0);
    expect(current(root)).toBe('releases/0.1.0');

    const rolled = run(['--rollback', '--root', root]);
    expect(rolled.status).toBe(0);
    expect(rolled.stdout).toBe('rolled back to 0.0.0\n');
    expect(current(root)).toBe('releases/0.0.0');
  }, 120_000);
});
