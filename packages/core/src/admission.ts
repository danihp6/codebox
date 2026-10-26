export interface AdmissionLimits {
  readonly maxConcurrency: number;
  readonly maxPerRepo: number;
}

export interface ActiveRunRef {
  readonly runId: string;
  readonly repoId: string;
}

export type AdmissionCode = 'slots_full' | 'repo_busy';

export type AdmissionDecision =
  { readonly admitted: true } | { readonly admitted: false; readonly code: AdmissionCode };

export interface AdmissionQuery {
  readonly repoId: string;
  readonly active: readonly ActiveRunRef[];
  readonly limits: AdmissionLimits;
}

export function canAdmitRun(query: AdmissionQuery): AdmissionDecision {
  let onRepo = 0;
  for (const run of query.active) {
    if (run.repoId === query.repoId) onRepo += 1;
  }
  if (onRepo >= query.limits.maxPerRepo) return { admitted: false, code: 'repo_busy' };
  if (query.active.length >= query.limits.maxConcurrency) {
    return { admitted: false, code: 'slots_full' };
  }
  return { admitted: true };
}
