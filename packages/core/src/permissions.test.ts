import { describe, expect, it } from 'vitest';
import {
  PERMISSION_MATRIX,
  classifyTool,
  decidePermission,
  isInsideWorktree,
} from './permissions.js';
import type { PermissionDecision, PermissionMode, PermissionTool } from './permissions.js';

const WORKTREE = '/srv/codebox/worktrees/run_01J';

describe('permission policy', () => {
  it('carries the docs/agent-runtime.md §6 matrix', () => {
    expect(PERMISSION_MATRIX).toEqual({
      chat: {
        read: 'allow',
        edit: 'ask',
        bash: 'ask',
        webfetch: 'deny',
        routine: 'allow',
        other: 'deny',
      },
      run: {
        read: 'allow',
        edit: 'allow',
        bash: 'allow',
        webfetch: 'deny',
        routine: 'deny',
        other: 'deny',
      },
    });
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
      ['routine.create', 'routine'],
      ['routine.list', 'routine'],
      ['routine.pause', 'routine'],
      [' Routine.Pause ', 'routine'],
      ['routine.evil', 'other'],
      ['routine.', 'other'],
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
    const modes: readonly PermissionMode[] = ['chat', 'run'];
    const expected: Readonly<
      Record<Exclude<PermissionTool, 'routine'>, readonly [PermissionDecision, PermissionDecision]>
    > = {
      read: ['allow', 'allow'],
      edit: ['ask', 'allow'],
      bash: ['ask', 'allow'],
      webfetch: ['deny', 'deny'],
      other: ['deny', 'deny'],
    };
    for (const mode of modes) {
      for (const [tool, decisions] of Object.entries(expected)) {
        const decision = decidePermission({
          tool,
          mode,
          path: null,
          worktree: WORKTREE,
        });
        expect(decision).toBe(decisions[mode === 'chat' ? 0 : 1]);
        const inside = decidePermission({
          tool,
          mode,
          path: `${WORKTREE}/src/index.ts`,
          worktree: WORKTREE,
        });
        expect(inside).toBe(decision);
      }
    }

    for (const tool of ['webfetch', 'websearch', 'fetch', 'routine.evil', 'mcp__evil']) {
      expect(decidePermission({ tool, mode: 'run', path: null, worktree: WORKTREE })).toBe('deny');
      expect(
        decidePermission({ tool, mode: 'chat', path: `${WORKTREE}/a.ts`, worktree: WORKTREE }),
      ).toBe('deny');
      expect(decidePermission({ tool, mode: 'chat', path: null, worktree: WORKTREE })).toBe('deny');
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

    expect(decidePermission({ tool: 'edit', mode: 'chat', path: null, worktree: WORKTREE })).toBe(
      'ask',
    );
    expect(decidePermission({ tool: 'edit', mode: 'run', path: null, worktree: WORKTREE })).toBe(
      'allow',
    );
  });

  it('allows the routine tools in chat and denies them in a run', () => {
    for (const tool of ['routine.create', 'routine.list', 'routine.pause']) {
      expect(decidePermission({ tool, mode: 'chat', path: null, worktree: WORKTREE })).toBe(
        'allow',
      );
      expect(decidePermission({ tool, mode: 'run', path: null, worktree: WORKTREE })).toBe('deny');
    }
    expect(
      decidePermission({
        tool: 'routine.create',
        mode: 'chat',
        path: '/etc/passwd',
        worktree: WORKTREE,
      }),
    ).toBe('deny');
  });
});
