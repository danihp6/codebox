import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as workspaces from './index.js';
import { WorkspaceError, createWorkspaceManager } from './index.js';
import type { GitResult, GitRunner, WorkspaceManagerOptions } from './index.js';

const NOOP_GIT: GitRunner = {
  async run(): Promise<GitResult> {
    return { code: 0, stdout: '', stderr: '' };
  },
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cb-ws-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function options(overrides: Partial<WorkspaceManagerOptions> = {}): WorkspaceManagerOptions {
  return {
    repoRoot: join(root, 'repos'),
    workspaceRoot: join(root, 'worktrees'),
    git: NOOP_GIT,
    matchesGlob: () => false,
    cloneDepth: 0,
    httpTimeoutSeconds: 120,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('the public surface', () => {
  it('re-exports exactly the frozen runtime names once', () => {
    expect(Object.keys(workspaces).sort()).toEqual(
      [
        'BRANCH_PREFIX',
        'GIT_ENV',
        'RUN_MARKER_FILENAME',
        'SLUG_MAX_LENGTH',
        'WorkspaceError',
        'branchName',
        'buildRunDiff',
        'clonePath',
        'createGitRunner',
        'createWorkspaceManager',
        'parseNameStatus',
        'parseNumstat',
        'slugifyTitle',
        'worktreePath',
      ].sort(),
    );
  });

  it('returns a manager with every documented method', () => {
    const manager = createWorkspaceManager(options());
    for (const method of [
      'ensureClone',
      'createWorktree',
      'removeWorktree',
      'listWorktrees',
      'status',
      'readRunMarker',
      'writeRunMarker',
      'cleanup',
      'diskUsage',
    ] as const) {
      expect(typeof manager[method]).toBe('function');
    }
  });

  it('refuses a relative repo root', () => {
    const error = (() => {
      try {
        createWorkspaceManager(options({ repoRoot: 'srv/repos' }));
        return null;
      } catch (caught) {
        return caught as WorkspaceError;
      }
    })();
    expect(error?.code).toBe('invalid_root');
  });

  it('refuses a relative workspace root', () => {
    expect(() => createWorkspaceManager(options({ workspaceRoot: 'worktrees' }))).toThrow(
      WorkspaceError,
    );
  });

  it('refuses roots nested inside each other', () => {
    expect(() =>
      createWorkspaceManager(options({ workspaceRoot: join(root, 'repos', 'worktrees') })),
    ).toThrow(WorkspaceError);
    expect(() =>
      createWorkspaceManager(options({ repoRoot: join(root, 'worktrees', 'repos') })),
    ).toThrow(WorkspaceError);
    expect(() => createWorkspaceManager(options({ workspaceRoot: join(root, 'repos') }))).toThrow(
      WorkspaceError,
    );
  });

  it('accepts two disjoint absolute roots', () => {
    expect(() => createWorkspaceManager(options())).not.toThrow();
  });

  it('accepts sibling roots whose names share a prefix', () => {
    expect(() =>
      createWorkspaceManager(
        options({ repoRoot: join(root, 'repos'), workspaceRoot: join(root, 'repos2') }),
      ),
    ).not.toThrow();
  });
});
