import { describe, expect, it } from 'vitest';
import { canAdmitRun } from '../../core/src/admission.js';
import type { ActiveRunRef, AdmissionLimits } from '../../core/src/admission.js';
import { planAdmission } from './admission.js';
import type { AdmissionDeps, AdmissionInput, WaitingRun } from './admission.js';

const deps: AdmissionDeps = { admit: canAdmitRun };
const LIMITS: AdmissionLimits = { maxConcurrency: 3, maxPerRepo: 1 };

function waitingRun(runId: string, repoId: string, createdAt = '2026-10-25T10:00:00Z'): WaitingRun {
  return { runId, repoId, createdAt };
}

function activeRun(runId: string, repoId: string): ActiveRunRef {
  return { runId, repoId };
}

function input(
  waiting: readonly WaitingRun[],
  active: readonly ActiveRunRef[] = [],
  limits: AdmissionLimits = LIMITS,
): AdmissionInput {
  return { active, waiting, limits };
}

const SHUFFLED = [
  waitingRun('run_0004', 'repo_d'),
  waitingRun('run_0002', 'repo_b'),
  waitingRun('run_0003', 'repo_c'),
  waitingRun('run_0001', 'repo_a'),
];

describe('planAdmission', () => {
  it('fills three slots in repository order', () => {
    const plan = planAdmission(deps, input(SHUFFLED));
    expect(plan.admitted.map((run) => run.repoId)).toEqual(['repo_a', 'repo_b', 'repo_c']);
    expect(plan.admitted.map((run) => run.runId)).toEqual(['run_0001', 'run_0002', 'run_0003']);
    expect(plan.waiting.map((run) => run.repoId)).toEqual(['repo_d']);
  });

  it('leaves the fourth run waiting', () => {
    const plan = planAdmission(deps, input(SHUFFLED));
    expect(plan.waiting.map((run) => run.repoId)).toEqual(['repo_d']);
    expect(plan.waiting.map((run) => run.runId)).toEqual(['run_0004']);
    expect(plan.admitted).toHaveLength(3);
  });

  it('skips a busy repository and admits the next one', () => {
    const active = [activeRun('run_live', 'repo_a')];
    const waiting = [waitingRun('run_0002', 'repo_b'), waitingRun('run_0001', 'repo_a')];
    const plan = planAdmission(deps, input(waiting, active));
    expect(plan.admitted.map((run) => run.repoId)).toEqual(['repo_b']);
    expect(plan.waiting.map((run) => run.repoId)).toEqual(['repo_a']);
  });

  it('is deterministic for the same input', () => {
    const source = SHUFFLED;
    const first = planAdmission(deps, input(source));
    const second = planAdmission(deps, input(source));
    expect(first).toEqual(second);
    expect(source.map((run) => run.runId)).toEqual([
      'run_0004',
      'run_0002',
      'run_0003',
      'run_0001',
    ]);
    expect(second.admitted[0]).toBe(source[3]);

    const tied = [
      waitingRun('run_b', 'repo_a', '2026-10-25T10:00:00Z'),
      waitingRun('run_a', 'repo_a', '2026-10-25T10:00:00Z'),
      waitingRun('run_c', 'repo_a', '2026-10-24T10:00:00Z'),
    ];
    const planned = planAdmission(deps, input(tied, [], { maxConcurrency: 3, maxPerRepo: 3 }));
    expect(planned.admitted.map((run) => run.runId)).toEqual(['run_c', 'run_a', 'run_b']);
  });
});
