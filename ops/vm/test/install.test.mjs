import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'install.sh');

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

function artifact(dir, { entry = true } = {}) {
  const staging = path.join(dir, 'staging');
  fs.mkdirSync(path.join(staging, 'apps', 'daemon', 'dist'), { recursive: true });
  if (entry) fs.writeFileSync(path.join(staging, 'apps', 'daemon', 'dist', 'main.js'), '// cbd\n');
  const file = path.join(dir, 'codebox.tar.gz');
  const result = spawnSync('tar', ['-czf', file, '-C', staging, '.'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`);
  return file;
}

function run(args) {
  return spawnSync('bash', [script, ...args], { env: isolatedEnv(), encoding: 'utf8' });
}

function releases(root, version) {
  return path.join(root, 'opt', 'codebox', 'releases', version);
}

describe('install.sh', () => {
  it('refuses a checksum mismatch before creating anything', () => {
    const dir = tempDir();
    const root = tempDir();
    const file = artifact(dir);

    const result = run([
      '--artifact',
      file,
      '--version',
      '0.1.0',
      '--sha256',
      'deadbeef',
      '--root',
      root,
      '--no-restart',
    ]);

    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/checksum mismatch: [0-9a-f]{64} != deadbeef/);
    expect(fs.existsSync(path.join(root, 'opt', 'codebox', 'releases'))).toBe(false);
  });

  it('refuses an artifact with no apps/daemon/dist/main.js and removes the release', () => {
    const dir = tempDir();
    const root = tempDir();
    const file = artifact(dir, { entry: false });

    const result = run([
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

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('artifact has no apps/daemon/dist/main.js');
    expect(fs.existsSync(releases(root, '0.1.0'))).toBe(false);
  });

  it('exits 2 with the usage line when a required flag is missing', () => {
    const dir = tempDir();
    const root = tempDir();
    const file = artifact(dir);

    const result = run(['--artifact', file, '--version', '0.1.0', '--root', root, '--no-restart']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: install.sh');
    expect(result.stderr).toContain('sha256 is empty');
    expect(fs.existsSync(path.join(root, 'opt'))).toBe(false);
  });

  it('exits 2 on an unknown flag', () => {
    const result = run(['--nonsense']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: install.sh');
  });

  it('unpacks a release, prints installed and points current at it', () => {
    const dir = tempDir();
    const root = tempDir();
    const file = artifact(dir);

    const result = run([
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
    expect(result.stdout).toBe(`installed 0.1.0 ${releases(root, '0.1.0')}\n`);
    expect(fs.existsSync(path.join(releases(root, '0.1.0'), 'apps/daemon/dist/main.js'))).toBe(
      true,
    );
    expect(fs.readlinkSync(path.join(root, 'opt/codebox/current'))).toBe('releases/0.1.0');
    expect(fs.existsSync(path.join(root, 'opt/codebox/previous'))).toBe(false);
  });

  it('reuses an installed version and leaves previous alone', () => {
    const dir = tempDir();
    const root = tempDir();
    const file = artifact(dir);
    const sha = sha256(file);
    const install = (version) =>
      run([
        '--artifact',
        file,
        '--version',
        version,
        '--sha256',
        sha,
        '--root',
        root,
        '--no-restart',
      ]);

    expect(install('0.1.0').status).toBe(0);
    expect(install('0.2.0').status).toBe(0);
    expect(fs.readlinkSync(path.join(root, 'opt/codebox/previous'))).toBe('releases/0.1.0');

    const again = install('0.2.0');

    expect(again.status).toBe(0);
    expect(again.stderr).toContain('reuse');
    expect(again.stderr).not.toContain('checksum');
    expect(fs.readlinkSync(path.join(root, 'opt/codebox/current'))).toBe('releases/0.2.0');
    expect(fs.readlinkSync(path.join(root, 'opt/codebox/previous'))).toBe('releases/0.1.0');
  });

  it('prints the usage on --help without touching the host', () => {
    const result = run(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('usage: install.sh');
  });
});
