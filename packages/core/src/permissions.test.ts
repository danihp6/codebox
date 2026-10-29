import { describe, expect, it } from 'vitest';
import {
  PERMISSION_MATRIX,
  classifyTool,
  decidePermission,
  isInsideWorktree,
} from './permissions.js';
import type { PermissionTool } from './permissions.js';

const WORKTREE = '/srv/codebox/worktrees/run_01J';

describe('permission policy', () => {
  it('carries the docs/agent-runtime.md §6 matrix with a single mode', () => {
    expect(PERMISSION_MATRIX).toEqual({
      run: {
        read: 'allow',
        edit: 'allow',
        bash: 'allow',
        webfetch: 'deny',
        other: 'deny',
      },
    });
    expect(Object.keys(PERMISSION_MATRIX)).toEqual(['run']);
    expect(Object.values(PERMISSION_MATRIX.run)).not.toContain('ask');
  });

  it('classifies tool names case-insensitively', () => {
    const cases: ReadonlyArray<readonly [string, PermissionTool]> = [
      ['read', 'read'],
      ['list', 'read'],
      ['glob', 'read'],
      ['grep', 'read'],
      ['lsp', 'read'],
      ['edit', 'edit'],
      ['write', 'edit'],
      ['patch', 'edit'],
      ['multiedit', 'edit'],
      ['apply_patch', 'edit'],
      ['bash', 'bash'],
      ['shell', 'bash'],
      ['terminal', 'bash'],
      ['webfetch', 'webfetch'],
      ['websearch', 'webfetch'],
      ['fetch', 'webfetch'],
      ['BASH', 'bash'],
      [' Apply_Patch ', 'edit'],
      ['routine.create', 'other'],
      ['routine.list', 'other'],
      ['routine.pause', 'other'],
      [' Routine.Pause ', 'other'],
      ['routine', 'other'],
      ['mcp__evil', 'other'],
      ['', 'other'],
    ];
    for (const [tool, expected] of cases) {
      expect(classifyTool(tool)).toBe(expected);
    }
  });

  it('compares worktree containment by path segment', () => {
    expect(isInsideWorktree(WORKTREE, WORKTREE)).toBe(true);
    expect(isInsideWorktree(`${WORKTREE}/src/index.ts`, WORKTREE)).toBe(true);
    expect(isInsideWorktree(`${WORKTREE}/src/index.ts`, `${WORKTREE}/`)).toBe(true);
    expect(isInsideWorktree('/srv/codebox/worktrees/run_01J-evil', WORKTREE)).toBe(false);
    expect(isInsideWorktree(`${WORKTREE}/../etc/passwd`, WORKTREE)).toBe(false);
    expect(isInsideWorktree('/srv/codebox/worktrees/run_02', WORKTREE)).toBe(false);
    expect(isInsideWorktree('/etc/passwd', WORKTREE)).toBe(false);
    expect(isInsideWorktree('src/index.ts', WORKTREE)).toBe(false);
    expect(isInsideWorktree(WORKTREE, '/')).toBe(false);
  });

  it('the permission policy fails closed', () => {
    const expected: Readonly<Record<PermissionTool, 'allow' | 'deny'>> = {
      read: 'allow',
      edit: 'allow',
      bash: 'allow',
      webfetch: 'deny',
      other: 'deny',
    };
    for (const [tool, decision] of Object.entries(expected)) {
      expect(decidePermission({ tool, mode: 'run', path: null, worktree: WORKTREE })).toBe(
        decision,
      );
      expect(
        decidePermission({
          tool,
          mode: 'run',
          path: `${WORKTREE}/src/index.ts`,
          worktree: WORKTREE,
        }),
      ).toBe(decision);
    }

    expect(
      decidePermission({ tool: 'edit', mode: 'run', path: `${WORKTREE}/a.ts`, worktree: WORKTREE }),
    ).toBe('allow');
    expect(
      decidePermission({ tool: 'bash', mode: 'run', path: `${WORKTREE}/a.ts`, worktree: WORKTREE }),
    ).toBe('allow');
    expect(
      decidePermission({ tool: 'webfetch', mode: 'run', path: null, worktree: WORKTREE }),
    ).toBe('deny');
    expect(
      decidePermission({ tool: 'edit', mode: 'run', path: '/etc/passwd', worktree: WORKTREE }),
    ).toBe('deny');
    expect(
      decidePermission({ tool: 'routine.create', mode: 'run', path: null, worktree: WORKTREE }),
    ).toBe('deny');

    for (const tool of ['webfetch', 'websearch', 'fetch', 'routine.evil', 'mcp__evil']) {
      expect(decidePermission({ tool, mode: 'run', path: null, worktree: WORKTREE })).toBe('deny');
      expect(
        decidePermission({ tool, mode: 'run', path: `${WORKTREE}/a.ts`, worktree: WORKTREE }),
      ).toBe('deny');
    }

    for (const tool of ['read', 'edit', 'bash', 'list', 'apply_patch']) {
      expect(decidePermission({ tool, mode: 'run', path: '/etc/passwd', worktree: WORKTREE })).toBe(
        'deny',
      );
      expect(
        decidePermission({
          tool,
          mode: 'run',
          path: '/srv/codebox/worktrees/run_01J-evil',
          worktree: WORKTREE,
        }),
      ).toBe('deny');
      expect(
        decidePermission({
          tool,
          mode: 'run',
          path: `${WORKTREE}/../etc/passwd`,
          worktree: WORKTREE,
        }),
      ).toBe('deny');
    }
  });

  it('denies the retired routine tools', () => {
    for (const tool of ['routine.create', 'routine.list', 'routine.pause', ' Routine.Pause ']) {
      expect(classifyTool(tool)).toBe('other');
      expect(decidePermission({ tool, mode: 'run', path: null, worktree: WORKTREE })).toBe('deny');
      expect(
        decidePermission({
          tool,
          mode: 'run',
          path: `${WORKTREE}/.codebox/schedule.yml`,
          worktree: WORKTREE,
        }),
      ).toBe('deny');
    }
  });
});
