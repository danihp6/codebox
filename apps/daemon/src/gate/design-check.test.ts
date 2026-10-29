import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { snapshotHash } from '@codebox/design';
import { GIT_ENV } from '@codebox/workspaces';
import type { GitCommandInput, GitRunner } from '@codebox/workspaces';
import {
  DESIGN_CHECK_MAX_BYTES,
  DesignScanError,
  formatDesignFinding,
  scanDesign,
} from './design-check.js';
import type { DesignScanIo } from './design-check.js';

const BASE_SHA = 'a'.repeat(40);
const INPUT = { cwd: '/srv/codebox/worktrees/run_1', baseSha: BASE_SHA, timeoutMs: 30_000 };

const FIXTURES = new URL('../../../../packages/design/src/fixtures/', import.meta.url);

function fixture(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, FIXTURES)), 'utf8');
}

interface Calls {
  readonly calls: GitCommandInput[];
}

function runner(result: { code: number; stdout: string; stderr: string }): GitRunner & Calls {
  const calls: GitCommandInput[] = [];
  return {
    calls,
    run(input): Promise<{ code: number; stdout: string; stderr: string }> {
      calls.push(input);
      return Promise.resolve(result);
    },
  };
}

interface StubIo extends DesignScanIo {
  readonly reads: string[];
}

function stub(
  files: Readonly<Record<string, string>>,
  dirs: Readonly<Record<string, string[]>> = {},
): StubIo {
  const reads: string[] = [];
  return {
    reads,
    readFile(path: string): Promise<string> {
      reads.push(path);
      const content = files[path];
      if (content === undefined) return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(content);
    },
    readDir(path: string): Promise<readonly string[]> {
      const entries = dirs[path];
      if (entries === undefined) return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(entries);
    },
  };
}

function designFiles(): Record<string, string> {
  return {
    'design/tokens.json': fixture('tokens.json'),
    'design/routes.json': fixture('routes.json'),
    'design/screens/dashboard.json': fixture('screens/dashboard.json'),
    'design/screens/repo-backlog.json': fixture('screens/repo-backlog.json'),
  };
}

const SCREENS_DIR = {
  'design/screens': ['repo-backlog.json', 'dashboard.json'],
};

describe('scanDesign', () => {
  it('reads one diff against the recorded base, with the git allowlist environment', async () => {
    const git = runner({ code: 0, stdout: fixture('patch/clean.patch'), stderr: '' });

    const outcome = await scanDesign(git, { ...INPUT, io: stub(designFiles(), SCREENS_DIR) });

    expect(git.calls).toEqual([
      {
        args: ['diff', '--no-color', '--unified=0', '--no-ext-diff', BASE_SHA, '--'],
        cwd: INPUT.cwd,
        timeoutMs: 30_000,
        env: GIT_ENV,
      },
    ]);
    expect(git.calls[0]?.env).toBe(GIT_ENV);
    expect(outcome).toEqual({ findings: [], skipped: false, oversized: false });
  });

  it('fails a hardcoded colour outside tokens with its file and line', async () => {
    const git = runner({ code: 0, stdout: fixture('patch/colour-outside.patch'), stderr: '' });

    const outcome = await scanDesign(git, {
      ...INPUT,
      io: stub({
        'design/tokens.json': fixture('tokens.json'),
        'design/routes.json': '{"routes":[]}',
      }),
    });

    expect(outcome.findings[0]).toMatchObject({
      file: 'apps/app/src/theme/extra.css',
      line: 3,
      rule: 'colour_outside_tokens',
    });
    const finding = outcome.findings[0];
    if (finding === undefined) throw new Error('expected one finding');
    expect(formatDesignFinding(finding)).toBe(
      'apps/app/src/theme/extra.css:3 colour_outside_tokens',
    );
    expect(outcome.findings).toHaveLength(1);
  });

  it('accepts a token literal and a line marked codebox-design: allow', async () => {
    const git = runner({ code: 0, stdout: fixture('patch/clean.patch'), stderr: '' });

    const outcome = await scanDesign(git, { ...INPUT, io: stub(designFiles(), SCREENS_DIR) });

    expect(outcome.findings).toEqual([]);
  });

  it('is skipped when design/tokens.json is absent', async () => {
    const git = runner({ code: 0, stdout: fixture('patch/clean.patch'), stderr: '' });

    const outcome = await scanDesign(git, { ...INPUT, io: stub({}) });

    expect(outcome).toEqual({ findings: [], skipped: true, oversized: false });
  });

  it('fails closed when git cannot produce the diff', async () => {
    const git = runner({ code: 1, stdout: '', stderr: 'fatal: bad revision' });

    await expect(scanDesign(git, INPUT)).rejects.toBeInstanceOf(DesignScanError);
    await expect(scanDesign(git, INPUT)).rejects.toMatchObject({ code: 'git_failed' });
  });

  it('fails closed when the token document does not parse', async () => {
    const git = runner({ code: 0, stdout: '', stderr: '' });
    const io = stub({ 'design/tokens.json': '{"color": "red"}' });

    await expect(scanDesign(git, { ...INPUT, io })).rejects.toMatchObject({ code: 'git_failed' });
  });

  it('reports an oversized patch and never reads it', async () => {
    const git = runner({ code: 0, stdout: 'x'.repeat(DESIGN_CHECK_MAX_BYTES + 1), stderr: '' });
    const io = stub(designFiles(), SCREENS_DIR);

    const outcome = await scanDesign(git, { ...INPUT, io });

    expect(outcome).toEqual({ findings: [], skipped: false, oversized: true });
    expect(io.reads).toEqual([]);
    expect(DESIGN_CHECK_MAX_BYTES).toBe(4_194_304);
  });

  it('reports a snapshot hash that does not match its export', async () => {
    const declared = 'b'.repeat(64);
    const io = stub(
      {
        'design/tokens.json': fixture('tokens.json'),
        'design/routes.json': '{"routes":[]}',
        'design/screens/dashboard.json': JSON.stringify({
          screen: 'Dashboard',
          route: '/dashboard',
          states: { loading: 'x', empty: 'y', error: 'z' },
          snapshotSha256: declared,
        }),
        'design/exports/dashboard.png': 'not the exported bytes',
      },
      { 'design/screens': ['dashboard.json'] },
    );

    const outcome = await scanDesign(runner({ code: 0, stdout: '', stderr: '' }), {
      ...INPUT,
      io,
    });

    expect(outcome.findings).toEqual([
      {
        file: 'design/screens/dashboard.json',
        line: 1,
        rule: 'snapshot_hash_mismatch',
        message: 'snapshot hash does not match the export',
      },
    ]);
  });

  it('passes a snapshot hash that matches its export', async () => {
    const exported = 'the exported bytes';
    const declared = snapshotHash(new TextEncoder().encode(exported));
    const io = stub(
      {
        'design/tokens.json': fixture('tokens.json'),
        'design/routes.json': '{"routes":[]}',
        'design/screens/dashboard.json': JSON.stringify({
          screen: 'Dashboard',
          route: '/dashboard',
          states: { loading: 'x', empty: 'y', error: 'z' },
          snapshotSha256: declared,
        }),
        'design/exports/dashboard.png': exported,
      },
      { 'design/screens': ['dashboard.json'] },
    );

    const outcome = await scanDesign(runner({ code: 0, stdout: '', stderr: '' }), {
      ...INPUT,
      io,
    });

    expect(outcome.findings).toEqual([]);
  });

  it('reads the design documents and the export, and nothing else', async () => {
    const io = stub(designFiles(), SCREENS_DIR);

    await scanDesign(runner({ code: 0, stdout: '', stderr: '' }), { ...INPUT, io });

    expect(io.reads).toEqual([
      'design/tokens.json',
      'design/routes.json',
      'design/screens/dashboard.json',
      'design/screens/repo-backlog.json',
    ]);
  });
});
