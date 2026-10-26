import { describe, expect, it } from 'vitest';
import { canAdmitRun } from './admission.js';
import type { ActiveRunRef, AdmissionLimits, AdmissionQuery } from './admission.js';

const LIMITS: AdmissionLimits = { maxConcurrency: 3, maxPerRepo: 1 };

function activeRun(runId: string, repoId: string): ActiveRunRef {
  return { runId, repoId };
}

function query(
  repoId: string,
  active: readonly ActiveRunRef[],
  limits: AdmissionLimits = LIMITS,
): AdmissionQuery {
  return { repoId, active, limits };
}

describe('canAdmitRun', () => {
  it('refuses a busy repository before a full queue', () => {
    const active = [activeRun('run_0001', 'repo_a'), activeRun('run_0002', 'repo_b')];
    const decision = canAdmitRun(query('repo_a', active, { maxConcurrency: 2, maxPerRepo: 1 }));
    expect(decision).toEqual({ admitted: false, code: 'repo_busy' });

    const full = canAdmitRun(query('repo_c', active, { maxConcurrency: 1, maxPerRepo: 2 }));
    expect(full).toEqual({ admitted: false, code: 'slots_full' });

    const admittedQuery = query('repo_c', active, { maxConcurrency: 3, maxPerRepo: 2 });
    const before = structuredClone(admittedQuery);
    const first = canAdmitRun(admittedQuery);
    const second = canAdmitRun(admittedQuery);
    expect(first).toEqual({ admitted: true });
    expect(second).toEqual({ admitted: true });
    expect(first).not.toBe(second);
    expect(admittedQuery).toEqual(before);
    expect(admittedQuery.active).toHaveLength(2);
    expect(admittedQuery.active.map((run) => run.repoId)).toEqual(['repo_a', 'repo_b']);
  });

  it('admits while both limits have room', () => {
    expect(canAdmitRun(query('repo_c', [activeRun('run_0001', 'repo_a')]))).toEqual({
      admitted: true,
    });
    expect(canAdmitRun(query('repo_a', []))).toEqual({ admitted: true });
  });

  it('treats a zero limit as no room', () => {
    const zeroGlobal = canAdmitRun(query('repo_a', [], { maxConcurrency: 0, maxPerRepo: 1 }));
    expect(zeroGlobal).toEqual({ admitted: false, code: 'slots_full' });
    const zeroRepo = canAdmitRun(query('repo_a', [], { maxConcurrency: 3, maxPerRepo: 0 }));
    expect(zeroRepo).toEqual({ admitted: false, code: 'repo_busy' });
    expect(canAdmitRun(query('repo_b', [], { maxConcurrency: 0, maxPerRepo: 0 }))).toEqual({
      admitted: false,
      code: 'repo_busy',
    });
  });
});
