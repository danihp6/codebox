import { describe, expect, it } from 'vitest';
import type { BlockerCode, GuardrailId } from '@codebox/contracts';
import { evaluateAutoMerge } from './guardrails.js';
import type { MergeFacts } from './guardrails.js';
import { DEFAULT_PROTECTED_PATHS } from './protected-paths.js';

const GUARDRAIL_ORDER: readonly GuardrailId[] = [
  'gate',
  'checks',
  'base',
  'diff',
  'protected_paths',
  'labels',
  'policy',
  'automerger',
];

const RECORDED_SHA = '4f1c2ab7d9e0a1b2c3d4e5f60718293a4b5c6d7e';

function greenFacts(): MergeFacts {
  return {
    gate: { status: 'passed', exitCode: 0 },
    checks: [
      { name: 'ci', conclusion: 'success' },
      { name: 'lint', conclusion: 'success' },
    ],
    pullRequest: { mergeable: true, conflicting: false, labels: ['cb:auto-merge'] },
    base: { recordedSha: RECORDED_SHA, currentSha: RECORDED_SHA },
    diff: { files: 6, added: 184, removed: 22 },
    changedPaths: ['src/index.ts', 'packages/core/src/cron.ts'],
    policy: {
      repo: 'auto',
      job: 'auto',
      automerge: 'on',
      probationRuns: 0,
      consecutiveGreenRuns: 0,
    },
    budget: { maxFiles: 40, maxLines: 2000 },
    protectedPaths: DEFAULT_PROTECTED_PATHS,
  };
}

interface RedCase {
  readonly id: GuardrailId;
  readonly code: BlockerCode;
  readonly message: string;
  readonly facts: MergeFacts;
}

const RED_CASES: readonly RedCase[] = [
  {
    id: 'gate',
    code: 'gate_failed',
    message: 'The gate exited with code 2.',
    facts: { ...greenFacts(), gate: { status: 'failed', exitCode: 2 } },
  },
  {
    id: 'gate',
    code: 'gate_failed',
    message: 'The gate exited with code 0.',
    facts: { ...greenFacts(), gate: { status: 'skipped', exitCode: 0 } },
  },
  {
    id: 'checks',
    code: 'checks_red',
    message: 'Required checks are not green: ci.',
    facts: {
      ...greenFacts(),
      checks: [
        { name: 'ci', conclusion: 'failure' },
        { name: 'lint', conclusion: 'success' },
      ],
    },
  },
  {
    id: 'checks',
    code: 'not_mergeable',
    message: 'The pull request is not mergeable.',
    facts: {
      ...greenFacts(),
      pullRequest: { mergeable: false, conflicting: false, labels: [] },
    },
  },
  {
    id: 'checks',
    code: 'not_mergeable',
    message: 'The pull request is not mergeable.',
    facts: {
      ...greenFacts(),
      pullRequest: { mergeable: true, conflicting: true, labels: [] },
    },
  },
  {
    id: 'base',
    code: 'base_moved',
    message: 'The base branch moved during the run.',
    facts: {
      ...greenFacts(),
      base: { recordedSha: RECORDED_SHA, currentSha: 'a'.repeat(40) },
    },
  },
  {
    id: 'diff',
    code: 'diff_budget',
    message: 'The diff is too large: 41 files, 1722 changed.',
    facts: { ...greenFacts(), diff: { files: 41, added: 1600, removed: 122 } },
  },
  {
    id: 'protected_paths',
    code: 'protected_path',
    message: 'The diff touches .github/workflows/ci.yml.',
    facts: {
      ...greenFacts(),
      changedPaths: ['src/index.ts', '.github/workflows/ci.yml'],
    },
  },
  {
    id: 'labels',
    code: 'label_do_not_merge',
    message: 'The pull request carries the do-not-merge label.',
    facts: {
      ...greenFacts(),
      pullRequest: {
        mergeable: true,
        conflicting: false,
        labels: ['cb:auto-merge', 'do-not-merge'],
      },
    },
  },
  {
    id: 'policy',
    code: 'policy_manual',
    message: 'Auto-merge is not enabled for this repository and job.',
    facts: {
      ...greenFacts(),
      policy: { ...greenFacts().policy, repo: 'manual' },
    },
  },
  {
    id: 'policy',
    code: 'policy_manual',
    message: 'Auto-merge is not enabled for this repository and job.',
    facts: {
      ...greenFacts(),
      policy: { ...greenFacts().policy, job: 'manual' },
    },
  },
  {
    id: 'policy',
    code: 'policy_manual',
    message: 'Probation is not met: 1 of 3 green runs.',
    facts: {
      ...greenFacts(),
      policy: { ...greenFacts().policy, probationRuns: 3, consecutiveGreenRuns: 1 },
    },
  },
  {
    id: 'automerger',
    code: 'automerger_off',
    message: 'Auto-merge is switched off globally.',
    facts: {
      ...greenFacts(),
      policy: { ...greenFacts().policy, automerge: 'off' },
    },
  },
];

describe('guardrails', () => {
  it('each guardrail is red and green', () => {
    const green = evaluateAutoMerge(greenFacts());
    expect(green.merge).toBe(true);
    expect(green.blockers).toEqual([]);
    expect(green.guardrails).toHaveLength(8);
    expect(green.guardrails.map((fact) => fact.id)).toEqual(GUARDRAIL_ORDER);
    for (const fact of green.guardrails) {
      expect(fact.state).toBe('pass');
      expect(fact.reason).toBeUndefined();
    }

    for (const redCase of RED_CASES) {
      const evaluation = evaluateAutoMerge(redCase.facts);
      expect(evaluation.merge).toBe(false);
      expect(evaluation.blockers).toHaveLength(1);
      const [blocker] = evaluation.blockers;
      expect(blocker?.code).toBe(redCase.code);
      expect(blocker?.message).toBe(redCase.message);
      expect(evaluation.guardrails).toHaveLength(8);
      expect(evaluation.guardrails.map((fact) => fact.id)).toEqual(GUARDRAIL_ORDER);
      const fact = evaluation.guardrails.find((entry) => entry.id === redCase.id);
      expect(fact).toEqual({ id: redCase.id, state: 'fail', reason: redCase.code });
      for (const other of evaluation.guardrails) {
        if (other.id === redCase.id) continue;
        expect(other.state).toBe('pass');
      }
    }
  });

  it('reports the mergeability failure on the checks guardrail after the red check', () => {
    const facts: MergeFacts = {
      ...greenFacts(),
      checks: [{ name: 'ci', conclusion: 'pending' }],
      pullRequest: { mergeable: false, conflicting: true, labels: [] },
    };
    const evaluation = evaluateAutoMerge(facts);
    expect(evaluation.merge).toBe(false);
    expect(evaluation.blockers.map((blocker) => blocker.code)).toEqual([
      'checks_red',
      'not_mergeable',
    ]);
    const checks = evaluation.guardrails.find((fact) => fact.id === 'checks');
    expect(checks).toEqual({ id: 'checks', state: 'fail', reason: 'checks_red' });
  });

  it('keeps every guardrail red and every blocker when more than one rule fails', () => {
    const facts: MergeFacts = {
      ...greenFacts(),
      gate: { status: 'failed', exitCode: 1 },
      base: { recordedSha: RECORDED_SHA, currentSha: 'b'.repeat(40) },
      diff: { files: 90, added: 900, removed: 900 },
      changedPaths: ['ops/vm/install.sh'],
      pullRequest: { mergeable: true, conflicting: false, labels: ['do-not-merge'] },
      policy: { ...greenFacts().policy, repo: 'manual', automerge: 'off' },
    };
    const evaluation = evaluateAutoMerge(facts);
    expect(evaluation.merge).toBe(false);
    expect(evaluation.guardrails.map((fact) => fact.state)).toEqual([
      'fail',
      'pass',
      'fail',
      'fail',
      'fail',
      'fail',
      'fail',
      'fail',
    ]);
    expect(evaluation.blockers.map((blocker) => blocker.code)).toEqual([
      'gate_failed',
      'base_moved',
      'diff_budget',
      'protected_path',
      'label_do_not_merge',
      'policy_manual',
      'automerger_off',
    ]);
  });

  it('treats an empty check list as green and cannot approve a skipped gate', () => {
    const noChecks = evaluateAutoMerge({ ...greenFacts(), checks: [] });
    expect(noChecks.merge).toBe(true);
    const skipped = evaluateAutoMerge({
      ...greenFacts(),
      gate: { status: 'skipped', exitCode: 1 },
    });
    expect(skipped.merge).toBe(false);
    expect(skipped.blockers[0]?.code).toBe('gate_failed');
  });
});
