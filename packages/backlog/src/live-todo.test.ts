import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBacklog } from './parse.js';
import { applyTick } from './tick.js';

const LIVE = readFileSync(fileURLToPath(new URL('../../../TODO.md', import.meta.url)), 'utf8');

const ITEM_LINE = /^- \[[ x~!]\] \*\*\[Task-\d+\]\*\*/;

const refAt = (line: string): string | null => {
  const match = /^- \[[ x~!]\] \*\*\[(Task-\d+)\]\*\*/.exec(line);
  return match?.[1] ?? null;
};

const lines = LIVE.split('\n');
const parsed = parseBacklog(LIVE);

describe('the repository backlog', () => {
  it('holds exactly one item per item line', () => {
    expect(parsed.items).toHaveLength(lines.filter((line) => ITEM_LINE.test(line)).length);
    expect(parsed.items.length).toBeGreaterThan(0);
  });

  it('has no duplicated ref', () => {
    expect(parsed.duplicateRefs).toEqual([]);
  });

  it('places every item under a section heading', () => {
    for (const item of parsed.items) {
      expect(item.section.length).toBeGreaterThan(0);
    }
  });

  it('starts every body with its own title', () => {
    for (const item of parsed.items) {
      expect(item.body.startsWith(item.title)).toBe(true);
    }
  });

  it('points every item line at a line of the file for the same ref', () => {
    for (const item of parsed.items) {
      expect(refAt(lines[item.line - 1] ?? '')).toBe(item.ref);
    }
  });

  it('ticks the first pending item and no other line', () => {
    const pending = parsed.items.find((item) => item.state !== 'done');

    expect(pending).toBeDefined();
    if (pending === undefined) {
      return;
    }
    const outcome = applyTick(LIVE, pending.ref);
    expect(outcome.kind).toBe('ticked');
    if (outcome.kind !== 'ticked') {
      return;
    }
    expect(outcome.line).toBe(pending.line);
    const before = LIVE.split('\n');
    const after = outcome.markdown.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = before.flatMap((line, index) => (line === after[index] ? [] : [index]));
    expect(changed).toEqual([pending.line - 1]);
    expect(applyTick(LIVE, 'Task-9999')).toEqual({ kind: 'missing' });
  });
});
