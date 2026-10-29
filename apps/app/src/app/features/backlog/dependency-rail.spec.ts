import type { BacklogItem } from '@codebox/contracts';
import { describe, expect, it } from 'vitest';
import { railEdges, unmetNeeds } from './dependency-rail';

const ROOT: BacklogItem = {
  ref: 'Task-01',
  title: 'Root',
  checked: true,
  line: 1,
  needs: [],
  work: null,
};

const CHAIN: BacklogItem = {
  ref: 'Task-02',
  title: 'Chain',
  checked: false,
  line: 2,
  needs: ['Task-01'],
  work: null,
};

const BRANCH: BacklogItem = {
  ref: 'Task-03',
  title: 'Branch',
  checked: false,
  line: 3,
  needs: ['Task-01', 'Task-02'],
  work: null,
};

const EXTERNAL: BacklogItem = {
  ref: 'Task-04',
  title: 'External',
  checked: false,
  line: 4,
  needs: ['Task-99'],
  work: null,
};

const ITEMS: readonly BacklogItem[] = [ROOT, CHAIN, BRANCH, EXTERNAL];

describe('railEdges', () => {
  it('draws one edge per need in row order and then need order', () => {
    expect(railEdges(ITEMS)).toEqual([
      { from: 'Task-02', to: 'Task-01', kind: 'chain' },
      { from: 'Task-03', to: 'Task-01', kind: 'branch' },
      { from: 'Task-03', to: 'Task-02', kind: 'branch' },
      { from: 'Task-04', to: 'Task-99', kind: 'external' },
    ]);
  });

  it('gives a root no edge and an empty list an empty rail', () => {
    expect(railEdges([ROOT])).toEqual([]);
    expect(railEdges([])).toEqual([]);
    expect(railEdges(ITEMS).some((edge) => edge.from === 'Task-01')).toBe(false);
  });

  it('prefers external over branch when the target is missing', () => {
    const source: BacklogItem = { ...BRANCH, needs: ['Task-01', 'Task-99'] };
    expect(railEdges([ROOT, source])).toEqual([
      { from: 'Task-03', to: 'Task-01', kind: 'branch' },
      { from: 'Task-03', to: 'Task-99', kind: 'external' },
    ]);
  });
});

describe('unmetNeeds', () => {
  it('lists a missing target and an unchecked target together, in need order', () => {
    expect(unmetNeeds(BRANCH, ITEMS)).toEqual(['Task-02']);
    expect(unmetNeeds(EXTERNAL, ITEMS)).toEqual(['Task-99']);
    expect(unmetNeeds(BRANCH, [CHAIN])).toEqual(['Task-01', 'Task-02']);
  });

  it('answers none for a root and for an item whose needs are checked', () => {
    expect(unmetNeeds(ROOT, ITEMS)).toEqual([]);
    expect(unmetNeeds(CHAIN, [ROOT])).toEqual([]);
  });
});
