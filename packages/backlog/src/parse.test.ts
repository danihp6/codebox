import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BACKLOG_REF_PATTERN, parseBacklog } from './parse.js';
import type { BacklogEntry } from './types.js';

const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/todo.md', import.meta.url)), 'utf8');

const entries = (items: readonly BacklogEntry[]): BacklogEntry[] => [...items];

const at = (ref: string): BacklogEntry => {
  const found = parseBacklog(FIXTURE).items.find((item) => item.ref === ref);
  if (found === undefined) {
    throw new Error(`no fixture item ${ref}`);
  }
  return found;
};

describe('parseBacklog', () => {
  it('reads every item line in file order with its line and state', () => {
    const parsed = parseBacklog(FIXTURE);

    expect(parsed.items.map((item) => item.ref)).toEqual([
      'Task-90',
      'Task-01',
      'Task-02',
      'Task-03',
      'Task-04',
      'Task-05',
      'Task-05',
    ]);
    expect(parsed.items.map((item) => item.line)).toEqual([5, 9, 11, 14, 15, 20, 21]);
    expect(parsed.items.map((item) => item.state)).toEqual([
      'open',
      'done',
      'open',
      'doing',
      'blocked',
      'open',
      'open',
    ]);
    expect(parsed.items.map((item) => item.checked)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('keeps every heading in order, including the empty one', () => {
    const parsed = parseBacklog(FIXTURE);

    expect(parsed.sections.map((section) => section.title)).toEqual([
      'Batch 0 — Alpha',
      'Batch 1 — Beta',
      'Empty section',
    ]);
    expect(parsed.sections.map((section) => section.items.length)).toEqual([4, 2, 0]);
    expect(parsed.sections[0]?.items.map((item) => item.ref)).toEqual([
      'Task-01',
      'Task-02',
      'Task-03',
      'Task-04',
    ]);
    const inSections = parsed.sections.flatMap((section) => entries(section.items));
    expect(inSections).toHaveLength(6);
    expect(parsed.items.filter((item) => !inSections.includes(item))).toEqual([
      expect.objectContaining({ ref: 'Task-90' }),
    ]);
  });

  it('reports the duplicated ref once, in first-appearance order', () => {
    expect(parseBacklog(FIXTURE).duplicateRefs).toEqual(['Task-05']);
    expect(parseBacklog('').duplicateRefs).toEqual([]);
  });

  it('assigns a section only after the first heading', () => {
    expect(at('Task-90').section).toBe('');
    expect(at('Task-01').section).toBe('Batch 0 — Alpha');
    expect(at('Task-05').section).toBe('Batch 1 — Beta');
  });

  it('falls back to the ref when the item line carries no title', () => {
    expect(at('Task-90').title).toBe('Task-90');
    expect(at('Task-90').body).toBe('Task-90');
  });

  it('builds the body from the title and the continuation lines', () => {
    expect(at('Task-02').title).toBe('Open item.');
    expect(at('Task-02').body).toBe('Open item.\nBody line one.\nBody line two.');
    expect(at('Task-01').body).toBe('Done item. *Paths:* `a.ts`.\n*Dependencies:* none.');
    expect(at('Task-03').body).toBe('In progress.');
  });

  it('attaches the refs of the dependency sentence to the entry', () => {
    const parsed = parseBacklog(
      [
        '## Batch',
        '',
        '- [ ] **[Task-01]** Root.',
        '      *Dependencies:* none.',
        '- [ ] **[Task-02]** Child.',
        '      *Dependencies:* Task-01.',
        '- [ ] **[Task-03]** Branch.',
        '      *Dependencies:* Task-01 to Task-02.',
      ].join('\n'),
    );

    expect(parsed.items.map((item) => item.needs)).toEqual([
      [],
      ['Task-01'],
      ['Task-01', 'Task-02'],
    ]);
    expect(at('Task-01').needs).toEqual([]);
  });

  it('ignores prose, plain bullets, design bullets and the document title', () => {
    const parsed = parseBacklog(FIXTURE);

    expect(parsed.items.map((item) => item.line)).not.toContain(1);
    expect(parsed.items.map((item) => item.line)).not.toContain(3);
    expect(parsed.items.map((item) => item.line)).not.toContain(4);
    expect(parsed.items.map((item) => item.line)).not.toContain(19);
    expect(parsed.items.some((item) => item.ref === 'Design-01')).toBe(false);
    expect(parsed.items.some((item) => item.title.startsWith('A design bullet'))).toBe(false);
  });

  it('pins the ref grammar', () => {
    for (const ref of ['Task-01', 'Task-7', 'Task-999']) {
      expect(BACKLOG_REF_PATTERN.test(ref)).toBe(true);
    }
    for (const ref of ['Design-01', 'Task-', 'task-01', 'Task-1a', ' Task-01', 'Task-01 ']) {
      expect(BACKLOG_REF_PATTERN.test(ref)).toBe(false);
    }
  });

  it('never throws on empty, truncated or malformed markdown', () => {
    expect(parseBacklog('')).toEqual({ sections: [], items: [], duplicateRefs: [] });
    expect(parseBacklog('\n\n## Only a heading\n')).toEqual({
      sections: [{ title: 'Only a heading', items: [] }],
      items: [],
      duplicateRefs: [],
    });

    const truncated = parseBacklog('## Batch\n\n- [ ] **[Task-1]** Cut off');
    expect(truncated.items).toHaveLength(1);
    expect(truncated.items[0]?.ref).toBe('Task-1');
    expect(truncated.items[0]?.body).toBe('Cut off');

    const noTitleAtEof = parseBacklog('- [ ] **[Task-2]**');
    expect(noTitleAtEof.items[0]?.title).toBe('Task-2');
    expect(noTitleAtEof.items[0]?.section).toBe('');

    expect(() => parseBacklog('- [!] **[Task-3]** ---- ')).not.toThrow();
    expect(parseBacklog('- [ ] **[Task-]\n- [X] **[Task-4]** fix').items).toHaveLength(0);
  });

  it('reads a carriage-return file without letting the "\\r" leak into the title', () => {
    const parsed = parseBacklog('## Batch\r\n\r\n- [ ] **[Task-8]** CRLF item.\r\n  more.\r\n');

    expect(parsed.sections.map((section) => section.title)).toEqual(['Batch']);
    expect(parsed.items[0]?.title).toBe('CRLF item.');
    expect(parsed.items[0]?.body).toBe('CRLF item.\nmore.');
    expect(parsed.items[0]?.line).toBe(3);
  });
});
