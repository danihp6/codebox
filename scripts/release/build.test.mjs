import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ARTIFACT_PREFIX,
  MANIFEST_NAME,
  artifactName,
  buildRelease,
  checksumName,
  manifestJson,
} from './build.mjs';

const cli = path.resolve(import.meta.dirname, 'build.mjs');
const fixture = path.resolve(import.meta.dirname, 'fixtures', 'stage');
const COMMIT = '0000000000000000000000000000000000000000';
const BUILT_AT = '2026-01-01T00:00:00Z';
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-build-'));
  tempDirs.push(dir);
  return dir;
}

/** The committed payload is read, never written: a build writes release.json into the stage. */
function stagedFixture() {
  const stage = path.join(tempDir(), 'stage');
  fs.cpSync(fixture, stage, { recursive: true });
  return stage;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function members(archive) {
  const result = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`);
  return result.stdout.split('\n').filter((line) => line !== '');
}

function extract(archive, member) {
  const result = spawnSync('tar', ['-xzOf', archive, member], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`);
  return result.stdout;
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

async function build(overrides = {}) {
  const out = path.join(tempDir(), 'out');
  const result = await buildRelease({
    stage: stagedFixture(),
    out,
    version: '0.0.0',
    builtAt: BUILT_AT,
    commit: COMMIT,
    ...overrides,
  });
  return { out, ...result };
}

describe('names and manifest', () => {
  it('names both files from the version, without a leading v', () => {
    expect(ARTIFACT_PREFIX).toBe('codebox-');
    expect(MANIFEST_NAME).toBe('release.json');
    expect(artifactName('0.1.0')).toBe('codebox-0.1.0.tar.gz');
    expect(checksumName('0.1.0')).toBe('codebox-0.1.0.tar.gz.sha256');
  });

  it('writes the manifest with the frozen key order and a trailing newline', () => {
    expect(manifestJson({ version: '0.1.0', commit: COMMIT, builtAt: BUILT_AT })).toBe(
      `{"version":"0.1.0","commit":"${COMMIT}","builtAt":"${BUILT_AT}"}\n`,
    );
    expect(manifestJson({ version: '0.1.0', commit: null, builtAt: BUILT_AT })).toBe(
      `{"version":"0.1.0","commit":null,"builtAt":"${BUILT_AT}"}\n`,
    );
  });
});

describe('buildRelease', () => {
  it('writes the artifact, its checksum and the manifest at the archive root', async () => {
    const result = await build();

    expect(result.archive).toBe(path.join(result.out, 'codebox-0.0.0.tar.gz'));
    expect(result.checksumFile).toBe(path.join(result.out, 'codebox-0.0.0.tar.gz.sha256'));
    expect(result.sha256).toBe(sha256(result.archive));
    expect(fs.readFileSync(result.checksumFile, 'utf8')).toBe(
      `${result.sha256}  codebox-0.0.0.tar.gz\n`,
    );
    expect(members(result.archive)).toContain('./release.json');
    expect(members(result.archive)).toContain('./apps/daemon/dist/main.js');
    expect(members(result.archive)).toContain('./app/index.html');
    expect(extract(result.archive, './release.json')).toBe(
      `{"version":"0.0.0","commit":"${COMMIT}","builtAt":"${BUILT_AT}"}\n`,
    );
  });

  it('removes release.json from the stage after the call', async () => {
    const stage = stagedFixture();

    await buildRelease({
      stage,
      out: path.join(tempDir(), 'out'),
      version: '0.0.0',
      builtAt: BUILT_AT,
      commit: COMMIT,
    });

    expect(fs.existsSync(path.join(stage, 'release.json'))).toBe(false);
  });

  it('sorts the archive entries by name', async () => {
    const result = await build();
    const names = members(result.archive);

    expect(names).toEqual([...names].sort());
    expect(names[0]).toBe('./');
  });

  it('is reproducible: two output directories, one sha256', async () => {
    const first = await build();
    const second = await build();

    expect(fs.readFileSync(first.archive).equals(fs.readFileSync(second.archive))).toBe(true);
    expect(first.sha256).toBe(second.sha256);
  });

  it('refuses a stage without the daemon entry point', async () => {
    const stage = stagedFixture();
    fs.rmSync(path.join(stage, 'apps/daemon/dist/main.js'));

    await expect(
      buildRelease({
        stage,
        out: path.join(tempDir(), 'out'),
        version: '0.0.0',
        builtAt: BUILT_AT,
      }),
    ).rejects.toThrow('apps/daemon/dist/main.js');
  });

  it('refuses a stage without the SPA', async () => {
    const stage = stagedFixture();
    fs.rmSync(path.join(stage, 'app/index.html'));

    await expect(
      buildRelease({
        stage,
        out: path.join(tempDir(), 'out'),
        version: '0.0.0',
        builtAt: BUILT_AT,
      }),
    ).rejects.toThrow('app/index.html');
  });
});

describe('build.mjs CLI', () => {
  it('builds the documented names from the committed fixture', () => {
    const out = path.join(tempDir(), 'out');
    const stage = stagedFixture();

    const result = run([
      '--stage',
      stage,
      '--out',
      out,
      '--version',
      '0.0.0',
      '--built-at',
      BUILT_AT,
      '--commit',
      COMMIT,
    ]);

    expect(result.status).toBe(0);
    expect(fs.readdirSync(out).sort()).toEqual([
      'codebox-0.0.0.tar.gz',
      'codebox-0.0.0.tar.gz.sha256',
    ]);
    expect(result.stdout).toContain(path.join(out, 'codebox-0.0.0.tar.gz'));
  });

  it('exits 3 naming package.json and both versions when the tag disagrees', () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.0.0"}\n');

    const result = run([
      '--stage',
      stagedFixture(),
      '--out',
      path.join(tempDir(), 'out'),
      '--version',
      '9.9.9',
      '--built-at',
      BUILT_AT,
      '--check-package-version',
      '--root',
      root,
    ]);

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('package.json');
    expect(result.stderr).toContain('0.0.0');
    expect(result.stderr).toContain('9.9.9');
  });

  it('passes --check-package-version when the tree and the tag agree', () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.1.0"}\n');

    const result = run([
      '--stage',
      stagedFixture(),
      '--out',
      path.join(tempDir(), 'out'),
      '--version',
      '0.1.0',
      '--built-at',
      BUILT_AT,
      '--check-package-version',
      '--root',
      root,
    ]);

    expect(result.status).toBe(0);
  });

  it('exits 4 when the stage is missing a required build output', () => {
    const stage = stagedFixture();
    fs.rmSync(path.join(stage, 'apps/daemon/dist/main.js'));

    const result = run([
      '--stage',
      stage,
      '--out',
      path.join(tempDir(), 'out'),
      '--version',
      '0.0.0',
      '--built-at',
      BUILT_AT,
    ]);

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('apps/daemon/dist/main.js');
  });

  it('exits 2 on an unknown flag, a missing flag and a bad --built-at', () => {
    const unknown = run(['--nonsense']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('unknown option');

    const missing = run(['--stage', stagedFixture()]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('required');

    const badTime = run([
      '--stage',
      stagedFixture(),
      '--out',
      path.join(tempDir(), 'out'),
      '--version',
      '0.0.0',
      '--built-at',
      'yesterday',
    ]);
    expect(badTime.status).toBe(2);
    expect(badTime.stderr).toContain('--built-at');
  });

  it('prints the usage on --help', () => {
    const result = run(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('usage: node scripts/release/build.mjs');
  });
});
