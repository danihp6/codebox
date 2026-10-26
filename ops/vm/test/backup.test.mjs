import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'backup.sh');

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

// An ambient runner credential must never reach a fixture server, so the AWS and Codebox
// families are dropped here and only a test adds them back.
function isolatedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CB_') || key.startsWith('OCI_') || key.startsWith('AWS_')) continue;
    if (key === 'ROOT') continue;
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

function run(args, env = isolatedEnv()) {
  return spawnSync('bash', [script, ...args], { env, encoding: 'utf8' });
}

// The fixture server lives in this process, so a run that talks to it has to spawn without
// blocking the event loop.
function runAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn('bash', [script, ...args], { env });
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

// The runner has no `age`: this passthrough copies its input to the -o target, for -r and -d
// alike, so the archive bytes are the tarball bytes either way. No key of any kind is needed.
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

function accessEnv(pathValue, extra = {}) {
  return {
    ...isolatedEnv(),
    AWS_ACCESS_KEY_ID: 'dummy-access-key-id',
    AWS_SECRET_ACCESS_KEY: 'dummy-access-key-secret',
    CB_BACKUP_AGE_RECIPIENT: 'age1dummyrecipient',
    PATH: pathValue,
    ...extra,
  };
}

// The smallest S3 surface the contract uses: PUT, GET, HEAD, DELETE and a list-type=2 page.
// Every request is recorded, so a test can prove the exact key, headers and body.
async function s3Fixture() {
  const objects = new Map();
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(request.url, 'http://127.0.0.1');
      requests.push({
        method: request.method,
        path: url.pathname,
        query: url.search,
        headers: request.headers,
        body,
      });
      if (url.searchParams.has('list-type')) {
        const prefix = url.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<ListBucketResult>',
          '<IsTruncated>false</IsTruncated>',
          ...keys.map((key) => `<Contents><Key>${key}</Key></Contents>`),
          '</ListBucketResult>',
        ].join('');
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(xml);
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
          response.writeHead(200, {
            'content-length': object.body.length,
            'content-type': 'application/octet-stream',
          });
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

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function archivePath(root) {
  const backups = path.join(root, 'var', 'lib', 'codebox', 'backups');
  const [name] = fs
    .readdirSync(backups)
    .filter((entry) => entry.endsWith('.age') || entry.endsWith('.tar.gz'));
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

describe('backup.sh --upload', () => {
  it('uploads the archive and the _latest pointer to the fixture endpoint', async () => {
    const root = fixtureRoot();
    const fixture = await s3Fixture();
    const age = fakeAge();

    const result = await runAsync(
      ['--root', root, '--recipient', 'age1dummyrecipient', '--upload'],
      accessEnv(age, {
        CB_BACKUP_S3_URI: 's3://cb-backups/cb',
        CB_BACKUP_S3_ENDPOINT: fixture.url,
      }),
    );

    expect(result.status).toBe(0);
    const [archiveLine, uploadedLine, ...rest] = result.stdout.split('\n');
    expect(rest).toEqual(['']);
    expect(uploadedLine).toMatch(/^uploaded cb\/db\/\d{4}\/\d{2}\/\d{2}\.age$/);
    const archive = archiveLine.replace('archive ', '');
    expect(archive).toMatch(/cb-backup-\d{8}T\d{6}Z\.age$/);
    const key = uploadedLine.replace('uploaded ', '');
    expect(key).toBe(`cb/db/${new Date().toISOString().slice(0, 10).replaceAll('-', '/')}.age`);

    const hex = sha256(archive);
    expect(fs.readFileSync(`${archive}.sha256`, 'utf8')).toBe(
      `${hex}  ${path.basename(archive)}\n`,
    );

    const put = fixture.requests.find(
      (entry) => entry.method === 'PUT' && entry.path === `/cb-backups/${key}`,
    );
    expect(put).toBeDefined();
    expect(put.body.equals(fs.readFileSync(archive))).toBe(true);
    expect(put.headers['x-amz-meta-sha256']).toBe(hex);
    expect(put.headers['content-length']).toBe(String(fs.statSync(archive).size));
    expect(put.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=dummy-access-key-id\/\d{8}\/eu-west-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
    );
    const signed = put.headers.authorization.split('SignedHeaders=')[1].split(',')[0].split(';');
    expect(signed).toContain('host');
    expect(signed).toContain('x-amz-content-sha256');
    expect(signed).toContain('x-amz-date');
    expect(signed).toContain('x-amz-meta-sha256');

    const pointer = fixture.objects.get('cb/_latest');
    expect(pointer.body.toString('utf8')).toBe(`${key}\n`);
    expect(
      fixture.requests.some(
        (entry) => entry.method === 'GET' && entry.path === '/cb-backups/cb/_latest',
      ),
    ).toBe(true);
  });

  it('keeps the local archive when the S3 target is missing', async () => {
    const root = fixtureRoot();
    const age = fakeAge();

    const result = await runAsync(
      ['--root', root, '--recipient', 'age1dummyrecipient', '--upload'],
      accessEnv(age),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CB_BACKUP_S3_URI is empty');
    const backups = path.join(root, 'var', 'lib', 'codebox', 'backups');
    expect(fs.readdirSync(backups).filter((entry) => entry.endsWith('.age'))).toHaveLength(1);
  });

  it('prunes to the thirty newest daily objects', async () => {
    const root = fixtureRoot();
    const fixture = await s3Fixture();
    for (let day = 1; day <= 35; day += 1) {
      const key = `cb/db/2026/01/${String(day).padStart(2, '0')}.age`;
      fixture.objects.set(key, { body: Buffer.from(key), sha256: '' });
    }
    fixture.objects.set('cb/db/notes.txt', { body: Buffer.from('keep me'), sha256: '' });
    fixture.objects.set('other/db/2000/01/01.age', { body: Buffer.from('not ours'), sha256: '' });
    const age = fakeAge();

    const result = await runAsync(
      ['--root', root, '--recipient', 'age1dummyrecipient', '--upload'],
      accessEnv(age, {
        CB_BACKUP_S3_URI: 's3://cb-backups/cb',
        CB_BACKUP_S3_ENDPOINT: fixture.url,
      }),
    );

    expect(result.status).toBe(0);
    const deleted = fixture.requests
      .filter((entry) => entry.method === 'DELETE')
      .map((entry) => entry.path.replace('/cb-backups/', ''));
    expect(deleted.sort()).toEqual([
      'cb/db/2026/01/01.age',
      'cb/db/2026/01/02.age',
      'cb/db/2026/01/03.age',
      'cb/db/2026/01/04.age',
      'cb/db/2026/01/05.age',
      'cb/db/2026/01/06.age',
    ]);
    expect(fixture.objects.has('cb/db/notes.txt')).toBe(true);
    expect(fixture.objects.has('other/db/2000/01/01.age')).toBe(true);
    expect(fixture.objects.has('cb/db/2026/01/35.age')).toBe(true);
  });

  it('refuses a key outside the target', () => {
    const result = run(['--fetch', '../x', '--s3-uri', 's3://cb-backups/cb'], accessEnv(fakeAge()));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('../x is not a valid object key');
  });
});
