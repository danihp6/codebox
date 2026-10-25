import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'backup.sh');

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

// The rows are the point: --verify has to read them off the restored database, not off a file
// size.
function fixtureRoot() {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'etc', 'codebox'), { recursive: true });
  fs.mkdirSync(path.join(root, 'var', 'lib', 'codebox'), { recursive: true });
  const db = new DatabaseSync(path.join(root, 'var', 'lib', 'codebox', 'state.db'));
  db.exec('CREATE TABLE runs (id TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE routines (id TEXT PRIMARY KEY)');
  for (const id of ['r1', 'r2', 'r3']) db.prepare('INSERT INTO runs VALUES (?)').run(id);
  for (const id of ['j1', 'j2']) db.prepare('INSERT INTO jobs VALUES (?)').run(id);
  db.prepare('INSERT INTO routines VALUES (?)').run('c1');
  db.close();
  fs.writeFileSync(
    path.join(root, 'etc', 'codebox', 'instance.env'),
    [
      'CB_ENV=production',
      'CB_PUBLIC_URL=https://cb.example.com',
      'CB_SESSION_SECRET=dummy-session-secret-value',
      'CB_TUNNEL_TOKEN=dummy-tunnel-token-value',
      'CB_GITHUB_TOKEN=dummy-github-token-value',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, 'etc', 'codebox', 'image.json'),
    JSON.stringify({ version: '0.1.0', commit: '0000000', builtAt: '2026-10-25T00:00:00Z' }),
  );
  return root;
}

function run(args) {
  return spawnSync('bash', [script, ...args], { env: isolatedEnv(), encoding: 'utf8' });
}

function archivePath(root) {
  const backups = path.join(root, 'var', 'lib', 'codebox', 'backups');
  const [name] = fs.readdirSync(backups);
  return { dir: backups, file: path.join(backups, name), name };
}

describe('backup.sh', () => {
  it('writes a plaintext archive with exactly the three members', () => {
    const root = fixtureRoot();

    const result = run(['--root', root, '--plaintext']);

    expect(result.status).toBe(0);
    const { file, name } = archivePath(root);
    expect(result.stdout).toBe(`archive ${file}\n`);
    expect(name).toMatch(/^cb-backup-\d{8}T\d{6}Z\.tar\.gz$/);

    const listed = spawnSync('tar', ['-tzf', file], { encoding: 'utf8' });
    expect(
      listed.stdout
        .split('\n')
        .filter((line) => line !== '')
        .sort(),
    ).toEqual(['instance.env', 'manifest.json', 'state.db']);
  });

  it('redacts the secret keys and keeps the rest of instance.env', () => {
    const root = fixtureRoot();
    expect(run(['--root', root, '--plaintext']).status).toBe(0);

    const { file } = archivePath(root);
    const extracted = tempDir();
    const untar = spawnSync('tar', ['-xzf', file, '-C', extracted, 'instance.env'], {
      encoding: 'utf8',
    });
    expect(untar.status).toBe(0);
    const env = fs.readFileSync(path.join(extracted, 'instance.env'), 'utf8');

    expect(env).toContain('CB_SESSION_SECRET=[redacted]');
    expect(env).toContain('CB_TUNNEL_TOKEN=[redacted]');
    expect(env).toContain('CB_GITHUB_TOKEN=[redacted]');
    expect(env).toContain('CB_PUBLIC_URL=https://cb.example.com');
    expect(env).not.toContain('dummy-session-secret-value');
    expect(env).not.toContain('dummy-tunnel-token-value');
    expect(env).not.toContain('dummy-github-token-value');
  });

  it('writes a manifest with the image version, the size and encrypted=false', () => {
    const root = fixtureRoot();
    expect(run(['--root', root, '--plaintext']).status).toBe(0);

    const { file } = archivePath(root);
    const extracted = tempDir();
    spawnSync('tar', ['-xzf', file, '-C', extracted, 'manifest.json'], { encoding: 'utf8' });
    const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'manifest.json'), 'utf8'));

    expect(manifest.version).toBe('0.1.0');
    expect(manifest.encrypted).toBe(false);
    expect(manifest.dbBytes).toBeGreaterThan(0);
    expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('verifies the newest archive and prints the row counts', () => {
    const root = fixtureRoot();
    expect(run(['--root', root, '--plaintext']).status).toBe(0);

    const result = run(['--root', root, '--verify', '--plaintext']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('verify ok runs=3 jobs=2 routines=1\n');
  });

  it('exits 6 when there is no database', () => {
    const root = tempDir();

    const result = run(['--root', root, '--plaintext']);

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('no database at');
  });

  it('exits 2 when it cannot encrypt and no recipient is given', () => {
    const root = fixtureRoot();

    const result = run(['--root', root]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CB_BACKUP_AGE_RECIPIENT is empty');
    expect(fs.existsSync(path.join(root, 'var', 'lib', 'codebox', 'backups'))).toBe(false);
  });

  it('logs the plaintext warning on stderr', () => {
    const root = fixtureRoot();

    const result = run(['--root', root, '--plaintext']);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('warn: plaintext backup');
  });
});
