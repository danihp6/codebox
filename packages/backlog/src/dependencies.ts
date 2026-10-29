import type { BacklogRef } from '@codebox/contracts';

const MARKER = '*Dependencies:*';
const METADATA_MARKER = /\*[A-Za-z][A-Za-z0-9 _./-]*:\*/;
const RANGE = /Task-(\d+)(?:\s+to\s+Task-(\d+))?/g;

function lineValue(body: string, start: number): string {
  const rest = body.slice(start);
  const newline = rest.indexOf('\n');
  const line = newline === -1 ? rest : rest.slice(0, newline);
  const marker = METADATA_MARKER.exec(line);
  return marker === null ? line : line.slice(0, marker.index);
}

function refOf(digits: string, width: number): BacklogRef {
  return `Task-${digits.padStart(width, '0')}`;
}

function expand(value: string): BacklogRef[] {
  const refs: BacklogRef[] = [];
  for (const match of value.matchAll(RANGE)) {
    const start = match[1] ?? '';
    const end = match[2];
    if (end === undefined) {
      refs.push(refOf(start, start.length));
      continue;
    }
    const from = Number(start);
    const to = Number(end);
    if (from < to) {
      for (let value = from; value <= to; value += 1) {
        refs.push(refOf(String(value), start.length));
      }
      continue;
    }
    refs.push(refOf(start, start.length));
    if (from !== to) refs.push(refOf(end, end.length));
  }
  return refs;
}

/**
 * The refs named by the first `*Dependencies:*` sentence in an item body, in file order,
 * deduplicated, with `self` removed. Never null.
 */
export function needsOf(body: string, self: BacklogRef): readonly BacklogRef[] {
  const marker = body.indexOf(MARKER);
  if (marker === -1) return [];
  const value = lineValue(body, marker + MARKER.length).trim();
  if (/^none\b/i.test(value)) return [];
  const refs: BacklogRef[] = [];
  for (const ref of expand(value)) {
    if (ref === self || refs.includes(ref)) continue;
    refs.push(ref);
  }
  return refs;
}
