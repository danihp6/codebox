import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFF_BUDGET, evaluateDiffBudget } from './diff-budget.js';

describe('diff budget', () => {
  it('carries the D26 default of 40 files and 2000 lines', () => {
    expect(DEFAULT_DIFF_BUDGET).toEqual({ maxFiles: 40, maxLines: 2000 });
  });

  it('the diff budget fails at 41 files or 2001 lines', () => {
    expect(
      evaluateDiffBudget({ files: 40, added: 1500, removed: 500 }, DEFAULT_DIFF_BUDGET),
    ).toEqual({
      ok: true,
      files: 40,
      lines: 2000,
      reason: null,
    });
    expect(
      evaluateDiffBudget({ files: 41, added: 1500, removed: 500 }, DEFAULT_DIFF_BUDGET),
    ).toEqual({
      ok: false,
      files: 41,
      lines: 2000,
      reason: 'files',
    });
    expect(evaluateDiffBudget({ files: 1, added: 2000, removed: 1 }, DEFAULT_DIFF_BUDGET)).toEqual({
      ok: false,
      files: 1,
      lines: 2001,
      reason: 'lines',
    });
    expect(evaluateDiffBudget({ files: 41, added: 2000, removed: 1 }, DEFAULT_DIFF_BUDGET)).toEqual(
      {
        ok: false,
        files: 41,
        lines: 2001,
        reason: 'files_and_lines',
      },
    );
  });

  it('reports the counted lines even when the diff is inside the budget', () => {
    expect(evaluateDiffBudget({ files: 6, added: 184, removed: 22 }, DEFAULT_DIFF_BUDGET)).toEqual({
      ok: true,
      files: 6,
      lines: 206,
      reason: null,
    });
    expect(evaluateDiffBudget({ files: 0, added: 0, removed: 0 }, DEFAULT_DIFF_BUDGET).ok).toBe(
      true,
    );
  });

  it('honours a caller budget that is not the default', () => {
    const budget = { maxFiles: 3, maxLines: 10 };
    expect(evaluateDiffBudget({ files: 3, added: 5, removed: 5 }, budget).ok).toBe(true);
    expect(evaluateDiffBudget({ files: 4, added: 0, removed: 0 }, budget).reason).toBe('files');
    expect(evaluateDiffBudget({ files: 1, added: 6, removed: 5 }, budget).reason).toBe('lines');
  });
});
