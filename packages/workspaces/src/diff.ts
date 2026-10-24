import type { RunDiff } from '@codebox/contracts';

export interface NumstatEntry {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

export interface NameStatusEntry {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed';
}

type FileStatus = NameStatusEntry['status'];

const STATUS_BY_LETTER: Readonly<Record<string, FileStatus>> = Object.freeze({
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
});

const BRACED_RENAME = /^(.*)\{(.*) => (.*)\}(.*)$/;

function renameTarget(rawPath: string): string {
  const braced = BRACED_RENAME.exec(rawPath);
  if (braced !== null) {
    return `${braced[1] ?? ''}${braced[3] ?? ''}${braced[4] ?? ''}`;
  }
  const arrow = rawPath.indexOf(' => ');
  return arrow >= 0 ? rawPath.slice(arrow + 4) : rawPath;
}

function countOf(field: string | undefined): number {
  if (field === undefined || field === '-') return 0;
  const parsed = Number.parseInt(field, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function parseNumstat(stdout: string): readonly NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim().length === 0) continue;
    const fields = line.split('\t');
    if (fields.length < 3) continue;
    const path = renameTarget(fields.slice(2).join('\t'));
    if (path.length === 0) continue;
    entries.push({ path, added: countOf(fields[0]), removed: countOf(fields[1]) });
  }
  return entries;
}

export function parseNameStatus(stdout: string): readonly NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim().length === 0) continue;
    const fields = line.split('\t');
    const letter = (fields[0] ?? '').charAt(0);
    const status = STATUS_BY_LETTER[letter];
    if (status === undefined) continue;
    const path = letter === 'R' ? fields[2] : fields[1];
    if (path === undefined || path.length === 0) continue;
    entries.push({ path, status });
  }
  return entries;
}

export function buildRunDiff(
  numstat: readonly NumstatEntry[],
  nameStatus: readonly NameStatusEntry[],
): RunDiff {
  const statuses = new Map<string, FileStatus>();
  for (const entry of nameStatus) statuses.set(entry.path, entry.status);

  const merged = new Map<string, { added: number; removed: number }>();
  for (const entry of numstat) {
    const current = merged.get(entry.path);
    if (current === undefined) {
      merged.set(entry.path, { added: entry.added, removed: entry.removed });
      continue;
    }
    current.added += entry.added;
    current.removed += entry.removed;
  }

  const paths = [...merged.keys()].sort();
  let added = 0;
  let removed = 0;
  const changedFiles: RunDiff['changedFiles'] = paths.map((path) => {
    const totals = merged.get(path) ?? { added: 0, removed: 0 };
    added += totals.added;
    removed += totals.removed;
    return {
      path,
      status: statuses.get(path) ?? 'modified',
      added: totals.added,
      removed: totals.removed,
    };
  });

  return { files: paths.length, added, removed, changedFiles };
}
