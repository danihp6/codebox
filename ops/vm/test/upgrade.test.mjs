import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'upgrade.sh');
const install = path.resolve(import.meta.dirname, '..', 'install.sh');

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-vm-'));
  tempDirs.push(dir);
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

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function artifact(dir) {
  const staging = path.join(dir, 'staging');
  fs.mkdirSync(path.join(staging, 'apps', 'daemon', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'apps', 'daemon', 'dist', 'main.js'), '// cbd\n');
  const file = path.join(dir, 'codebox.tar.gz');
  const result = spawnSync('tar', ['-czf', file, '-C', staging, '.'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`);
  return file;
}

function run(binary, args) {
  return spawnSync('bash', [binary, ...args], { env: isolatedEnv(), encoding: 'utf8' });
}

function installVersion(root, file, version) {
  return run(install, [
    '--artifact',
    file,
    '--version',
    version,
    '--sha256',
    sha256(file),
    '--root',
    root,
    '--no-restart',
  ]);
}

function link(root, name) {
  return fs.readlinkSync(path.join(root, 'opt', 'codebox', name));
}

describe('upgrade.sh', () => {
  it('rolls back to nothing: exit 5 and no change', () => {
    const root = tempDir();

    const result = run(script, ['--rollback', '--root', root]);

    expect(result.status).toBe(5);
    expect(result.stderr).toContain('no previous release');
    expect(fs.existsSync(path.join(root, 'opt'))).toBe(false);
  });

  it('installs through install.sh when no rollback is asked for', () => {
    const dir = tempDir();
    const root = tempDir();
    const file = artifact(dir);

    const result = run(script, [
      '--artifact',
      file,
      '--version',
      '0.1.0',
      '--sha256',
      sha256(file),
      '--root',
      root,
      '--no-restart',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('installed 0.1.0');
    expect(link(root, 'current')).toBe('releases/0.1.0');
  });

  it('swaps current back to the previous release and twice returns', () => {
    const dir = tempDir();
    const root = tempDir();
    const file = artifact(dir);

    expect(installVersion(root, file, '0.1.0').status).toBe(0);
    expect(installVersion(root, file, '0.2.0').status).toBe(0);
    expect(link(root, 'current')).toBe('releases/0.2.0');
    expect(link(root, 'previous')).toBe('releases/0.1.0');

    const first = run(script, ['--rollback', '--root', root]);

    expect(first.status).toBe(0);
    expect(first.stdout).toBe('rolled back to 0.1.0\n');
    expect(link(root, 'current')).toBe('releases/0.1.0');
    expect(link(root, 'previous')).toBe('releases/0.2.0');

    const second = run(script, ['--rollback', '--root', root]);

    expect(second.status).toBe(0);
    expect(second.stdout).toBe('rolled back to 0.2.0\n');
    expect(link(root, 'current')).toBe('releases/0.2.0');
  });

  it('refuses a dangling previous link with exit 5', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'opt', 'codebox'), { recursive: true });
    fs.symlinkSync('releases/0.9.9', path.join(root, 'opt', 'codebox', 'previous'));

    const result = run(script, ['--rollback', '--root', root]);

    expect(result.status).toBe(5);
    expect(result.stderr).toContain('no previous release');
  });

  it('prunes all but the two newest releases after a successful upgrade', () => {
    const dir = tempDir();
    const root = tempDir();
    const file = artifact(dir);

    for (const version of ['0.1.0', '0.2.0', '0.3.0']) {
      expect(installVersion(root, file, version).status).toBe(0);
    }

    const result = run(script, [
      '--artifact',
      file,
      '--version',
      '0.4.0',
      '--sha256',
      sha256(file),
      '--root',
      root,
      '--no-restart',
      '--prune',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('prune');
    const releases = path.join(root, 'opt', 'codebox', 'releases');
    expect(fs.readdirSync(releases).sort()).toEqual(['0.3.0', '0.4.0']);
  });

  it('exits 2 with the usage line when neither an artifact nor --rollback is given', () => {
    const result = run(script, []);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: upgrade.sh');
    expect(result.stderr).toContain('artifact is empty');
  });
});
