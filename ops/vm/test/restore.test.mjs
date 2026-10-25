import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'restore.sh');
const backup = path.resolve(import.meta.dirname, '..', 'backup.sh');

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

function run(binary, args) {
  return spawnSync('bash', [binary, ...args], { env: isolatedEnv(), encoding: 'utf8' });
}

function seedDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE runs (id TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE routines (id TEXT PRIMARY KEY)');
  for (const id of ['r1', 'r2', 'r3']) db.prepare('INSERT INTO runs VALUES (?)').run(id);
  for (const id of ['j1', 'j2']) db.prepare('INSERT INTO jobs VALUES (?)').run(id);
  db.prepare('INSERT INTO routines VALUES (?)').run('c1');
  db.close();
}

function sourceArchive() {
  const source = tempDir();
  seedDatabase(path.join(source, 'var', 'lib', 'codebox', 'state.db'));
  const result = run(backup, ['--root', source, '--plaintext']);
  if (result.status !== 0) throw new Error(`backup failed: ${result.stderr}`);
  const backups = path.join(source, 'var', 'lib', 'codebox', 'backups');
  const [name] = fs.readdirSync(backups);
  return path.join(backups, name);
}

describe('restore.sh', () => {
  it('refuses an existing database without --force and leaves it untouched', () => {
    const archive = sourceArchive();
    const root = tempDir();
    const db = path.join(root, 'var', 'lib', 'codebox', 'state.db');
    fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.writeFileSync(db, 'the database that is already there\n');

    const result = run(script, ['--from', archive, '--root', root, '--plaintext']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${db} exists, use --force`);
    expect(fs.readFileSync(db, 'utf8')).toBe('the database that is already there\n');
  });

  it('restores into an empty root and reports the same row counts', () => {
    const archive = sourceArchive();
    const root = tempDir();
    const db = path.join(root, 'var', 'lib', 'codebox', 'state.db');

    const result = run(script, ['--from', archive, '--root', root, '--plaintext']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`restored ${db} runs=3 jobs=2 routines=1\n`);

    const again = run(backup, ['--root', root, '--plaintext']);
    expect(again.status).toBe(0);
    const verified = run(backup, ['--root', root, '--verify', '--plaintext']);
    expect(verified.status).toBe(0);
    expect(verified.stdout).toBe('verify ok runs=3 jobs=2 routines=1\n');
  });

  it('--verify reads the archive without writing the database', () => {
    const archive = sourceArchive();
    const root = tempDir();
    const db = path.join(root, 'var', 'lib', 'codebox', 'state.db');

    const result = run(script, ['--from', archive, '--root', root, '--plaintext', '--verify']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('verify ok runs=3 jobs=2 routines=1\n');
    expect(fs.existsSync(db)).toBe(false);
  });

  it('overwrites an existing database with --force', () => {
    const archive = sourceArchive();
    const root = tempDir();
    const db = path.join(root, 'var', 'lib', 'codebox', 'state.db');
    fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.writeFileSync(db, 'stale\n');

    const result = run(script, ['--from', archive, '--root', root, '--plaintext', '--force']);

    expect(result.status).toBe(0);
    const restored = new DatabaseSync(db, { readOnly: true });
    const rows = restored.prepare('SELECT count(*) AS n FROM runs').get();
    restored.close();
    expect(rows.n).toBe(3);
  });

  it('exits 6 on a corrupt archive and leaves the target alone', () => {
    const root = tempDir();
    const archive = path.join(tempDir(), 'bad.tar.gz');
    fs.writeFileSync(archive, 'this is not a tarball\n');

    const result = run(script, ['--from', archive, '--root', root, '--plaintext']);

    expect(result.status).toBe(6);
    expect(fs.existsSync(path.join(root, 'var'))).toBe(false);
  });

  it('exits 6 when the archive has no state.db', () => {
    const dir = tempDir();
    const payload = tempDir();
    fs.writeFileSync(path.join(payload, 'other.txt'), 'nothing here\n');
    const archive = path.join(dir, 'no-db.tar.gz');
    const tar = spawnSync('tar', ['-czf', archive, '-C', payload, 'other.txt'], {
      encoding: 'utf8',
    });
    expect(tar.status).toBe(0);
    const root = tempDir();

    const result = run(script, ['--from', archive, '--root', root, '--plaintext']);

    expect(result.status).toBe(6);
  });

  it('exits 2 without --from', () => {
    const result = run(script, []);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: restore.sh');
  });
});
