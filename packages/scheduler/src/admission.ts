import type {
  ActiveRunRef,
  AdmissionDecision,
  AdmissionLimits,
  AdmissionQuery,
} from '@codebox/core';

export interface WaitingRun {
  readonly runId: string;
  readonly repoId: string;
  readonly createdAt: string;
}

export interface AdmissionInput {
  readonly active: readonly ActiveRunRef[];
  readonly waiting: readonly WaitingRun[];
  readonly limits: AdmissionLimits;
}

export interface AdmissionPlan {
  readonly admitted: readonly WaitingRun[];
  readonly waiting: readonly WaitingRun[];
}

export interface AdmissionDeps {
  readonly admit: (query: AdmissionQuery) => AdmissionDecision;
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareWaiting(left: WaitingRun, right: WaitingRun): number {
  const byRepo = compareStrings(left.repoId, right.repoId);
  if (byRepo !== 0) return byRepo;
  const leftMs = Date.parse(left.createdAt);
  const rightMs = Date.parse(right.createdAt);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
    return leftMs < rightMs ? -1 : 1;
  }
  const byCreatedAt = compareStrings(left.createdAt, right.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return compareStrings(left.runId, right.runId);
}

export function planAdmission(deps: AdmissionDeps, input: AdmissionInput): AdmissionPlan {
  const candidates = [...input.waiting].sort(compareWaiting);
  const simulated: ActiveRunRef[] = [...input.active];
  const admitted: WaitingRun[] = [];
  const waiting: WaitingRun[] = [];
  for (const candidate of candidates) {
    const decision = deps.admit({
      repoId: candidate.repoId,
      active: simulated,
      limits: input.limits,
    });
    if (decision.admitted) {
      admitted.push(candidate);
      simulated.push({ runId: candidate.runId, repoId: candidate.repoId });
    } else {
      waiting.push(candidate);
    }
  }
  return { admitted, waiting };
}
