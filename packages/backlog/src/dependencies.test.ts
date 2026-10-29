import type { BacklogRef } from '@codebox/contracts';
import { describe, expect, it } from 'vitest';
import { needsOf } from './dependencies.js';

const SELF: BacklogRef = 'Task-01';

const body = (value: string): string => `An item. *Dependencies:* ${value}`;

describe('needsOf', () => {
  it('reads the refs of the dependency sentence', () => {
    expect(needsOf(body('Task-75.'), SELF)).toEqual(['Task-75']);
    expect(needsOf(body('Task-51, Task-52.'), SELF)).toEqual(['Task-51', 'Task-52']);
  });

  it('answers none for an explicit none, with or without a parenthetical', () => {
    expect(needsOf(body('none'), SELF)).toEqual([]);
    expect(needsOf(body('none.'), SELF)).toEqual([]);
    expect(needsOf(body('NONE (Task-40 supplies the AMI later)'), SELF)).toEqual([]);
  });

  it('answers none when the marker is absent or names no task', () => {
    expect(needsOf('An item with no metadata at all.', SELF)).toEqual([]);
    expect(needsOf(body(''), SELF)).toEqual([]);
    expect(needsOf(body('see the design document'), SELF)).toEqual([]);
  });

  it('removes the item itself and collapses duplicates in first-appearance order', () => {
    expect(needsOf(body('Task-01.'), SELF)).toEqual([]);
    expect(needsOf(body('Task-75, Task-01, Task-75, Task-76, Task-75.'), SELF)).toEqual([
      'Task-75',
      'Task-76',
    ]);
  });

  it('stops at the next metadata marker or at the end of the line', () => {
    expect(needsOf(body('Task-03. *Acceptance:* [unit] Task-99 passes.'), SELF)).toEqual([
      'Task-03',
    ]);
    expect(needsOf('*Dependencies:* Task-05\n  Task-06 continues here.', SELF)).toEqual(['Task-05']);
    expect(needsOf('Prose. *Dependencies:* Task-07. *Paths:* `a.ts`.', SELF)).toEqual(['Task-07']);
  });

  it('expands a range inclusively with the start token width', () => {
    const other: BacklogRef = 'Task-90';
    expect(needsOf(body('Task-51 to Task-53.'), SELF)).toEqual(['Task-51', 'Task-52', 'Task-53']);
    expect(needsOf(body('Task-01 to Task-03.'), other)).toEqual([
      'Task-01',
      'Task-02',
      'Task-03',
    ]);
    expect(needsOf(body('Task-7 to Task-9.'), SELF)).toEqual(['Task-7', 'Task-8', 'Task-9']);
  });

  it('keeps the written endpoints when the range does not grow', () => {
    expect(needsOf(body('Task-09 to Task-07.'), SELF)).toEqual(['Task-09', 'Task-07']);
    expect(needsOf(body('Task-07 to Task-07.'), SELF)).toEqual(['Task-07']);
  });

  it('drops a self inside an expanded range', () => {
    const self: BacklogRef = 'Task-02';
    expect(needsOf(body('Task-01 to Task-03.'), self)).toEqual(['Task-01', 'Task-03']);
  });

  it('never throws for an arbitrary body', () => {
    for (const value of ['', '*Dependencies:*', '*Dependencies:* Task-', '*Dependencies:* to to']) {
      expect(() => needsOf(value, SELF)).not.toThrow();
    }
  });
});
