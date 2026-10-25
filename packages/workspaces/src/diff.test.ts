import { describe, expect, it } from 'vitest';

import { runDiffSchema } from '../../contracts/src/resources.js';
import { buildRunDiff, parseNameStatus, parseNumstat } from './diff.js';

describe('diff parsing', () => {
  it('parses a plain numstat line', () => {
    expect(parseNumstat('12\t3\tsrc/index.ts\n')).toEqual([
      { path: 'src/index.ts', added: 12, removed: 3 },
    ]);
  });

  it('treats a binary line as zero added and zero removed', () => {
    expect(parseNumstat('-\t-\tlogo.png\n')).toEqual([{ path: 'logo.png', added: 0, removed: 0 }]);
  });

  it('resolves a rename written as old => new', () => {
    expect(parseNumstat('5\t2\tdocs/old.md => docs/new.md\n')).toEqual([
      { path: 'docs/new.md', added: 5, removed: 2 },
    ]);
  });

  it('resolves a compact rename with a common prefix and a common suffix', () => {
    expect(parseNumstat('1\t1\tsrc/{old => new}.ts\n')).toEqual([
      { path: 'src/new.ts', added: 1, removed: 1 },
    ]);
    expect(parseNumstat('2\t0\ta{x => y}/f\n')).toEqual([{ path: 'ay/f', added: 2, removed: 0 }]);
    expect(parseNumstat('3\t0\tsrc/a/b{one => two}/c.ts\n')).toEqual([
      { path: 'src/a/btwo/c.ts', added: 3, removed: 0 },
    ]);
  });

  it('ignores blank and malformed numstat output', () => {
    expect(parseNumstat('')).toEqual([]);
    expect(parseNumstat('\n\n')).toEqual([]);
    expect(parseNumstat('not a numstat line\n')).toEqual([]);
  });

  it('parses the name-status letters and takes the new path of a rename', () => {
    const stdout = [
      'A\tsrc/added.ts',
      'M\tsrc/modified.ts',
      'D\tsrc/deleted.ts',
      'R100\tsrc/old.ts\tsrc/new.ts',
      'T\tsrc/typechanged.ts',
    ].join('\n');
    expect(parseNameStatus(stdout)).toEqual([
      { path: 'src/added.ts', status: 'added' },
      { path: 'src/modified.ts', status: 'modified' },
      { path: 'src/deleted.ts', status: 'deleted' },
      { path: 'src/new.ts', status: 'renamed' },
    ]);
  });

  it('builds a path-sorted diff from unsorted numstat input', () => {
    const diff = buildRunDiff(
      [
        { path: 'src/z.ts', added: 1, removed: 0 },
        { path: 'src/a.ts', added: 2, removed: 3 },
      ],
      [
        { path: 'src/z.ts', status: 'added' },
        { path: 'src/a.ts', status: 'modified' },
      ],
    );
    expect(diff).toEqual({
      files: 2,
      added: 3,
      removed: 3,
      changedFiles: [
        { path: 'src/a.ts', status: 'modified', added: 2, removed: 3 },
        { path: 'src/z.ts', status: 'added', added: 1, removed: 0 },
      ],
    });
    expect(runDiffSchema.safeParse(diff).success).toBe(true);
  });

  it('sums added and removed across added, deleted and binary files', () => {
    const diff = buildRunDiff(
      [
        { path: 'src/a.ts', added: 4, removed: 1 },
        { path: 'logo.png', added: 0, removed: 0 },
        { path: 'src/c.ts', added: 7, removed: 2 },
        { path: 'src/gone.ts', added: 0, removed: 9 },
      ],
      [
        { path: 'src/a.ts', status: 'added' },
        { path: 'src/gone.ts', status: 'deleted' },
      ],
    );
    expect(diff.files).toBe(4);
    expect(diff.added).toBe(11);
    expect(diff.removed).toBe(12);
    expect(diff.changedFiles.map((file) => [file.path, file.status])).toEqual([
      ['logo.png', 'modified'],
      ['src/a.ts', 'added'],
      ['src/c.ts', 'modified'],
      ['src/gone.ts', 'deleted'],
    ]);
    expect(diff.changedFiles[0]).toEqual({
      path: 'logo.png',
      status: 'modified',
      added: 0,
      removed: 0,
    });
  });

  it('keeps a renamed file once under its new path with its real delta', () => {
    const numstat = parseNumstat('9\t4\tsrc/{old => new}.ts\n');
    const nameStatus = parseNameStatus('R087\tsrc/old.ts\tsrc/new.ts');
    const diff = buildRunDiff(numstat, nameStatus);
    expect(diff.files).toBe(1);
    expect(diff.added).toBe(9);
    expect(diff.removed).toBe(4);
    expect(diff.changedFiles).toEqual([
      { path: 'src/new.ts', status: 'renamed', added: 9, removed: 4 },
    ]);
  });
});
