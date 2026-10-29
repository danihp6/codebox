import type { BacklogRef } from '@codebox/contracts';
import { needsOf } from './dependencies.js';
import type { BacklogEntry, BacklogEntryState, ParsedBacklog } from './types.js';

/** The ref grammar, byte-identical to `backlogRefSchema` in `@codebox/contracts`. */
export const BACKLOG_REF_PATTERN: RegExp = /^Task-\d+$/;

const ITEM_LINE_PATTERN = /^- \[([ x~!])\] \*\*\[(Task-\d+)\]\*\*[ \t]*(.*)$/;
const SECTION_HEADING_PATTERN = /^## (?!#)(.*)$/;

const CHECKBOX_STATES: Readonly<Record<string, BacklogEntryState>> = Object.freeze({
  ' ': 'open',
  '~': 'doing',
  '!': 'blocked',
  x: 'done',
});

interface ItemLine {
  readonly ref: string;
  readonly title: string;
  readonly state: BacklogEntryState;
}

interface DraftSection {
  readonly title: string;
  readonly items: BacklogEntry[];
}

/** The line as the patterns see it: one trailing carriage return is not part of the text. */
function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function matchItemLine(line: string): ItemLine | null {
  const match = ITEM_LINE_PATTERN.exec(line);
  if (match === null) {
    return null;
  }
  const mark = match[1] ?? ' ';
  return {
    ref: match[2] ?? '',
    title: match[3] ?? '',
    state: CHECKBOX_STATES[mark] ?? 'open',
  };
}

function continuationLines(lines: readonly string[], start: number): string[] {
  const parts: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = stripCarriageReturn(lines[index] ?? '');
    if (SECTION_HEADING_PATTERN.test(line) || matchItemLine(line) !== null) {
      break;
    }
    if (line.trim() === '') {
      continue;
    }
    if (!line.startsWith('  ')) {
      break;
    }
    parts.push(line.trimStart());
  }
  return parts;
}

export function parseBacklog(markdown: string): ParsedBacklog {
  const lines = markdown.split('\n');
  const items: BacklogEntry[] = [];
  const drafts: DraftSection[] = [];
  const refCounts = new Map<string, number>();
  const duplicateRefs: BacklogRef[] = [];
  let section = '';
  let draft: DraftSection | undefined;

  for (const [index, raw] of lines.entries()) {
    const line = stripCarriageReturn(raw);
    const heading = SECTION_HEADING_PATTERN.exec(line);
    if (heading !== null) {
      section = (heading[1] ?? '').trim();
      draft = { title: section, items: [] };
      drafts.push(draft);
      continue;
    }
    const item = matchItemLine(line);
    if (item === null) {
      continue;
    }
    const title = item.title.trim() || item.ref;
    const body = [title, ...continuationLines(lines, index + 1)].join('\n').trimEnd();
    const entry: BacklogEntry = {
      ref: item.ref,
      title,
      body,
      needs: needsOf(body, item.ref),
      state: item.state,
      checked: item.state === 'done',
      line: index + 1,
      section,
    };
    items.push(entry);
    draft?.items.push(entry);
    const count = (refCounts.get(item.ref) ?? 0) + 1;
    refCounts.set(item.ref, count);
    if (count === 2) {
      duplicateRefs.push(item.ref);
    }
  }

  return { sections: drafts, items, duplicateRefs };
}
