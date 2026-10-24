import { describe, expect, it } from 'vitest';

import { branchSchema } from '../../contracts/src/primitives.js';
import { WorkspaceError } from './errors.js';
import {
  BRANCH_PREFIX,
  RUN_MARKER_FILENAME,
  SLUG_MAX_LENGTH,
  branchName,
  clonePath,
  slugifyTitle,
  worktreePath,
} from './paths.js';

describe('paths', () => {
  it('exposes the frozen names of the cache, the marker and the branch prefix', () => {
    expect(BRANCH_PREFIX).toBe('cb/');
    expect(RUN_MARKER_FILENAME).toBe('codebox-run.json');
    expect(SLUG_MAX_LENGTH).toBe(40);
  });

  it('slugifies a title into lower-case kebab case', () => {
    expect(slugifyTitle('Fix the Login Page!')).toBe('fix-the-login-page');
    expect(slugifyTitle('  Release v1.2.3  ')).toBe('release-v1-2-3');
    expect(slugifyTitle('a__b--c')).toBe('a-b-c');
  });

  it('falls back to run for a title with no usable character', () => {
    expect(slugifyTitle('')).toBe('run');
    expect(slugifyTitle('   ')).toBe('run');
    expect(slugifyTitle('!!!')).toBe('run');
  });

  it('truncates to forty characters without a trailing dash', () => {
    expect(slugifyTitle('a'.repeat(60))).toBe('a'.repeat(40));
    const truncated = slugifyTitle(`${'a'.repeat(39)} long tail`);
    expect(truncated).toBe('a'.repeat(39));
    expect(truncated.endsWith('-')).toBe(false);
  });

  it('honours an explicit maximum length', () => {
    expect(slugifyTitle('a b c d', 3)).toBe('a-b');
    expect(slugifyTitle('a b c d', 1)).toBe('a');
    expect(slugifyTitle('anything', 0)).toBe('anything');
  });

  it('builds a branch that satisfies branchSchema for a hostile title', () => {
    const branch = branchName('run_x', 'Fix: ../etc/passwd  ');
    expect(branch).toBe('cb/run_x-fix-etc-passwd');
    expect(branchSchema.parse(branch)).toBe(branch);
    expect(branch.startsWith(BRANCH_PREFIX)).toBe(true);
  });

  it('maps an owner/name slug to the bare cache path', () => {
    expect(clonePath('srv/repos', 'acme/web')).toBe('srv/repos/acme__web.git');
    expect(clonePath('/srv/codebox/repos', 'acme/web')).toBe('/srv/codebox/repos/acme__web.git');
  });

  it('rejects a slug that is not exactly one owner/name pair', () => {
    for (const slug of ['acme', 'acme/web/extra', '../acme/web', 'acme/..', '..', '', 'a//b']) {
      expect(() => clonePath('/srv/repos', slug)).toThrow(WorkspaceError);
    }
  });

  it('maps a run id to its own directory under the workspace root', () => {
    expect(worktreePath('/srv/codebox/worktrees', 'run_01JABC')).toBe(
      '/srv/codebox/worktrees/run_01JABC',
    );
  });

  it('rejects a run id that could escape the workspace root', () => {
    for (const runId of ['..', '.', '.hidden', 'a/b', 'a\\b', '']) {
      expect(() => worktreePath('/srv/codebox/worktrees', runId)).toThrow(WorkspaceError);
    }
  });

  it('reports invalid_root for both path families', () => {
    const slugError = (() => {
      try {
        clonePath('/srv/repos', 'acme');
        return null;
      } catch (error) {
        return error as WorkspaceError;
      }
    })();
    expect(slugError?.code).toBe('invalid_root');
    const runError = (() => {
      try {
        worktreePath('/srv/worktrees', '..');
        return null;
      } catch (error) {
        return error as WorkspaceError;
      }
    })();
    expect(runError?.code).toBe('invalid_root');
  });
});
