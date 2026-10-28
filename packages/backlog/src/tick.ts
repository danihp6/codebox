import type { BacklogRef } from '@codebox/contracts';
import type { TickOutcome } from './types.js';

const ITEM_LINE_PATTERN = /^- \[([ x~!])\] \*\*\[(Task-\d+)\]\*\*[ \t]*(.*)$/;

interface Hit {
  readonly index: number;
  readonly mark: string;
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export function applyTick(markdown: string, ref: BacklogRef): TickOutcome {
  const lines = markdown.split('\n');
  const hits: Hit[] = [];
  for (const [index, raw] of lines.entries()) {
    const match = ITEM_LINE_PATTERN.exec(stripCarriageReturn(raw));
    if (match !== null && match[2] === ref) {
      hits.push({ index, mark: match[1] ?? '' });
    }
  }
  if (hits.length === 0) {
    return { kind: 'missing' };
  }
  if (hits.length > 1) {
    return { kind: 'ambiguous', lines: hits.map((hit) => hit.index + 1) };
  }
  const hit = hits[0];
  if (hit === undefined) {
    return { kind: 'missing' };
  }
  const lineNumber = hit.index + 1;
  if (hit.mark === 'x') {
    return { kind: 'already_done', markdown, line: lineNumber };
  }
  const line = lines[hit.index] ?? '';
  lines[hit.index] = `${line.slice(0, 3)}x${line.slice(4)}`;
  return { kind: 'ticked', markdown: lines.join('\n'), line: lineNumber };
}
