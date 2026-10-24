import { describe, expect, it } from 'vitest';
import type { RunState } from '@codebox/contracts';
import {
  CANCELLABLE_STATES,
  RUN_TRANSITIONS,
  TERMINAL_STATES,
  canCancel,
  canTransition,
  isTerminal,
  transitionRun,
} from './run-state.js';

const STATES: readonly RunState[] = [
  'queued',
  'preparing',
  'running',
  'gating',
  'pr_open',
  'merging',
  'succeeded',
  'failed',
  'cancelled',
];

const LEGAL: ReadonlyArray<readonly [RunState, RunState]> = [
  ['queued', 'preparing'],
  ['queued', 'failed'],
  ['queued', 'cancelled'],
  ['preparing', 'running'],
  ['preparing', 'failed'],
  ['preparing', 'cancelled'],
  ['running', 'gating'],
  ['running', 'failed'],
  ['running', 'cancelled'],
  ['gating', 'pr_open'],
  ['gating', 'failed'],
  ['gating', 'cancelled'],
  ['pr_open', 'merging'],
  ['pr_open', 'failed'],
  ['merging', 'succeeded'],
  ['merging', 'pr_open'],
  ['merging', 'failed'],
];

const CANCELLABLE: readonly RunState[] = ['queued', 'preparing', 'running', 'gating'];

describe('run state machine', () => {
  it('every legal transition is accepted and every illegal one is rejected', () => {
    expect(LEGAL).toHaveLength(17);
    for (const from of STATES) {
      for (const to of STATES) {
        const outcome = transitionRun(from, to);
        if (from === to) {
          expect(outcome.allowed).toBe(false);
          if (!outcome.allowed) {
            expect(outcome.code).toBe('same_state');
            expect(outcome.message).toBe(`Illegal transition ${from} → ${to}.`);
          }
          expect(canTransition(from, to)).toBe(false);
          continue;
        }
        if (TERMINAL_STATES.includes(from)) {
          expect(outcome.allowed).toBe(false);
          if (!outcome.allowed) {
            expect(outcome.code).toBe('terminal_state');
            expect(outcome.message).toBe(`Illegal transition ${from} → ${to}.`);
          }
          expect(canTransition(from, to)).toBe(false);
          continue;
        }
        const legal = LEGAL.some(([source, target]) => source === from && target === to);
        expect(outcome.allowed).toBe(legal);
        if (outcome.allowed) {
          expect(outcome.from).toBe(from);
          expect(outcome.to).toBe(to);
        } else {
          expect(outcome.code).toBe('illegal_transition');
          expect(outcome.message).toBe(`Illegal transition ${from} → ${to}.`);
        }
        expect(canTransition(from, to)).toBe(legal);
      }
    }
  });

  it('exposes the transition table, the terminal states and the cancellable states', () => {
    for (const from of STATES) {
      const expected = LEGAL.filter(([source]) => source === from).map(([, target]) => target);
      expect([...RUN_TRANSITIONS[from]]).toEqual(expected);
    }
    expect([...TERMINAL_STATES]).toEqual(['succeeded', 'failed', 'cancelled']);
    expect([...CANCELLABLE_STATES]).toEqual(['queued', 'preparing', 'running', 'gating']);
    for (const state of STATES) {
      expect(isTerminal(state)).toBe(TERMINAL_STATES.includes(state));
      expect(canCancel(state)).toBe(CANCELLABLE.includes(state));
    }
  });

  it('refuses to cancel a merging run and allows the re-evaluation edge back to pr_open', () => {
    expect(canCancel('merging')).toBe(false);
    const cancel = transitionRun('merging', 'cancelled');
    expect(cancel.allowed).toBe(false);
    if (!cancel.allowed) expect(cancel.code).toBe('illegal_transition');
    const reevaluate = transitionRun('merging', 'pr_open');
    expect(reevaluate.allowed).toBe(true);
  });

  it('reports a move out of a terminal state before the table lookup', () => {
    const outcome = transitionRun('succeeded', 'failed');
    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) expect(outcome.code).toBe('terminal_state');
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('pr_open')).toBe(false);
  });
});
