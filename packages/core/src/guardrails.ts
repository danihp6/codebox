import type { BlockerCode, GuardrailId } from '@codebox/contracts';
import { scanProtectedPaths } from './protected-paths.js';

export interface GuardrailFact {
  readonly id: GuardrailId;
  readonly state: 'pass' | 'fail' | 'skip';
  readonly reason?: string;
}

export interface MergeBlocker {
  readonly code: BlockerCode;
  readonly message: string;
}

export interface MergeFacts {
  readonly gate: { readonly status: 'passed' | 'failed' | 'skipped'; readonly exitCode: number };
  readonly checks: readonly {
    readonly name: string;
    readonly conclusion: 'success' | 'failure' | 'neutral' | 'skipped' | 'pending' | 'cancelled';
  }[];
  readonly pullRequest: {
    readonly mergeable: boolean;
    readonly conflicting: boolean;
    readonly labels: readonly string[];
  };
  readonly base: { readonly recordedSha: string; readonly currentSha: string };
  readonly diff: { readonly files: number; readonly added: number; readonly removed: number };
  readonly changedPaths: readonly string[];
  readonly policy: {
    readonly repo: 'auto' | 'manual';
    readonly job: 'auto' | 'manual';
    readonly automerge: 'on' | 'off';
    readonly probationRuns: number;
    readonly consecutiveGreenRuns: number;
  };
  readonly budget: { readonly maxFiles: number; readonly maxLines: number };
  readonly protectedPaths: readonly string[];
}

export interface MergeEvaluation {
  readonly merge: boolean;
  readonly guardrails: readonly GuardrailFact[];
  readonly blockers: readonly MergeBlocker[];
}

const DO_NOT_MERGE_LABEL = 'do-not-merge';

export function evaluateAutoMerge(facts: MergeFacts): MergeEvaluation {
  const guardrails: GuardrailFact[] = [];
  const blockers: MergeBlocker[] = [];

  const record = (id: GuardrailId, found: readonly MergeBlocker[]): void => {
    const first = found[0];
    if (first === undefined) {
      guardrails.push({ id, state: 'pass' });
      return;
    }
    guardrails.push({ id, state: 'fail', reason: first.code });
    blockers.push(...found);
  };

  record(
    'gate',
    facts.gate.status === 'passed' && facts.gate.exitCode === 0
      ? []
      : [
          {
            code: 'gate_failed',
            message: `The gate exited with code ${facts.gate.exitCode}.`,
          },
        ],
  );

  const checksBlockers: MergeBlocker[] = [];
  const redCheck = facts.checks.find((check) => check.conclusion !== 'success');
  if (redCheck !== undefined) {
    checksBlockers.push({
      code: 'checks_red',
      message: `Required checks are not green: ${redCheck.name}.`,
    });
  }
  if (!facts.pullRequest.mergeable || facts.pullRequest.conflicting) {
    checksBlockers.push({
      code: 'not_mergeable',
      message: 'The pull request is not mergeable.',
    });
  }
  record('checks', checksBlockers);

  record(
    'base',
    facts.base.recordedSha === facts.base.currentSha
      ? []
      : [{ code: 'base_moved', message: 'The base branch moved during the run.' }],
  );

  const lines = facts.diff.added + facts.diff.removed;
  record(
    'diff',
    facts.diff.files > facts.budget.maxFiles || lines > facts.budget.maxLines
      ? [
          {
            code: 'diff_budget',
            message: `The diff is too large: ${facts.diff.files} files, ${lines} changed.`,
          },
        ]
      : [],
  );

  const hits = scanProtectedPaths(facts.changedPaths, facts.protectedPaths);
  const firstHit = hits[0];
  record(
    'protected_paths',
    firstHit === undefined
      ? []
      : [{ code: 'protected_path', message: `The diff touches ${firstHit.path}.` }],
  );

  record(
    'labels',
    facts.pullRequest.labels.includes(DO_NOT_MERGE_LABEL)
      ? [
          {
            code: 'label_do_not_merge',
            message: 'The pull request carries the do-not-merge label.',
          },
        ]
      : [],
  );

  const policyBlockers: MergeBlocker[] = [];
  if (facts.policy.repo !== 'auto' || facts.policy.job !== 'auto') {
    policyBlockers.push({
      code: 'policy_manual',
      message: 'Auto-merge is not enabled for this repository and job.',
    });
  } else if (
    facts.policy.probationRuns > 0 &&
    facts.policy.consecutiveGreenRuns < facts.policy.probationRuns
  ) {
    policyBlockers.push({
      code: 'policy_manual',
      message: `Probation is not met: ${facts.policy.consecutiveGreenRuns} of ${facts.policy.probationRuns} green runs.`,
    });
  }
  record('policy', policyBlockers);

  record(
    'automerger',
    facts.policy.automerge === 'on'
      ? []
      : [{ code: 'automerger_off', message: 'Auto-merge is switched off globally.' }],
  );

  return { merge: blockers.length === 0, guardrails, blockers };
}
