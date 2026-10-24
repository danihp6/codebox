export interface DiffSize {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
}

export interface DiffBudget {
  readonly maxFiles: number;
  readonly maxLines: number;
}

export interface DiffBudgetResult {
  readonly ok: boolean;
  readonly files: number;
  readonly lines: number;
  readonly reason: 'files' | 'lines' | 'files_and_lines' | null;
}

export const DEFAULT_DIFF_BUDGET: DiffBudget = Object.freeze({ maxFiles: 40, maxLines: 2000 });

export function evaluateDiffBudget(diff: DiffSize, budget: DiffBudget): DiffBudgetResult {
  const lines = diff.added + diff.removed;
  const filesOver = diff.files > budget.maxFiles;
  const linesOver = lines > budget.maxLines;
  const reason =
    filesOver && linesOver ? 'files_and_lines' : filesOver ? 'files' : linesOver ? 'lines' : null;
  return { ok: !filesOver && !linesOver, files: diff.files, lines, reason };
}
