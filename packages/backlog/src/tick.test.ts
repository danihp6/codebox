import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyTick } from './tick.js';

const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/todo.md', import.meta.url)), 'utf8');

const differingLines = (before: string, after: string): number[] => {
  const left = before.split('\n');
  const right = after.split('\n');
  const length = Math.max(left.length, right.length);
  const indexes: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      indexes.push(index);
    }
  }
  return indexes;
};

describe('applyTick', () => {
  it('rewrites exactly one checkbox character', () => {
    const outcome = applyTick(FIXTURE, 'Task-02');

    expect(outcome.kind).toBe('ticked');
    if (outcome.kind !== 'ticked') {
      return;
    }
    expect(outcome.line).toBe(11);
    expect(differingLines(FIXTURE, outcome.markdown)).toEqual([10]);
    expect(outcome.markdown.split('\n')[10]).toBe('- [x] **[Task-02]** Open item.');
    expect(outcome.markdown.split('\n')).toHaveLength(FIXTURE.split('\n').length);
  });

  it('ticks a blocked, a doing and an open mark to "x"', () => {
    expect(applyTick('- [!] **[Task-4]** Blocked.', 'Task-4')).toEqual({
      kind: 'ticked',
      markdown: '- [x] **[Task-4]** Blocked.',
      line: 1,
    });
    expect(applyTick('- [~] **[Task-5]** Doing.', 'Task-5')).toEqual({
      kind: 'ticked',
      markdown: '- [x] **[Task-5]** Doing.',
      line: 1,
    });
    expect(applyTick('- [ ] **[Task-6]** Open.', 'Task-6')).toEqual({
      kind: 'ticked',
      markdown: '- [x] **[Task-6]** Open.',
      line: 1,
    });
  });

  it('leaves an already ticked item and its string untouched', () => {
    const outcome = applyTick(FIXTURE, 'Task-01');

    expect(outcome.kind).toBe('already_done');
    if (outcome.kind !== 'already_done') {
      return;
    }
    expect(outcome.line).toBe(9);
    expect(outcome.markdown).toBe(FIXTURE);
  });

  it('reports a missing ref', () => {
    expect(applyTick(FIXTURE, 'Task-99')).toEqual({ kind: 'missing' });
    expect(applyTick('', 'Task-1')).toEqual({ kind: 'missing' });
  });

  it('reports every line of an ambiguous ref, ascending', () => {
    const outcome = applyTick(FIXTURE, 'Task-05');

    expect(outcome).toEqual({ kind: 'ambiguous', lines: [20, 21] });
    expect(applyTick('- [ ] **[Task-5]** one.\n- [ ] **[Task-5]** two.', 'Task-5')).toEqual({
      kind: 'ambiguous',
      lines: [1, 2],
    });
  });

  it('keeps the carriage return of a CRLF file', () => {
    const markdown = '- [ ] **[Task-07]** Line.\r\n## Next\r\n\r\n- [x] **[Task-08]** Done.\r\n';
    const outcome = applyTick(markdown, 'Task-07');

    expect(outcome).toEqual({
      kind: 'ticked',
      markdown: '- [x] **[Task-07]** Line.\r\n## Next\r\n\r\n- [x] **[Task-08]** Done.\r\n',
      line: 1,
    });
    expect(differingLines(markdown, outcome.kind === 'ticked' ? outcome.markdown : '')).toEqual([
      0,
    ]);
  });

  it('keeps trailing whitespace, indentation and the trailing newline', () => {
    const markdown = 'Prose.\n  indented\n- [ ] **[Task-9]**  Trailing.   \n      body\n\n';
    const outcome = applyTick(markdown, 'Task-9');

    expect(outcome.kind).toBe('ticked');
    if (outcome.kind !== 'ticked') {
      return;
    }
    expect(outcome.markdown).toBe(
      'Prose.\n  indented\n- [x] **[Task-9]**  Trailing.   \n      body\n\n',
    );
    expect(outcome.markdown.endsWith('\n\n')).toBe(true);
  });

  it('never throws on malformed markdown', () => {
    expect(() => applyTick('- [ ] **[Task-', 'Task-1')).not.toThrow();
    expect(applyTick('- [ ] **[Task-\n', 'Task-1')).toEqual({ kind: 'missing' });
  });
});
