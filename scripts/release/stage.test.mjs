import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stagePlan, stageRelease } from './stage.mjs';

const cli = path.resolve(import.meta.dirname, 'stage.mjs');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-stage-'));
  tempDirs.push(dir);
  return dir;
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A workspace with the two build outputs stageRelease requires, plus sources it must ignore. */
function workspace({ nodeModules = true } = {}) {
  const root = tempDir();
  write(root, 'apps/daemon/dist/main.js', '// cbd\n');
  write(root, 'apps/daemon/bin/cb.mjs', '#!/usr/bin/env node\n');
  write(root, 'apps/daemon/package.json', '{"name":"@codebox/daemon"}\n');
  write(root, 'apps/daemon/src/main.ts', 'export {};\n');
  write(root, 'packages/core/dist/index.js', 'export {};\n');
  write(root, 'packages/core/package.json', '{"name":"@codebox/core"}\n');
  write(root, 'packages/core/src/index.ts', 'export {};\n');
  write(root, 'apps/app/dist/browser/index.html', '<!doctype html>\n');
  write(root, 'apps/app/src/main.ts', 'export {};\n');
  write(root, 'coverage/report.html', '<!doctype html>\n');
  write(root, 'package.json', '{"name":"codebox","version":"0.0.0"}\n');
  if (nodeModules) {
    write(root, 'node_modules/hono/package.json', '{"name":"hono"}\n');
    fs.mkdirSync(path.join(root, 'node_modules', '@codebox'), { recursive: true });
    fs.symlinkSync('../../packages/core', path.join(root, 'node_modules', '@codebox', 'core'));
  }
  return root;
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

describe('stagePlan', () => {
  it('is the frozen order, with node_modules and the SPA renamed to app', () => {
    const root = workspace();

    expect(stagePlan(root)).toEqual([
      { from: 'apps/daemon/dist', to: 'apps/daemon/dist' },
      { from: 'apps/daemon/bin', to: 'apps/daemon/bin' },
      { from: 'apps/daemon/package.json', to: 'apps/daemon/package.json' },
      { from: 'packages/core/dist', to: 'packages/core/dist' },
      { from: 'packages/core/package.json', to: 'packages/core/package.json' },
      { from: 'apps/app/dist/browser', to: 'app' },
      { from: 'node_modules', to: 'node_modules' },
      { from: 'package.json', to: 'package.json' },
    ]);
  });

  it('skips node_modules when the tree has none', () => {
    const plan = stagePlan(workspace({ nodeModules: false }));

    expect(plan.map((entry) => entry.to)).toEqual([
      'apps/daemon/dist',
      'apps/daemon/bin',
      'apps/daemon/package.json',
      'packages/core/dist',
      'packages/core/package.json',
      'app',
      'package.json',
    ]);
  });
});

describe('stageRelease', () => {
  it('copies the payload, keeps symlinks and never copies src, coverage or .agent_specs', async () => {
    const root = workspace();
    write(root, '.agent_specs/task-29.md', 'spec\n');
    const out = path.join(tempDir(), 'payload');

    const result = await stageRelease({ root, out });

    expect(fs.existsSync(path.join(out, 'apps/daemon/dist/main.js'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'apps/daemon/bin/cb.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'app/index.html'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'packages/core/dist/index.js'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'apps/daemon/src'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'packages/core/src'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'coverage'))).toBe(false);
    expect(fs.existsSync(path.join(out, '.agent_specs'))).toBe(false);

    const link = path.join(out, 'node_modules/@codebox/core');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe('../../packages/core');
    expect(path.resolve(path.dirname(link), fs.readlinkSync(link))).toBe(
      path.join(out, 'packages/core'),
    );
    expect(fs.existsSync(path.join(link, 'dist/index.js'))).toBe(true);
    expect(result.files).toBe(8);
  });

  it('replaces a previous payload instead of merging with it', async () => {
    const root = workspace({ nodeModules: false });
    const out = path.join(tempDir(), 'payload');
    write(out, 'stale.txt', 'old\n');

    await stageRelease({ root, out });

    expect(fs.existsSync(path.join(out, 'stale.txt'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'apps/daemon/dist/main.js'))).toBe(true);
  });

  it('exits 4 and names the missing build output', () => {
    const root = workspace();
    fs.rmSync(path.join(root, 'apps/app/dist'), { recursive: true });

    const result = run(['--root', root, '--out', path.join(tempDir(), 'payload')]);

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('apps/app/dist/browser/index.html');
  });
});

describe('stage.mjs CLI', () => {
  it('stages a tree and prints the file count', () => {
    const root = workspace({ nodeModules: false });
    const out = path.join(tempDir(), 'payload');

    const result = run(['--root', root, '--out', out]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`staged 7 files into ${out}\n`);
  });

  it('accepts --flag=value', () => {
    const root = workspace({ nodeModules: false });
    const out = path.join(tempDir(), 'payload');

    const result = run([`--root=${root}`, `--out=${out}`]);

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(out, 'app/index.html'))).toBe(true);
  });

  it('exits 2 on an unknown flag and on a missing --out', () => {
    expect(run(['--nonsense']).status).toBe(2);
    expect(run(['--nonsense']).stderr).toContain('unknown option');
    expect(run([]).status).toBe(2);
    expect(run([]).stderr).toContain('--out is required');
  });

  it('prints the usage on --help without writing anything', () => {
    const result = run(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('usage: node scripts/release/stage.mjs');
  });
});
