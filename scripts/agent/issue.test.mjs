import { describe, expect, it } from 'vitest';
import {
  HANDOFF_LABELS,
  createGhPort,
  decideHandoff,
  findDuplicates,
  handoff,
  titleKey,
} from './issue.mjs';

const AGAIN = 'Reported again by a second attempt; the original report stands.';

function fakeGh(initial = []) {
  const issues = initial.map((issue) => ({ ...issue, labels: [...issue.labels] }));
  const calls = { listOpen: 0, create: [], comment: [] };
  let next = 21;
  const port = {
    async listOpen() {
      calls.listOpen += 1;
      return issues.map((issue) => ({ ...issue, labels: [...issue.labels] }));
    },
    async create(input) {
      calls.create.push(input);
      next += 1;
      issues.push({ number: next, title: input.title, labels: [input.label] });
      return { number: next, url: `https://example.invalid/issues/${next}` };
    },
    async comment(input) {
      calls.comment.push(input);
      return { url: `https://example.invalid/issues/${input.number}` };
    },
  };
  return { port, issues, calls };
}

describe('titleKey', () => {
  it('collapses whitespace and case', () => {
    expect(titleKey('  Task-48:  v3 ')).toBe('task-48: v3');
    expect(titleKey('Task-48: v3')).toBe(titleKey('  task-48:   V3  '));
    expect(titleKey('a\n\tb')).toBe('a b');
  });
});

describe('findDuplicates', () => {
  it('keeps only open issues that carry a handoff label and the same title key', () => {
    const issues = [
      { number: 4, title: 'Bug: something else', labels: ['agent-review'] },
      { number: 3, title: '  task-48:   v3 ', labels: ['agent-blocked'] },
      { number: 2, title: 'Task-48: v3', labels: ['agent-review'] },
      { number: 1, title: 'Task-48: v3', labels: ['bug'] },
    ];
    expect(findDuplicates(issues, 'Task-48: v3')).toEqual([
      { number: 2, title: 'Task-48: v3' },
      { number: 3, title: '  task-48:   v3 ' },
    ]);
  });

  it('is empty when the same title carries a label outside the handoff pair', () => {
    const issues = [{ number: 7, title: 'Task-1: probe', labels: ['bug'] }];
    expect(findDuplicates(issues, 'task-1: probe')).toEqual([]);
    expect(HANDOFF_LABELS).toEqual(['agent-review', 'agent-blocked']);
  });
});

describe('decideHandoff', () => {
  it('creates with the title normalised and the label as given', () => {
    expect(decideHandoff({ issues: [], title: '  Task-48:  v3 ', label: 'agent-review' })).toEqual({
      action: 'create',
      title: 'Task-48: v3',
      label: 'agent-review',
      duplicates: [],
    });
  });

  it('comments on the lowest matching number and reports the pair', () => {
    const issues = [
      { number: 23, title: 'Task-48: v3', labels: ['agent-review'] },
      { number: 22, title: 'task-48:  V3', labels: ['agent-blocked'] },
    ];
    expect(decideHandoff({ issues, title: 'Task-48: v3', label: 'agent-review' })).toMatchObject({
      action: 'comment',
      number: 22,
      duplicates: [22, 23],
    });
  });

  it('throws on a label outside the handoff pair, before it reads anything', () => {
    expect(() => decideHandoff({ issues: [], title: 'Task-1: x', label: 'bug' })).toThrow(
      'unknown handoff label: bug',
    );
  });
});

describe('handoff', () => {
  it('creates exactly one issue when nothing matches', async () => {
    const { port, calls } = fakeGh();
    const result = await handoff({
      gh: port,
      title: 'Task-48: v3',
      label: 'agent-review',
      body: 'why',
    });

    expect(calls.create).toHaveLength(1);
    expect(calls.comment).toHaveLength(0);
    expect(calls.listOpen).toBe(1);
    expect(result).toEqual({
      action: 'created',
      number: 22,
      url: 'https://example.invalid/issues/22',
      duplicates: [],
    });
    expect(calls.create[0]).toEqual({ title: 'Task-48: v3', label: 'agent-review', body: 'why' });
  });

  it('comments on the second attempt, carrying the frozen line and the new body', async () => {
    const { port, calls } = fakeGh();
    const first = await handoff({
      gh: port,
      title: 'Task-48: v3',
      label: 'agent-review',
      body: 'first',
    });
    const second = await handoff({
      gh: port,
      title: '  task-48:   V3 ',
      label: 'agent-review',
      body: 'second',
    });

    expect(calls.create).toHaveLength(1);
    expect(calls.comment).toHaveLength(1);
    expect(calls.create[0].body).toBe('first');
    expect(calls.comment[0].number).toBe(first.number);
    expect(calls.comment[0].body).toBe(`${AGAIN}\n\nsecond`);
    expect(calls.comment[0].body.startsWith(`${AGAIN}\n\n`)).toBe(true);
    expect(second).toEqual({
      action: 'commented',
      number: first.number,
      url: `https://example.invalid/issues/${first.number}`,
      duplicates: [first.number],
    });
  });

  it('still creates once per title, so a different title is a second issue', async () => {
    const { port, calls } = fakeGh();
    await handoff({ gh: port, title: 'Task-48: v3', label: 'agent-review', body: 'first' });
    const other = await handoff({
      gh: port,
      title: 'Task-49: other',
      label: 'agent-review',
      body: 'third',
    });

    expect(calls.create).toHaveLength(2);
    expect(calls.comment).toHaveLength(0);
    expect(other).toMatchObject({ action: 'created', number: 23, duplicates: [] });
  });

  it('rejects an unknown label without listing', async () => {
    const { port, calls } = fakeGh();
    await expect(
      handoff({ gh: port, title: 'Task-48: v3', label: 'bug', body: 'why' }),
    ).rejects.toThrow('unknown handoff label: bug');
    expect(calls.listOpen).toBe(0);
    expect(calls.create).toHaveLength(0);
  });
});

describe('createGhPort', () => {
  it('exposes the three operations of the port', () => {
    expect(Object.keys(createGhPort()).sort()).toEqual(['comment', 'create', 'listOpen']);
  });
});
