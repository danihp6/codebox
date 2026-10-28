import type { MergeBlocker } from '@codebox/core';
import type { GitProvider, PullRequest } from '@codebox/git-provider';
import type { AgentRuntime } from '@codebox/opencode';
import type { EventRecord, Store } from '@codebox/store';
import type { GitRunner, WorkspaceManager } from '@codebox/workspaces';
import type { GateExecutionResult, runGate } from '../gate/run-gate.js';
import type { Logger } from '../logger.js';

export interface RunSettings {
  readonly gateDefault: string;
  readonly gateShell: string;
  readonly gateTimeoutSeconds: number;
  readonly runTimeoutSeconds: number;
  readonly maxConcurrency: number;
  readonly maxPerRepo: number;
  readonly dailyCostUsd: number;
  readonly automerge: 'on' | 'off';
  readonly mergeMethod: 'squash' | 'merge';
  readonly protectedPaths: readonly string[];
  readonly diffMaxFiles: number;
  readonly diffMaxLines: number;
  readonly probationRuns: number;
  readonly consecutiveGreenRuns: number;
  readonly approvalTtlSeconds: number;
  readonly logsDir: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly gitTimeoutMs: number;
}

export interface RunPorts {
  readonly workspaces: Pick<
    WorkspaceManager,
    'ensureClone' | 'createWorktree' | 'removeWorktree' | 'writeRunMarker' | 'status'
  >;
  readonly agent: Pick<
    AgentRuntime,
    'createSession' | 'prompt' | 'subscribe' | 'interrupt' | 'closeSession' | 'replyPermission'
  >;
  readonly git: Pick<
    GitProvider,
    | 'getRepo'
    | 'pushBranch'
    | 'openPullRequest'
    | 'getPullRequest'
    | 'getChecks'
    | 'mergePullRequest'
    | 'deleteBranch'
  >;
  readonly gitRunner: GitRunner;
  readonly gate: typeof runGate;
  readonly store: Store;
  readonly clock: () => Date;
  readonly logger: Logger;
  readonly emit: (event: EventRecord) => void;
  readonly spentTodayUsd: () => number;
  readonly settings: RunSettings;
}

export interface RunStartInput {
  readonly runId: string;
  readonly repo: {
    readonly id: string;
    readonly slug: string;
    readonly defaultBranch: string;
    readonly gate: string | null;
    readonly policy: 'auto' | 'manual';
    readonly protectedPaths: readonly string[];
    readonly cloneUrl: string;
  };
  readonly jobId: string | null;
  readonly trigger: 'schedule' | 'manual' | 'promote' | 'revert' | 'retry';
  readonly title: string;
  readonly prompt: string;
  readonly agent: string;
  readonly model: string | null;
  readonly baseRef?: string;
  /** D44: the work the run belongs to, written on `runs.work_id` by `queueRun`. */
  readonly workId?: string | null;
  /** D51: when set, the run's own commit flips this item's checkbox in the worktree. */
  readonly backlogRef?: string | null;
}

export interface RunOutcome {
  readonly runId: string;
  readonly state: 'succeeded' | 'failed' | 'cancelled' | 'pr_open';
  readonly pr: PullRequest | null;
  readonly gate: GateExecutionResult | null;
  readonly blockers: readonly MergeBlocker[];
  readonly failure: { readonly code: string; readonly message: string } | null;
}

export interface RunEngine {
  start(input: RunStartInput): Promise<RunOutcome>;
  cancel(runId: string, reason?: 'operator' | 'timeout' | 'cost_cap_reached'): Promise<boolean>;
  /** The ids of the runs whose flow is running, in start order; a waiting run is not active. */
  active(): readonly string[];
}

export { createRunEngine } from './engine.js';
