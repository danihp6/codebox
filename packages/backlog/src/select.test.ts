import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBacklog } from './parse.js';
import { selectNextItem } from './select.js';
import type { BacklogEntry, BacklogWorkState, SelectionPolicy } from './types.js';

const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/todo.md', import.meta.url)), 'utf8');

const items: readonly BacklogEntry[] = parseBacklog(FIXTURE).items;

const policy = (
  overrides: Partial<SelectionPolicy> & Pick<SelectionPolicy, 'selection'>,
): SelectionPolicy => ({ refs: [], maxAttempts: 2, ...overrides });

const refusal = (ref: string, line: number, reason: string): unknown => ({ ref, line, reason });

describe('selectNextItem', () => {
  it('takes the first pending item in file order', () => {
    const result = selectNextItem(items, [], policy({ selection: 'nextPending' }));

    expect(result.kind).toBe('selected');
    expect(result.kind === 'selected' && result.item.ref).toBe('Task-90');
    expect(result.kind === 'selected' && result.item.line).toBe(5);
  });

  it('ignores refs when the policy is nextPending', () => {
    expect(
      selectNextItem(items, [], policy({ selection: 'nextPending', refs: ['Task-01'] })),
    ).toMatchObject({ kind: 'selected', item: { ref: 'Task-90' } });
  });

  it('restricts to the requested refs and never reorders them', () => {
    expect(
      selectNextItem(items, [], policy({ selection: 'refs', refs: ['Task-02', 'Task-04'] })),
    ).toMatchObject({ kind: 'selected', item: { ref: 'Task-02', line: 11 } });
    expect(
      selectNextItem(items, [], policy({ selection: 'refs', refs: ['Task-05', 'Task-02'] })),
    ).toMatchObject({ kind: 'selected', item: { ref: 'Task-02', line: 11 } });
    expect(selectNextItem(items, [], policy({ selection: 'refs', refs: ['Task-99'] }))).toEqual({
      kind: 'nothing_pending',
    });
    expect(selectNextItem([], [], policy({ selection: 'nextPending' }))).toEqual({
      kind: 'nothing_pending',
    });
  });

  it('reports a blocked item instead of skipping it', () => {
    expect(selectNextItem(items, [], policy({ selection: 'refs', refs: ['Task-04'] }))).toEqual({
      kind: 'nothing_runnable',
      refused: [refusal('Task-04', 15, 'blocked')],
    });
  });

  it('refuses a work that needs a decision', () => {
    const works: BacklogWorkState[] = [{ ref: 'Task-02', state: 'needs_decision', attempts: 1 }];

    expect(selectNextItem(items, works, policy({ selection: 'refs', refs: ['Task-02'] }))).toEqual({
      kind: 'nothing_runnable',
      refused: [refusal('Task-02', 11, 'needs_decision')],
    });
  });

  it('refuses a live work in running or queued state', () => {
    for (const state of ['running', 'queued'] as const) {
      const works: BacklogWorkState[] = [{ ref: 'Task-02', state, attempts: 0 }];
      expect(
        selectNextItem(items, works, policy({ selection: 'refs', refs: ['Task-02'] })),
      ).toEqual({
        kind: 'nothing_runnable',
        refused: [refusal('Task-02', 11, 'live_work')],
      });
    }
  });

  it('refuses an item whose highest attempt count reached the cap', () => {
    const exhausted: BacklogWorkState[] = [{ ref: 'Task-02', state: 'failed', attempts: 2 }];
    expect(
      selectNextItem(items, exhausted, policy({ selection: 'refs', refs: ['Task-02'] })),
    ).toEqual({
      kind: 'nothing_runnable',
      refused: [refusal('Task-02', 11, 'attempts_exhausted')],
    });

    const retryable: BacklogWorkState[] = [{ ref: 'Task-02', state: 'failed', attempts: 1 }];
    expect(
      selectNextItem(items, retryable, policy({ selection: 'refs', refs: ['Task-02'] })),
    ).toMatchObject({ kind: 'selected', item: { ref: 'Task-02' } });

    const history: BacklogWorkState[] = [
      { ref: 'Task-02', state: 'failed', attempts: 1 },
      { ref: 'Task-02', state: 'merged', attempts: 3 },
    ];
    expect(
      selectNextItem(items, history, policy({ selection: 'refs', refs: ['Task-02'] })),
    ).toEqual({
      kind: 'nothing_runnable',
      refused: [refusal('Task-02', 11, 'attempts_exhausted')],
    });
  });

  it('refuses a duplicated ref on every one of its lines', () => {
    expect(selectNextItem(items, [], policy({ selection: 'refs', refs: ['Task-05'] }))).toEqual({
      kind: 'nothing_runnable',
      refused: [refusal('Task-05', 20, 'ambiguous_ref'), refusal('Task-05', 21, 'ambiguous_ref')],
    });
  });

  it('checks ambiguity before the item state', () => {
    const duplicated: readonly BacklogEntry[] = [
      {
        ref: 'Task-04',
        title: 'Blocked.',
        body: 'Blocked.',
        needs: [],
        state: 'blocked',
        checked: false,
        line: 5,
        section: 'Batch 0 — Alpha',
      },
      {
        ref: 'Task-04',
        title: 'Blocked again.',
        body: 'Blocked again.',
        needs: [],
        state: 'blocked',
        checked: false,
        line: 20,
        section: 'Batch 1 — Beta',
      },
    ];

    expect(
      selectNextItem(duplicated, [], policy({ selection: 'refs', refs: ['Task-04'] })),
    ).toEqual({
      kind: 'nothing_runnable',
      refused: [refusal('Task-04', 5, 'ambiguous_ref'), refusal('Task-04', 20, 'ambiguous_ref')],
    });
  });

  it('refuses in file order and stops at the first runnable item', () => {
    const works: BacklogWorkState[] = [{ ref: 'Task-02', state: 'needs_decision', attempts: 1 }];

    expect(
      selectNextItem(items, works, policy({ selection: 'refs', refs: ['Task-02', 'Task-04'] })),
    ).toEqual({
      kind: 'nothing_runnable',
      refused: [refusal('Task-02', 11, 'needs_decision'), refusal('Task-04', 15, 'blocked')],
    });

    const blockedHead: BacklogWorkState[] = [
      { ref: 'Task-90', state: 'needs_decision', attempts: 0 },
    ];
    expect(selectNextItem(items, blockedHead, policy({ selection: 'nextPending' }))).toMatchObject({
      kind: 'selected',
      item: { ref: 'Task-02', line: 11 },
    });
  });

  it('ignores works of other refs', () => {
    const works: BacklogWorkState[] = [{ ref: 'Task-04', state: 'needs_decision', attempts: 9 }];

    expect(selectNextItem(items, works, policy({ selection: 'nextPending' }))).toMatchObject({
      kind: 'selected',
      item: { ref: 'Task-90' },
    });
  });

  it('never selects a done or a doing item', () => {
    const onlyFinished: readonly BacklogEntry[] = [
      {
        ref: 'Task-01',
        title: 'Done.',
        body: 'Done.',
        needs: [],
        state: 'done',
        checked: true,
        line: 1,
        section: 'Batch 0 — Alpha',
      },
      {
        ref: 'Task-03',
        title: 'Doing.',
        body: 'Doing.',
        needs: [],
        state: 'doing',
        checked: false,
        line: 2,
        section: 'Batch 0 — Alpha',
      },
    ];

    expect(selectNextItem(onlyFinished, [], policy({ selection: 'nextPending' }))).toEqual({
      kind: 'nothing_pending',
    });
  });
});
