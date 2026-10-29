import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import type { RunPatch, RunRecord, EventRecord } from '@codebox/store';
import type { PullRequest, CheckRun, MergeReason } from '@codebox/git-provider';
import { toPullRequestRef } from '@codebox/git-provider';
import { GitProviderError } from '@codebox/git-provider';
import type { RunState, RunDiff } from '@codebox/contracts';
import {
  canAdmitRun,
  canCancel,
  checkCost,
  checkRunTimeout,
  classifyDesignFindings,
  decidePermission,
  designRuleEnforcement,
  evaluateAutoMerge,
  transitionRun,
} from '@codebox/core';
import type {
  ActiveRunRef,
  AdmissionLimits,
  GuardrailFact,
  MergeBlocker,
  MergeFacts,
} from '@codebox/core';
import { AgentError, buildRunEnvelope, createNormaliser } from '@codebox/opencode';
import type {
  ApprovalRequestSignal,
  Normalise,
  NormalisedEvent,
  RawAgentEvent,
} from '@codebox/opencode';
import { sha256Hex, formatSecretFinding } from '@codebox/security';
import { planAdmission } from '@codebox/scheduler';
import type { WaitingRun } from '@codebox/scheduler';
import { withTransaction } from '@codebox/store';
import { WorkspaceError, branchName } from '@codebox/workspaces';
import type { RepoInfo } from '@codebox/git-provider';
import type { Worktree, WorkspaceStatus } from '@codebox/workspaces';
import { GATE_TAIL_LINES } from '../gate/run-gate.js';
import type { GateExecutionResult } from '../gate/run-gate.js';
import { DesignScanError, formatDesignFinding, scanDesign } from '../gate/design-check.js';
import type { DesignScanOutcome } from '../gate/design-check.js';
import { SecretScanError, scanWorktree } from '../gate/secret-scan.js';
import { commitWorktree } from './commit.js';
import { createRunEventWriter } from './events.js';
import type { RunEventName, RunEventWriter } from './events.js';
import { buildPrBody } from './pr-body.js';
import type { RunEngine, RunOutcome, RunPorts, RunStartInput } from './ports.js';

type RunFailureCode =
  | 'agent_unavailable'
  | 'protocol'
  | 'provider_unavailable'
  | 'workspace_error'
  | 'internal'
  | 'timeout'
  | 'cost_cap_reached'
  | 'gate_failed';

interface EventSpec {
  readonly event: RunEventName;
  readonly data: Readonly<Record<string, unknown>>;
}

interface RunContext {
  readonly input: RunStartInput;
  readonly branch: string;
  readonly baseRef: string;
  readonly gateCommand: string;
  readonly events: RunEventWriter;
  readonly abort: AbortController;
  readonly cancelSignal: Promise<void>;
  resolveCancel: () => void;
  state: RunState;
  cancelled: boolean;
  cancelReason: 'operator' | 'timeout' | 'cost_cap_reached' | null;
  cancelCode: RunFailureCode | null;
  worktree: Worktree | null;
  repoInfo: RepoInfo | null;
  sessionId: string | null;
  status: WorkspaceStatus | null;
  gate: GateExecutionResult | null;
  pr: PullRequest | null;
  guardrails: readonly GuardrailFact[];
  blockers: readonly MergeBlocker[];
  cost: { usd: number; tokensIn: number; tokensOut: number };
  agentMessage: string;
  sawTool: boolean;
  startedAt: string | null;
}

interface ActiveRun {
  readonly ctx: RunContext;
  readonly promise: Promise<RunOutcome>;
}

interface WaitingEntry {
  readonly ctx: RunContext;
  readonly createdAt: string;
  readonly resolve: () => void;
}

class RunFailure extends Error {
  readonly code: RunFailureCode;

  constructor(code: RunFailureCode, detail: string) {
    super(detail);
    this.name = 'RunFailure';
    this.code = code;
  }
}

const FAILURE_MESSAGES: Readonly<Record<RunFailureCode, string>> = Object.freeze({
  agent_unavailable: 'The agent was unavailable.',
  protocol: 'The agent stream could not be read.',
  provider_unavailable: 'The git provider was unavailable.',
  workspace_error: 'The workspace could not be prepared.',
  internal: 'The run failed internally.',
  timeout: 'The run exceeded its time limit.',
  cost_cap_reached: 'The daily cost cap was reached.',
  gate_failed: 'The gate failed.',
});

const INSPECTABLE_FAILURES: readonly RunFailureCode[] = Object.freeze([
  'agent_unavailable',
  'protocol',
  'gate_failed',
]);

const MERGE_LABELS: readonly string[] = Object.freeze(['cb:auto-merge']);
const MAX_AGENT_ATTEMPTS = 2;
const AGENT_MESSAGE_MAX_CHARS = 8_000;
const RUN_TRAILER_PREFIX = 'Codebox-Run: ';
const BACKLOG_TICK_PATH = 'TODO.md';
const PERMISSION_PATH_KEYS: readonly string[] = Object.freeze(['filePath', 'path']);
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

interface StepEvent {
  readonly kind: 'event';
  readonly value: RawAgentEvent;
}
interface StepEnd {
  readonly kind: 'end';
}
interface StepPromptError {
  readonly kind: 'prompt_error';
}
interface StepCancelled {
  readonly kind: 'cancelled';
}
type PumpStep = StepEvent | StepEnd | StepPromptError | StepCancelled;

function never(): Promise<never> {
  return new Promise<never>(() => undefined);
}

function failureMessage(code: RunFailureCode): string {
  return FAILURE_MESSAGES[code];
}

/**
 * The one extractor for the path a permission request names: `filePath` first, then `path`, and a
 * non-string value is skipped. The chat path reuses it, so the two policies read the same field.
 */
export function permissionPath(input: Readonly<Record<string, unknown>>): string | null {
  for (const key of PERMISSION_PATH_KEYS) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function asRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function diffStatOf(diff: RunDiff): { files: number; added: number; removed: number } {
  return { files: diff.files, added: diff.added, removed: diff.removed };
}

function blockerForMerge(reason: MergeReason): MergeBlocker {
  switch (reason) {
    case 'head_moved':
      return { code: 'base_moved', message: 'The base branch moved during the run.' };
    case 'checks_red':
      return { code: 'checks_red', message: 'Required checks are not green.' };
    case 'not_mergeable':
    case 'method_not_allowed':
    case 'merged':
    default:
      return { code: 'not_mergeable', message: 'The pull request could not be merged.' };
  }
}

function validSha(sha: string | null, fallback: string): string {
  if (sha !== null && SHA_PATTERN.test(sha)) return sha;
  return fallback;
}

/** The tail is the decision; the log is evidence, so a write failure never changes the verdict. */
function appendToGateLog(logFile: string, lines: readonly string[]): void {
  try {
    appendFileSync(logFile, `${lines.join('\n')}\n`, 'utf8');
  } catch {
    // Swallowed on purpose: the gate tail already carries the same lines.
  }
}

export function createRunEngine(ports: RunPorts): RunEngine {
  const store = ports.store;
  const settings = ports.settings;
  const logger = ports.logger;
  const inflight = new Map<string, ActiveRun>();
  const activeOrder: string[] = [];
  const waiting = new Map<string, WaitingEntry>();

  function nowIso(): string {
    return ports.clock().toISOString();
  }

  function codeOf(error: unknown): string {
    if (error instanceof Error) return error.name;
    return 'unknown';
  }

  function logStepFailure(ctx: RunContext, step: string, error: unknown): void {
    // The message itself can carry an upstream body, so only the error's name is logged.
    logger.warn({ msg: 'run_step_failed', runId: ctx.input.runId, step, code: codeOf(error) });
  }

  function removeWorktree(ctx: RunContext): Promise<void> {
    const worktree = ctx.worktree;
    if (worktree === null) return Promise.resolve();
    return Promise.resolve(ports.workspaces.removeWorktree(worktree)).then(
      () => {
        ctx.worktree = null;
      },
      (error: unknown) => {
        logStepFailure(ctx, 'remove_worktree', error);
      },
    );
  }

  function transition(
    ctx: RunContext,
    to: RunState,
    patch: RunPatch,
    events: readonly EventSpec[] = [],
  ): void {
    const outcome = transitionRun(ctx.state, to);
    if (!outcome.allowed) {
      throw new RunFailure('internal', `illegal transition ${ctx.state} → ${to}`);
    }
    const records: EventRecord[] = [];
    withTransaction(store.db, () => {
      store.runs.update(ctx.input.runId, { ...patch, state: to });
      for (const spec of events) records.push(ctx.events.appendRun(spec.event, spec.data));
    });
    ctx.state = to;
    for (const record of records) ports.emit(record);
  }

  function amend(ctx: RunContext, patch: RunPatch, events: readonly EventSpec[] = []): void {
    const records: EventRecord[] = [];
    withTransaction(store.db, () => {
      store.runs.update(ctx.input.runId, patch);
      for (const spec of events) records.push(ctx.events.appendRun(spec.event, spec.data));
    });
    for (const record of records) ports.emit(record);
  }

  function createContext(input: RunStartInput): RunContext {
    let resolveCancel: () => void = () => undefined;
    const cancelSignal = new Promise<void>((resolve) => {
      resolveCancel = resolve;
    });
    return {
      input,
      branch: branchName(input.runId, input.title),
      baseRef: input.baseRef ?? input.repo.defaultBranch,
      gateCommand: input.repo.gate ?? settings.gateDefault,
      events: createRunEventWriter({ store, clock: ports.clock, runId: input.runId }),
      abort: new AbortController(),
      cancelSignal,
      resolveCancel,
      state: 'queued',
      cancelled: false,
      cancelReason: null,
      cancelCode: null,
      worktree: null,
      repoInfo: null,
      sessionId: null,
      status: null,
      gate: null,
      pr: null,
      guardrails: [],
      blockers: [],
      cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
      agentMessage: '',
      sawTool: false,
      startedAt: null,
    };
  }

  function cancelledOutcome(ctx: RunContext): RunOutcome {
    const failure =
      ctx.cancelCode === null
        ? null
        : { code: ctx.cancelCode, message: failureMessage(ctx.cancelCode) };
    return {
      runId: ctx.input.runId,
      state: 'cancelled',
      pr: ctx.pr,
      gate: ctx.gate,
      blockers: ctx.blockers,
      failure,
    };
  }

  function prOpenOutcome(ctx: RunContext): RunOutcome {
    return {
      runId: ctx.input.runId,
      state: 'pr_open',
      pr: ctx.pr,
      gate: ctx.gate,
      blockers: ctx.blockers,
      failure: null,
    };
  }

  function stateOutcome(ctx: RunContext): RunOutcome['state'] {
    switch (ctx.state) {
      case 'succeeded':
        return 'succeeded';
      case 'cancelled':
        return 'cancelled';
      case 'pr_open':
        return 'pr_open';
      default:
        return 'failed';
    }
  }

  function queue(ctx: RunContext): void {
    const existing = store.runs.getRecord(ctx.input.runId);
    if (existing !== null) {
      // A scheduler claim already owns the row; the engine adopts it instead of inserting twice.
      if (existing.state !== 'queued') {
        throw new RunFailure('internal', 'the run id is already in a live state');
      }
      ctx.state = 'queued';
      return;
    }
    const createdAt = nowIso();
    const record: RunRecord = {
      id: ctx.input.runId,
      repoId: ctx.input.repo.id,
      jobId: ctx.input.jobId,
      state: 'queued',
      trigger: ctx.input.trigger,
      branch: ctx.branch,
      baseRef: ctx.baseRef,
      pr: null,
      gate: null,
      guardrails: [],
      blockers: [],
      diff: null,
      cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
      createdAt,
      finishedAt: null,
      baseSha: null,
      worktree: null,
      sessionId: null,
      prompt: ctx.input.prompt,
      promptHash: null,
      agent: ctx.input.agent,
      model: ctx.input.model,
      gateCommand: ctx.gateCommand,
      scheduledFor: null,
      attempt: 1,
      failureCode: null,
      failureMessage: null,
      startedAt: null,
    };
    const records: EventRecord[] = [];
    withTransaction(store.db, () => {
      store.runs.create(record);
      records.push(
        ctx.events.appendRun('run.queued', {
          repoId: ctx.input.repo.id,
          jobId: ctx.input.jobId,
          trigger: ctx.input.trigger,
        }),
      );
    });
    ctx.state = 'queued';
    for (const entry of records) ports.emit(entry);
    logger.info({ msg: 'run_queued', runId: ctx.input.runId, branch: ctx.branch });
  }

  function admissionLimits(): AdmissionLimits {
    return { maxConcurrency: settings.maxConcurrency, maxPerRepo: settings.maxPerRepo };
  }

  function activeRefs(): ActiveRunRef[] {
    const refs: ActiveRunRef[] = [];
    for (const runId of activeOrder) {
      const entry = inflight.get(runId);
      if (entry !== undefined) refs.push({ runId, repoId: entry.ctx.input.repo.id });
    }
    return refs;
  }

  function replan(): void {
    if (waiting.size === 0) return;
    const candidates: WaitingRun[] = [];
    for (const entry of waiting.values()) {
      candidates.push({
        runId: entry.ctx.input.runId,
        repoId: entry.ctx.input.repo.id,
        createdAt: entry.createdAt,
      });
    }
    const plan = planAdmission(
      { admit: canAdmitRun },
      { active: activeRefs(), waiting: candidates, limits: admissionLimits() },
    );
    for (const run of plan.admitted) {
      const entry = waiting.get(run.runId);
      if (entry === undefined) continue;
      waiting.delete(run.runId);
      activeOrder.push(run.runId);
      logger.info({ msg: 'run_admitted', runId: run.runId, repoId: run.repoId });
      entry.resolve();
    }
  }

  function releaseSlot(ctx: RunContext): void {
    const index = activeOrder.indexOf(ctx.input.runId);
    if (index !== -1) activeOrder.splice(index, 1);
    waiting.delete(ctx.input.runId);
    replan();
  }

  async function admission(ctx: RunContext): Promise<void> {
    const decision = canAdmitRun({
      repoId: ctx.input.repo.id,
      active: activeRefs(),
      limits: admissionLimits(),
    });
    if (decision.admitted) {
      activeOrder.push(ctx.input.runId);
      return;
    }
    const record = store.runs.getRecord(ctx.input.runId);
    let resolveStart: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    waiting.set(ctx.input.runId, {
      ctx,
      createdAt: record === null ? nowIso() : record.createdAt,
      resolve: () => {
        resolveStart();
      },
    });
    logger.info({
      msg: 'run_waiting',
      runId: ctx.input.runId,
      repoId: ctx.input.repo.id,
      active: activeOrder.length,
      maxConcurrency: settings.maxConcurrency,
    });
    await started;
  }

  async function prepare(ctx: RunContext): Promise<void> {
    const repo = ctx.input.repo;
    transition(ctx, 'preparing', {});
    await ports.workspaces.ensureClone({
      slug: repo.slug,
      defaultBranch: repo.defaultBranch,
      cloneUrl: repo.cloneUrl,
    });
    if (ctx.cancelled) return;
    const worktree = await ports.workspaces.createWorktree({
      repo: { slug: repo.slug, defaultBranch: repo.defaultBranch, cloneUrl: repo.cloneUrl },
      runId: ctx.input.runId,
      baseRef: ctx.baseRef,
      title: ctx.input.title,
    });
    if (ctx.cancelled) {
      await ports.workspaces.removeWorktree(worktree);
      return;
    }
    const promptHash = sha256Hex(ctx.input.prompt);
    await ports.workspaces.writeRunMarker(worktree, {
      runId: ctx.input.runId,
      repoSlug: repo.slug,
      branch: worktree.branch,
      baseRef: ctx.baseRef,
      baseSha: worktree.baseSha,
      promptHash,
      createdAt: nowIso(),
    });
    if (ctx.cancelled) return;
    ctx.worktree = worktree;
    ctx.startedAt = nowIso();
    amend(ctx, {
      baseSha: worktree.baseSha,
      worktree: worktree.path,
      promptHash,
      startedAt: ctx.startedAt,
    });
  }

  async function resolveApproval(ctx: RunContext, signal: ApprovalRequestSignal): Promise<string> {
    const sessionId = ctx.sessionId;
    const worktree = ctx.worktree;
    if (sessionId === null || worktree === null) return signal.permissionId;
    const decision = decidePermission({
      tool: signal.tool,
      mode: 'run',
      path: permissionPath(signal.input),
      worktree: worktree.path,
    });
    if (decision === 'allow') {
      await ports.agent.replyPermission(sessionId, signal.permissionId, 'once');
      return signal.permissionId;
    }
    if (decision === 'deny') {
      logger.info({ msg: 'run_permission_denied', runId: ctx.input.runId, tool: signal.tool });
      await ports.agent.replyPermission(sessionId, signal.permissionId, 'reject');
      return signal.permissionId;
    }
    // `ask` cannot be answered in an unattended run, and a prompt nobody answers at 03:00 is not
    // a control (D45): the request is rejected in place and the run keeps going.
    logger.warn({ msg: 'run_permission_ask_rejected', runId: ctx.input.runId, tool: signal.tool });
    await ports.agent.replyPermission(sessionId, signal.permissionId, 'reject');
    return signal.permissionId;
  }

  function persistNormalised(ctx: RunContext, event: NormalisedEvent): void {
    // The engine already emitted the `run.started` of the running transition; the agent's own
    // busy marker would be a second event for the same state.
    if (event.event === 'run.started') return;
    const record = store.events.append({
      runId: ctx.input.runId,
      chatId: null,
      seq: event.data.seq,
      type: event.event,
      data: asRecord(event.data),
      ts: event.data.ts,
    });
    ports.emit(record);
    if (event.event === 'run.tool') ctx.sawTool = true;
    if (event.event === 'run.output') {
      const combined = ctx.agentMessage + event.data.delta;
      ctx.agentMessage =
        combined.length > AGENT_MESSAGE_MAX_CHARS
          ? combined.slice(-AGENT_MESSAGE_MAX_CHARS)
          : combined;
    }
  }

  async function recordUsage(
    ctx: RunContext,
    usage: { tokensIn: number; tokensOut: number; costUsd: number },
  ): Promise<boolean> {
    ctx.cost = {
      usd: ctx.cost.usd + usage.costUsd,
      tokensIn: ctx.cost.tokensIn + usage.tokensIn,
      tokensOut: ctx.cost.tokensOut + usage.tokensOut,
    };
    amend(ctx, { cost: ctx.cost });
    const guard = checkCost({
      spentTodayUsd: ports.spentTodayUsd(),
      dailyCapUsd: settings.dailyCostUsd,
      runCostUsd: ctx.cost.usd,
      jobMaxCostUsd: null,
    });
    if (guard.allowed) return false;
    await cancelRun(ctx, 'cost_cap_reached');
    return true;
  }

  async function timeoutExpired(ctx: RunContext): Promise<boolean> {
    if (ctx.cancelled) return true;
    if (ctx.startedAt === null) return false;
    const check = checkRunTimeout({
      startedAt: ctx.startedAt,
      now: nowIso(),
      timeoutSeconds: settings.runTimeoutSeconds,
    });
    if (!check.expired) return false;
    await cancelRun(ctx, 'timeout');
    return true;
  }

  function stepFromEvent(iterator: AsyncIterator<RawAgentEvent>): Promise<PumpStep> {
    return iterator.next().then((step): PumpStep => {
      if (step.done === true) return { kind: 'end' };
      return { kind: 'event', value: step.value };
    });
  }

  async function pump(ctx: RunContext, normalise: Normalise): Promise<void> {
    const sessionId = ctx.sessionId;
    if (sessionId === null) throw new RunFailure('internal', 'no agent session');
    const iterator = ports.agent.subscribe({ sessionId })[Symbol.asyncIterator]();
    let promptError: unknown = null;
    const promptSettled = ports.agent
      .prompt(
        sessionId,
        buildRunEnvelope({
          repo: ctx.input.repo.slug,
          baseBranch: ctx.baseRef,
          branch: ctx.branch,
          prompt: ctx.input.prompt,
        }),
      )
      .then(
        (): 'ok' => 'ok',
        (error: unknown): 'error' => {
          promptError = error;
          return 'error';
        },
      );
    const promptStep = promptSettled.then((settled): Promise<PumpStep> =>
      settled === 'error' ? Promise.resolve({ kind: 'prompt_error' }) : never(),
    );
    try {
      for (;;) {
        if (await timeoutExpired(ctx)) return;
        if (ctx.cancelled) return;
        const step = await Promise.race([
          stepFromEvent(iterator),
          promptStep,
          ctx.cancelSignal.then((): PumpStep => ({ kind: 'cancelled' })),
        ]);
        if (step.kind === 'cancelled') return;
        if (step.kind === 'prompt_error') throw promptError;
        if (step.kind === 'end') {
          throw new RunFailure('agent_unavailable', 'the agent event stream ended');
        }
        if (await timeoutExpired(ctx)) return;
        if (ctx.cancelled) return;
        const result = await normalise(step.value);
        if (ctx.cancelled) return;
        for (const event of result.events) persistNormalised(ctx, event);
        if (result.usage !== null) {
          if (await recordUsage(ctx, result.usage)) return;
        }
        if (result.outcome === 'idle') {
          const settled = await promptSettled;
          if (settled === 'error') throw promptError;
          return;
        }
        if (result.outcome === 'error') {
          const code =
            result.failure?.code === 'agent_unavailable' ? 'agent_unavailable' : 'protocol';
          throw new RunFailure(code, 'the agent reported an error');
        }
      }
    } finally {
      // Closing the stream is best effort and must never block the run: an iterator parked on
      // a silent agent only ends when the session is closed, which happens after this returns.
      void Promise.resolve(iterator.return?.(undefined)).catch(() => undefined);
    }
  }

  async function runAttempt(ctx: RunContext): Promise<void> {
    const worktree = ctx.worktree;
    if (worktree === null) throw new RunFailure('internal', 'no worktree');
    const session = await ports.agent.createSession({
      title: `cb-run-${ctx.input.runId}`,
      directory: worktree.path,
      agent: ctx.input.agent,
      model: ctx.input.model,
    });
    ctx.sessionId = session.sessionId;
    if (ctx.state === 'preparing') {
      transition(ctx, 'running', { sessionId: session.sessionId }, [
        { event: 'run.started', data: { branch: ctx.branch } },
      ]);
    } else {
      amend(ctx, { sessionId: session.sessionId });
    }
    const normalise = createNormaliser({
      scope: { kind: 'run', runId: ctx.input.runId, branch: ctx.branch },
      nextSeq: () => store.events.nextSeq({ runId: ctx.input.runId }),
      now: () => nowIso(),
      resolveApproval: (signal) => resolveApproval(ctx, signal),
    });
    await pump(ctx, normalise);
  }

  function isRetryableAgentFailure(error: unknown): boolean {
    if (error instanceof RunFailure) return error.code === 'agent_unavailable';
    if (error instanceof AgentError) {
      return error.code === 'agent_unavailable' || error.code === 'stream_lost';
    }
    return false;
  }

  async function closeSession(ctx: RunContext): Promise<void> {
    const sessionId = ctx.sessionId;
    if (sessionId === null) return;
    ctx.sessionId = null;
    try {
      await ports.agent.closeSession(sessionId);
    } catch (error) {
      logStepFailure(ctx, 'close_session', error);
    }
  }

  async function runAgentPhase(ctx: RunContext): Promise<void> {
    for (let attempt = 1; attempt <= MAX_AGENT_ATTEMPTS; attempt += 1) {
      try {
        await runAttempt(ctx);
        return;
      } catch (error) {
        if (ctx.cancelled) return;
        if (attempt === 1 && !ctx.sawTool && isRetryableAgentFailure(error)) {
          logger.warn({ msg: 'run_agent_retry', runId: ctx.input.runId, attempt: 2 });
          await closeSession(ctx);
          amend(ctx, { attempt: 2, sessionId: null });
          continue;
        }
        throw error;
      }
    }
  }

  async function gating(ctx: RunContext): Promise<GateExecutionResult> {
    const worktree = ctx.worktree;
    if (worktree === null) throw new RunFailure('internal', 'no worktree');
    transition(ctx, 'gating', {});
    const status = await ports.workspaces.status(worktree, ctx.input.repo.protectedPaths);
    ctx.status = status;
    const result = await ports.gate({
      cwd: worktree.path,
      command: ctx.gateCommand,
      shell: settings.gateShell,
      timeoutMs: settings.gateTimeoutSeconds * 1_000,
      runId: ctx.input.runId,
      logFile: join(settings.logsDir, `run-${ctx.input.runId}`, 'gate.log'),
      signal: ctx.abort.signal,
    });
    ctx.gate = result;
    if (ctx.cancelled) return result;
    const scanned = result.status === 'passed' ? await secretScanStep(ctx, result) : result;
    const designed =
      !ctx.cancelled && scanned.status === 'passed' ? await designScanStep(ctx, scanned) : scanned;
    ctx.gate = designed;
    const gate = {
      status: designed.status,
      exitCode: designed.exitCode,
      durationMs: designed.durationMs,
    };
    amend(ctx, { gate, diff: diffStatOf(status.diff) }, [{ event: 'run.gate', data: { gate } }]);
    return designed;
  }

  /**
   * A run that adds a credential fails here, before the branch is pushed: the scan is a gate
   * step, not a ninth guardrail, so G1 keeps its meaning and the diff never reaches a PR.
   */
  async function secretScanStep(
    ctx: RunContext,
    result: GateExecutionResult,
  ): Promise<GateExecutionResult> {
    const worktree = ctx.worktree;
    if (worktree === null) throw new RunFailure('internal', 'no worktree');
    let lines: readonly string[];
    try {
      const scan = await scanWorktree(ports.gitRunner, {
        cwd: worktree.path,
        baseSha: worktree.baseSha,
        timeoutMs: settings.gitTimeoutMs,
      });
      if (scan.findings.length === 0 && !scan.oversized) return result;
      lines = scan.oversized
        ? ['secret_scan: patch exceeded 4194304 bytes']
        : scan.findings.map((finding) => formatSecretFinding(finding));
      logger.error({
        msg: 'secret_scan_failed',
        runId: ctx.input.runId,
        findings: scan.findings.length,
        oversized: scan.oversized,
      });
    } catch (error) {
      if (!(error instanceof SecretScanError)) throw error;
      lines = [`secret_scan: ${error.code}`];
      logger.error({ msg: 'secret_scan_failed', runId: ctx.input.runId, code: error.code });
    }
    appendToGateLog(result.logFile, lines);
    return {
      ...result,
      status: 'failed',
      exitCode: 1,
      tail: [...result.tail, ...lines].slice(-GATE_TAIL_LINES),
    };
  }

  /**
   * D57: the repository's design documents are the second gate step, read from the run's own
   * worktree after the secret scan. Only an enforced finding turns the gate red; a missing token
   * document skips the step, and a diff git cannot produce fails closed.
   */
  async function designScanStep(
    ctx: RunContext,
    result: GateExecutionResult,
  ): Promise<GateExecutionResult> {
    const worktree = ctx.worktree;
    if (worktree === null) throw new RunFailure('internal', 'no worktree');
    let outcome: DesignScanOutcome;
    try {
      outcome = await scanDesign(ports.gitRunner, {
        cwd: worktree.path,
        baseSha: worktree.baseSha,
        timeoutMs: settings.gitTimeoutMs,
      });
    } catch (error) {
      if (!(error instanceof DesignScanError)) throw error;
      const lines = [`design_scan: ${error.code}`];
      logger.error({ msg: 'design_scan_failed', runId: ctx.input.runId, code: error.code });
      appendToGateLog(result.logFile, lines);
      return {
        ...result,
        status: 'failed',
        exitCode: 1,
        tail: [...result.tail, ...lines].slice(-GATE_TAIL_LINES),
      };
    }
    if (outcome.skipped || outcome.oversized) return result;
    const findings = outcome.findings;
    if (findings.length === 0) return result;
    const { enforced, reportOnly } = classifyDesignFindings(findings);
    const lines = findings.map((finding) =>
      designRuleEnforcement(finding.rule) === 'report-only'
        ? `${formatDesignFinding(finding)} (report-only)`
        : formatDesignFinding(finding),
    );
    const fields = {
      msg: 'design_scan_reported',
      runId: ctx.input.runId,
      findings: findings.length,
      enforced: enforced.length,
      reportOnly: reportOnly.length,
      oversized: false,
    };
    if (enforced.length > 0) logger.error(fields);
    else logger.info(fields);
    appendToGateLog(result.logFile, lines);
    const tail = [...result.tail, ...lines].slice(-GATE_TAIL_LINES);
    if (enforced.length === 0) return { ...result, tail };
    return { ...result, status: 'failed', exitCode: 1, tail };
  }

  function protectedPaths(ctx: RunContext): readonly string[] {
    const combined = new Set<string>([
      ...ctx.input.repo.protectedPaths,
      ...settings.protectedPaths,
    ]);
    return [...combined];
  }

  function mergeFacts(
    ctx: RunContext,
    input: {
      readonly checks: readonly CheckRun[];
      readonly mergeable: boolean;
      readonly labels: readonly string[];
      readonly baseCurrentSha: string;
    },
  ): MergeFacts {
    const worktree = ctx.worktree;
    const status = ctx.status;
    if (worktree === null || status === null) throw new RunFailure('internal', 'no worktree');
    const gate = ctx.gate;
    return {
      gate: {
        status: gate === null ? 'failed' : gate.status,
        exitCode: gate === null ? 1 : gate.exitCode,
      },
      checks: input.checks.map((check) => ({
        name: check.name,
        conclusion: check.conclusion,
      })),
      pullRequest: {
        mergeable: input.mergeable,
        conflicting: !input.mergeable,
        labels: input.labels,
      },
      base: { recordedSha: worktree.baseSha, currentSha: input.baseCurrentSha },
      diff: { files: status.diff.files, added: status.diff.added, removed: status.diff.removed },
      changedPaths: status.changedPaths,
      policy: {
        repo: ctx.input.repo.policy,
        job: 'auto',
        automerge: settings.automerge,
        probationRuns: settings.probationRuns,
        consecutiveGreenRuns: settings.consecutiveGreenRuns,
      },
      budget: { maxFiles: settings.diffMaxFiles, maxLines: settings.diffMaxLines },
      protectedPaths: protectedPaths(ctx),
    };
  }

  function inspectable(code: RunFailureCode): boolean {
    return INSPECTABLE_FAILURES.includes(code);
  }

  async function failRun(ctx: RunContext, code: RunFailureCode): Promise<RunOutcome> {
    if (ctx.cancelled) return cancelledOutcome(ctx);
    await closeSession(ctx);
    if (!inspectable(code)) await removeWorktree(ctx);
    const message = failureMessage(code);
    if (transitionRun(ctx.state, 'failed').allowed) {
      transition(
        ctx,
        'failed',
        { failureCode: code, failureMessage: message, finishedAt: nowIso() },
        [{ event: 'run.failed', data: { state: 'failed', code, message } }],
      );
    }
    logger.warn({ msg: 'run_failed', runId: ctx.input.runId, code });
    return {
      runId: ctx.input.runId,
      state: 'failed',
      pr: ctx.pr,
      gate: ctx.gate,
      blockers: ctx.blockers,
      failure: { code, message },
    };
  }

  async function cancelRun(
    ctx: RunContext,
    reason: 'operator' | 'timeout' | 'cost_cap_reached',
  ): Promise<boolean> {
    if (ctx.cancelled) return false;
    if (!canCancel(ctx.state)) return false;
    ctx.cancelled = true;
    ctx.cancelReason = reason;
    ctx.cancelCode =
      reason === 'timeout' ? 'timeout' : reason === 'cost_cap_reached' ? 'cost_cap_reached' : null;
    ctx.abort.abort();
    ctx.resolveCancel();
    const sessionId = ctx.sessionId;
    if (sessionId !== null) {
      ctx.sessionId = null;
      try {
        await ports.agent.interrupt(sessionId);
      } catch (error) {
        logStepFailure(ctx, 'interrupt', error);
      }
      try {
        await ports.agent.closeSession(sessionId);
      } catch (error) {
        logStepFailure(ctx, 'close_session', error);
      }
    }
    await removeWorktree(ctx);
    if (transitionRun(ctx.state, 'cancelled').allowed) {
      transition(
        ctx,
        'cancelled',
        {
          failureCode: ctx.cancelCode,
          failureMessage: ctx.cancelCode === null ? null : failureMessage(ctx.cancelCode),
          finishedAt: nowIso(),
        },
        [{ event: 'run.cancelled', data: { state: 'cancelled', reason } }],
      );
    }
    logger.info({ msg: 'run_cancelled', runId: ctx.input.runId, reason });
    return true;
  }

  async function openPullRequest(ctx: RunContext): Promise<RunOutcome | null> {
    const worktree = ctx.worktree;
    const status = ctx.status;
    const gate = ctx.gate;
    if (worktree === null || status === null || gate === null) {
      throw new RunFailure('internal', 'no worktree');
    }
    const repoInfo = await ports.git.getRepo(ctx.input.repo.slug);
    ctx.repoInfo = repoInfo;
    // D51: a work run's own commit flips exactly one checkbox, and it lands even when the agent
    // already committed its work. `missing` and `ambiguous` change nothing and never fail the run.
    const tick =
      ctx.input.backlogRef == null ? null : { path: BACKLOG_TICK_PATH, ref: ctx.input.backlogRef };
    if (status.commitsAhead === 0 || tick !== null) {
      const commit = await commitWorktree({
        worktree: worktree.path,
        subject: ctx.input.title,
        body: `${RUN_TRAILER_PREFIX}${ctx.input.runId}`,
        author: settings.author,
        git: ports.gitRunner,
        timeoutMs: settings.gitTimeoutMs,
        tick,
      });
      if (
        commit.tick !== null &&
        commit.tick.kind !== 'ticked' &&
        commit.tick.kind !== 'already_done'
      ) {
        logger.warn({
          msg: 'backlog_tick_skipped',
          runId: ctx.input.runId,
          ref: ctx.input.backlogRef,
          reason: commit.tick.kind,
        });
      }
      logger.info({ msg: 'run_committed', runId: ctx.input.runId, created: commit.created });
    }
    await ports.git.pushBranch({
      repo: repoInfo,
      worktree: worktree.path,
      branch: ctx.branch,
    });
    const knownFacts = evaluateAutoMerge(
      mergeFacts(ctx, {
        checks: [],
        mergeable: true,
        labels: MERGE_LABELS,
        baseCurrentSha: worktree.baseSha,
      }),
    );
    const body = buildPrBody({
      title: ctx.input.title,
      runId: ctx.input.runId,
      jobId: ctx.input.jobId,
      agent: ctx.input.agent,
      model: ctx.input.model,
      agentMessage: ctx.agentMessage,
      gate,
      diff: status.diff,
      guardrails: knownFacts.guardrails,
      blockers: knownFacts.blockers,
      gateCommand: ctx.gateCommand,
    });
    const pr = await ports.git.openPullRequest({
      repo: repoInfo,
      head: ctx.branch,
      base: ctx.baseRef,
      title: ctx.input.title,
      body,
      draft: false,
      labels: [...MERGE_LABELS],
    });
    ctx.pr = pr;
    const reference = toPullRequestRef(pr);
    transition(ctx, 'pr_open', { pr: reference, diff: diffStatOf(status.diff) }, [
      { event: 'run.pr', data: { pr: reference } },
    ]);
    const checks = await ports.git.getChecks({
      repo: repoInfo,
      number: pr.number,
      headSha: pr.headSha,
      baseRef: ctx.baseRef,
    });
    const evaluation = evaluateAutoMerge(
      mergeFacts(ctx, {
        checks: checks.checks,
        mergeable: pr.mergeable,
        labels: pr.labels,
        baseCurrentSha: pr.baseSha,
      }),
    );
    ctx.guardrails = evaluation.guardrails;
    ctx.blockers = evaluation.blockers;
    amend(ctx, { guardrails: [...evaluation.guardrails], blockers: [...evaluation.blockers] });
    if (evaluation.merge) return null;
    logger.info({
      msg: 'run_parked',
      runId: ctx.input.runId,
      blockers: evaluation.blockers.map((blocker) => blocker.code),
    });
    return prOpenOutcome(ctx);
  }

  async function park(
    ctx: RunContext,
    guardrails: readonly GuardrailFact[],
    blockers: readonly MergeBlocker[],
  ): Promise<RunOutcome> {
    ctx.guardrails = guardrails;
    ctx.blockers = blockers;
    const patch: RunPatch = {
      guardrails: [...guardrails],
      blockers: [...blockers],
      finishedAt: null,
    };
    if (transitionRun(ctx.state, 'pr_open').allowed && ctx.state !== 'pr_open') {
      transition(ctx, 'pr_open', patch);
    } else {
      amend(ctx, patch);
    }
    logger.info({
      msg: 'run_parked',
      runId: ctx.input.runId,
      blockers: blockers.map((blocker) => blocker.code),
    });
    return prOpenOutcome(ctx);
  }

  function mergeRequest(
    ctx: RunContext,
    pr: PullRequest,
  ): Promise<{
    readonly merged: boolean;
    readonly sha: string | null;
    readonly reason: MergeReason;
    readonly retryable: boolean;
  }> {
    const repoInfo = ctx.repoInfo;
    if (repoInfo === null) throw new RunFailure('internal', 'no provider repo');
    return ports.git.mergePullRequest({
      repo: repoInfo,
      number: pr.number,
      method: settings.mergeMethod,
      commitTitle: `${ctx.input.title} (#${pr.number})`,
      commitMessage: `${RUN_TRAILER_PREFIX}${ctx.input.runId}`,
      sha: pr.headSha,
    });
  }

  async function mergePhase(ctx: RunContext): Promise<RunOutcome> {
    const repoInfo = ctx.repoInfo;
    let pr = ctx.pr;
    if (repoInfo === null || pr === null) throw new RunFailure('internal', 'no pull request');
    transition(ctx, 'merging', {});
    let result = await mergeRequest(ctx, pr);
    if (!result.merged && result.retryable) {
      const fresh = await ports.git.getPullRequest({ repo: repoInfo, number: pr.number });
      pr = fresh;
      ctx.pr = fresh;
      const checks = await ports.git.getChecks({
        repo: repoInfo,
        number: fresh.number,
        headSha: fresh.headSha,
        baseRef: ctx.baseRef,
      });
      const evaluation = evaluateAutoMerge(
        mergeFacts(ctx, {
          checks: checks.checks,
          mergeable: fresh.mergeable,
          labels: fresh.labels,
          baseCurrentSha: fresh.baseSha,
        }),
      );
      if (!evaluation.merge) return park(ctx, evaluation.guardrails, evaluation.blockers);
      result = await mergeRequest(ctx, fresh);
      if (!result.merged) {
        return park(ctx, evaluation.guardrails, [blockerForMerge(result.reason)]);
      }
    } else if (!result.merged) {
      return park(ctx, ctx.guardrails, [blockerForMerge(result.reason)]);
    }

    await ports.git.deleteBranch({ repo: repoInfo, branch: ctx.branch });
    await removeWorktree(ctx);
    const mergeCommit = validSha(result.sha, pr.headSha);
    const reference = toPullRequestRef(pr);
    transition(ctx, 'succeeded', { finishedAt: nowIso() }, [
      {
        event: 'run.merged',
        data: { pr: reference, mergeCommit, method: settings.mergeMethod },
      },
      { event: 'run.finished', data: { state: 'succeeded' } },
    ]);
    logger.info({ msg: 'run_succeeded', runId: ctx.input.runId, number: pr.number });
    return {
      runId: ctx.input.runId,
      state: 'succeeded',
      pr,
      gate: ctx.gate,
      blockers: [],
      failure: null,
    };
  }

  async function runFlow(ctx: RunContext): Promise<RunOutcome> {
    await prepare(ctx);
    if (ctx.cancelled || (await timeoutExpired(ctx))) return cancelledOutcome(ctx);
    await runAgentPhase(ctx);
    if (ctx.cancelled) return cancelledOutcome(ctx);
    const gate = await gating(ctx);
    if (ctx.cancelled) return cancelledOutcome(ctx);
    if (gate.status !== 'passed') return failRun(ctx, 'gate_failed');
    if (await timeoutExpired(ctx)) return cancelledOutcome(ctx);
    const parked = await openPullRequest(ctx);
    if (parked !== null) return parked;
    if (ctx.cancelled) return cancelledOutcome(ctx);
    return mergePhase(ctx);
  }

  function failureCodeOf(error: unknown): RunFailureCode {
    if (error instanceof RunFailure) return error.code;
    if (error instanceof WorkspaceError) return 'workspace_error';
    if (error instanceof GitProviderError) return 'provider_unavailable';
    if (error instanceof AgentError) {
      return error.code === 'agent_unavailable' || error.code === 'stream_lost'
        ? 'agent_unavailable'
        : 'protocol';
    }
    return 'internal';
  }

  async function handleUnexpected(ctx: RunContext, error: unknown): Promise<RunOutcome> {
    const code = failureCodeOf(error);
    logStepFailure(ctx, 'flow', error);
    if (ctx.cancelled) return cancelledOutcome(ctx);
    if (!transitionRun(ctx.state, 'failed').allowed) {
      return {
        runId: ctx.input.runId,
        state: stateOutcome(ctx),
        pr: ctx.pr,
        gate: ctx.gate,
        blockers: ctx.blockers,
        failure: ctx.state === 'succeeded' ? null : { code, message: failureMessage(code) },
      };
    }
    return failRun(ctx, code);
  }

  return {
    start(input: RunStartInput): Promise<RunOutcome> {
      const existing = inflight.get(input.runId);
      if (existing !== undefined) return existing.promise;
      const ctx = createContext(input);
      const promise = (async (): Promise<RunOutcome> => {
        try {
          queue(ctx);
          await admission(ctx);
          if (ctx.cancelled || (await timeoutExpired(ctx))) return cancelledOutcome(ctx);
          return await runFlow(ctx);
        } catch (error) {
          try {
            return await handleUnexpected(ctx, error);
          } catch (second) {
            logStepFailure(ctx, 'handle_failure', second);
            return {
              runId: input.runId,
              state: 'failed',
              pr: ctx.pr,
              gate: ctx.gate,
              blockers: ctx.blockers,
              failure: { code: 'internal', message: failureMessage('internal') },
            };
          }
        } finally {
          inflight.delete(input.runId);
          releaseSlot(ctx);
        }
      })();
      inflight.set(input.runId, { ctx, promise });
      return promise;
    },

    async cancel(
      runId: string,
      reason: 'operator' | 'timeout' | 'cost_cap_reached' = 'operator',
    ): Promise<boolean> {
      const entry = inflight.get(runId);
      if (entry === undefined) return false;
      const parked = waiting.get(runId);
      if (parked === undefined) return cancelRun(entry.ctx, reason);
      waiting.delete(runId);
      const cancelled = await cancelRun(entry.ctx, reason);
      parked.resolve();
      return cancelled;
    },

    active(): readonly string[] {
      return [...activeOrder];
    },
  };
}
