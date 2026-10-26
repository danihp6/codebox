import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'restore.sh');
const backup = path.resolve(import.meta.dirname, '..', 'backup.sh');

const tempDirs = [];
const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
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
    if (key.startsWith('CB_') || key.startsWith('OCI_') || key.startsWith('AWS_')) continue;
    if (key === 'ROOT') continue;
    env[key] = value;
  }
  return env;
}

function run(binary, args, env = isolatedEnv()) {
  return spawnSync('bash', [binary, ...args], { env, encoding: 'utf8' });
}

// The fixture server lives in this process, so a run that talks to it has to spawn without
// blocking the event loop.
function runAsync(binary, args, env) {
  return new Promise((resolve) => {
    const child = spawn('bash', [binary, ...args], { env });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) =>
      resolve({ status, stdout: Buffer.concat(chunks).toString('utf8'), stderr }),
    );
  });
}

// A passthrough `age`, for -r and -d alike: the runner has no `age` and no key, and the archive
// bytes are the tarball bytes either way.
function fakeAge() {
  const dir = tempDir();
  const file = path.join(dir, 'age');
  fs.writeFileSync(
    file,
    [
      '#!/usr/bin/env bash',
      'target=',
      'source=',
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    -o) target=$2; shift 2 ;;',
      '    -r|-i) shift 2 ;;',
      '    -d) shift ;;',
      '    *) source=$1; shift ;;',
      '  esac',
      'done',
      'cp "$source" "$target"',
      '',
    ].join('\n'),
  );
  fs.chmodSync(file, 0o755);
  return `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
}

// The four methods a restore exercises through backup.sh: PUT, GET, HEAD and the list page of
// the prune that follows an upload.
async function s3Fixture() {
  const objects = new Map();
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(request.url, 'http://127.0.0.1');
      requests.push({ method: request.method, path: url.pathname, headers: request.headers });
      if (url.searchParams.has('list-type')) {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
        return;
      }
      const key = url.pathname
        .split('/')
        .filter((segment) => segment !== '')
        .slice(1)
        .map((segment) => decodeURIComponent(segment))
        .join('/');
      switch (request.method) {
        case 'PUT':
          objects.set(key, { body, sha256: request.headers['x-amz-meta-sha256'] });
          response.writeHead(200);
          response.end();
          return;
        case 'GET': {
          const object = objects.get(key);
          if (!object) {
            response.writeHead(404);
            response.end();
            return;
          }
          response.writeHead(200, { 'content-length': object.body.length });
          response.end(object.body);
          return;
        }
        case 'HEAD': {
          const object = objects.get(key);
          if (!object) {
            response.writeHead(404);
            response.end();
            return;
          }
          const headers = { 'content-length': object.body.length };
          if (object.sha256) headers['x-amz-meta-sha256'] = object.sha256;
          response.writeHead(200, headers);
          response.end();
          return;
        }
        case 'DELETE':
          objects.delete(key);
          response.writeHead(204);
          response.end();
          return;
        default:
          response.writeHead(405);
          response.end();
      }
    });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, objects, requests };
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

describe('restore.sh from the target', () => {
  it('restores the newest object through _latest', async () => {
    const fixture = await s3Fixture();
    const env = {
      ...isolatedEnv(),
      AWS_ACCESS_KEY_ID: 'dummy-access-key-id',
      AWS_SECRET_ACCESS_KEY: 'dummy-access-key-secret',
      CB_BACKUP_S3_ENDPOINT: fixture.url,
      PATH: fakeAge(),
    };
    const source = tempDir();
    seedDatabase(path.join(source, 'var', 'lib', 'codebox', 'state.db'));
    const upload = await runAsync(
      backup,
      ['--root', source, '--recipient', 'age1dummyrecipient', '--upload'],
      { ...env, CB_BACKUP_S3_URI: 's3://cb-backups/cb' },
    );
    expect(upload.status).toBe(0);

    const root = tempDir();
    const db = path.join(root, 'var', 'lib', 'codebox', 'state.db');
    const result = await runAsync(
      script,
      [
        '--latest',
        '--root',
        root,
        '--s3-uri',
        's3://cb-backups/cb',
        '--identity',
        path.join(tempDir(), 'identity.key'),
      ],
      env,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`restored ${db} runs=3 jobs=2 routines=1\n`);
    expect(
      fixture.requests.some(
        (entry) => entry.method === 'GET' && entry.path === '/cb-backups/cb/_latest',
      ),
    ).toBe(true);
  });

  it('restores a named object from the target', async () => {
    const fixture = await s3Fixture();
    const env = {
      ...isolatedEnv(),
      AWS_ACCESS_KEY_ID: 'dummy-access-key-id',
      AWS_SECRET_ACCESS_KEY: 'dummy-access-key-secret',
      CB_BACKUP_S3_ENDPOINT: fixture.url,
      PATH: fakeAge(),
    };
    const source = tempDir();
    seedDatabase(path.join(source, 'var', 'lib', 'codebox', 'state.db'));
    const upload = await runAsync(
      backup,
      ['--root', source, '--recipient', 'age1dummyrecipient', '--upload'],
      { ...env, CB_BACKUP_S3_URI: 's3://cb-backups/cb' },
    );
    expect(upload.status).toBe(0);
    const key = upload.stdout
      .split('\n')
      .find((line) => line.startsWith('uploaded '))
      .replace('uploaded ', '');

    const root = tempDir();
    const db = path.join(root, 'var', 'lib', 'codebox', 'state.db');
    const result = await runAsync(
      script,
      ['--remote', key, '--root', root, '--s3-uri', 's3://cb-backups/cb', '--identity', 'unused'],
      env,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`restored ${db} runs=3 jobs=2 routines=1\n`);
  });

  it('refuses a remote restore without a target', () => {
    const result = run(script, ['--latest']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CB_BACKUP_S3_URI is empty');
  });
});
