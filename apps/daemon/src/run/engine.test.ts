import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GUARDRAIL_IDS, parseSseEvent } from '@codebox/contracts';
import type { RunState } from '@codebox/contracts';
import type {
  CheckSummary,
  MergePullRequestInput,
  MergeResult,
  OpenPullRequestInput,
  PullRequest,
  PushBranchInput,
  RepoInfo,
} from '@codebox/git-provider';
import { AgentError } from '@codebox/opencode';
import type {
  CreateSessionInput,
  EventFilter,
  PermissionReply,
  RawAgentEvent,
  SessionRef,
} from '@codebox/opencode';
import type { EventRecord, RunPatch, Store } from '@codebox/store';
import { openInMemoryStore } from '@codebox/store';
import type { GitRunner, RunMarker, Worktree, WorkspaceStatus } from '@codebox/workspaces';
import { runGate } from '../gate/run-gate.js';
import { MAX_SECRET_SCAN_BYTES } from '../gate/secret-scan.js';
import { createLogger } from '../logger.js';
import { createRunEngine, permissionPath } from './engine.js';
import type { RunOutcome, RunPorts, RunSettings, RunStartInput } from './ports.js';

const NOW = Date.parse('2026-10-25T10:00:00.000Z');
const REPO_ID = 'repo_engine01';
const SECOND_REPO_ID = 'repo_engine02';
const RUN_ID = 'run_engine0001';
const JOB_ID = 'job_engine0001';
const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const MERGE_SHA = 'c'.repeat(40);
const MOVED_SHA = 'd'.repeat(40);
const CLONE_URL = 'https://x-access-token:ghp_fixture_secret@github.com/acme/widgets.git';
const WORKTREE_BRANCH = `cb/${RUN_ID}-add-the-feature-flag`;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cb-14-engine-'));
  roots.push(directory);
  return directory;
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function busyEvent(sessionId: string): RawAgentEvent {
  return { type: 'session.updated', sessionId, status: 'busy' };
}

function idleEvent(sessionId: string): RawAgentEvent {
  return { type: 'session.updated', sessionId, status: 'idle' };
}

function textEvent(sessionId: string, delta: string): RawAgentEvent {
  return { type: 'message.part.text', sessionId, messageId: 'msg_engine0001', delta };
}

function toolEvent(sessionId: string, tool: string): RawAgentEvent {
  return {
    type: 'message.part.tool',
    sessionId,
    messageId: 'msg_engine0001',
    tool,
    status: 'start',
  };
}

function usageEvent(sessionId: string, costUsd: number): RawAgentEvent {
  return {
    type: 'session.usage',
    sessionId,
    model: 'anthropic/claude-sonnet-4',
    tokensIn: 100,
    tokensOut: 50,
    costUsd,
  };
}

type Delivery =
  | { readonly kind: 'event'; readonly event: RawAgentEvent }
  | { readonly kind: 'throw'; readonly error: unknown }
  | { readonly kind: 'end' };

class FakeAgent {
  readonly created: CreateSessionInput[] = [];
  createCalls = 0;
  readonly prompts: { sessionId: string; text: string }[] = [];
  readonly interrupts: string[] = [];
  readonly closes: string[] = [];
  readonly replies: { sessionId: string; requestId: string; reply: PermissionReply }[] = [];
  script: readonly RawAgentEvent[] = [];
  throwAfterScript: unknown = null;
  failCreates: unknown[] = [];
  failPrompt: unknown = null;
  private readonly queues = new Map<string, Delivery[]>();
  private readonly waiters = new Map<string, ((delivery: Delivery) => void)[]>();
  private counter = 0;

  private queueFor(sessionId: string): Delivery[] {
    const existing = this.queues.get(sessionId);
    if (existing !== undefined) return existing;
    const queue: Delivery[] = [];
    this.queues.set(sessionId, queue);
    return queue;
  }

  private deliver(sessionId: string, delivery: Delivery): void {
    const waiting = this.waiters.get(sessionId) ?? [];
    const resolve = waiting.shift();
    if (resolve !== undefined) {
      resolve(delivery);
      return;
    }
    this.queueFor(sessionId).push(delivery);
  }

  private take(sessionId: string): Promise<Delivery> {
    const queued = this.queueFor(sessionId).shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise<Delivery>((resolve) => {
      const waiting = this.waiters.get(sessionId) ?? [];
      waiting.push(resolve);
      this.waiters.set(sessionId, waiting);
    });
  }

  push(sessionId: string, event: RawAgentEvent): void {
    this.deliver(sessionId, { kind: 'event', event });
  }

  createSession(input: CreateSessionInput): Promise<SessionRef> {
    this.createCalls += 1;
    const failure = this.failCreates.shift();
    if (failure !== undefined) return Promise.reject(failure);
    this.counter += 1;
    this.created.push(input);
    const session: SessionRef = {
      sessionId: `ses_fake${this.counter}`,
      directory: input.directory,
      title: input.title,
    };
    this.queueFor(session.sessionId);
    return Promise.resolve(session);
  }

  prompt(sessionId: string, text: string): Promise<void> {
    this.prompts.push({ sessionId, text });
    if (this.failPrompt !== null) {
      const error = this.failPrompt;
      this.failPrompt = null;
      return Promise.reject(error);
    }
    for (const event of this.script) this.deliver(sessionId, { kind: 'event', event });
    if (this.throwAfterScript !== null) {
      this.deliver(sessionId, { kind: 'throw', error: this.throwAfterScript });
    }
    return Promise.resolve();
  }

  subscribe(filter: EventFilter): AsyncIterable<RawAgentEvent> {
    const sessionId = 'sessionId' in filter ? filter.sessionId : '';
    return {
      [Symbol.asyncIterator]: (): AsyncGenerator<RawAgentEvent> => this.iterate(sessionId),
    };
  }

  interrupt(sessionId: string): Promise<void> {
    this.interrupts.push(sessionId);
    return Promise.resolve();
  }

  replyPermission(sessionId: string, requestId: string, reply: PermissionReply): Promise<void> {
    this.replies.push({ sessionId, requestId, reply });
    return Promise.resolve();
  }

  closeSession(sessionId: string): Promise<void> {
    this.closes.push(sessionId);
    this.deliver(sessionId, { kind: 'end' });
    return Promise.resolve();
  }

  private async *iterate(sessionId: string): AsyncGenerator<RawAgentEvent> {
    for (;;) {
      const delivery = await this.take(sessionId);
      if (delivery.kind === 'end') return;
      if (delivery.kind === 'throw') throw delivery.error;
      yield delivery.event;
    }
  }
}

type FakeWorkspaces = RunPorts['workspaces'] & {
  readonly calls: string[];
  readonly markers: RunMarker[];
  readonly removed: Worktree[];
  statusValue: WorkspaceStatus;
  readonly worktree: Worktree;
};

function fakeWorkspaces(worktreePath: string, status: WorkspaceStatus): FakeWorkspaces {
  const calls: string[] = [];
  const markers: RunMarker[] = [];
  const removed: Worktree[] = [];
  const worktree: Worktree = {
    runId: RUN_ID,
    repoSlug: 'acme/widgets',
    path: worktreePath,
    branch: WORKTREE_BRANCH,
    baseRef: 'main',
    baseSha: BASE_SHA,
  };
  return {
    calls,
    markers,
    removed,
    statusValue: status,
    worktree,
    ensureClone(): Promise<{ path: string; created: boolean; headSha: string }> {
      calls.push('ensureClone');
      return Promise.resolve({
        path: '/fixture/repos/acme__widgets.git',
        created: true,
        headSha: BASE_SHA,
      });
    },
    createWorktree(input): Promise<Worktree> {
      calls.push(`createWorktree:${input.runId}`);
      expect(input.baseRef).toBe('main');
      return Promise.resolve({ ...worktree, runId: input.runId });
    },
    removeWorktree(): Promise<void> {
      calls.push('removeWorktree');
      removed.push(worktree);
      return Promise.resolve();
    },
    writeRunMarker(_worktree, marker): Promise<void> {
      calls.push('writeRunMarker');
      markers.push(marker);
      return Promise.resolve();
    },
    status(): Promise<WorkspaceStatus> {
      calls.push('status');
      return Promise.resolve(this.statusValue);
    },
  };
}

function workspaceStatus(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    branch: WORKTREE_BRANCH,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    commitsAhead: 1,
    dirty: false,
    diff: {
      files: 2,
      added: 10,
      removed: 3,
      changedFiles: [
        { path: 'src/flag.ts', status: 'added', added: 10, removed: 0 },
        { path: 'src/index.ts', status: 'modified', added: 0, removed: 3 },
      ],
    },
    changedPaths: ['src/flag.ts', 'src/index.ts'],
    protectedHits: [],
    ...overrides,
  };
}

const REPO_INFO: RepoInfo = Object.freeze({
  slug: 'acme/widgets',
  defaultBranch: 'main',
  private: true,
  canPush: true,
});

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 7,
    url: 'https://github.com/acme/widgets/pull/7',
    mergeable: true,
    headSha: HEAD_SHA,
    baseSha: BASE_SHA,
    state: 'open',
    draft: false,
    labels: ['cb:auto-merge'],
    created: true,
    ...overrides,
  };
}

const GREEN_CHECKS: CheckSummary = Object.freeze({
  state: 'success',
  checks: [{ name: 'ci', conclusion: 'success' as const, required: true }],
});

type FakeGit = RunPorts['git'] & {
  readonly pushes: PushBranchInput[];
  readonly opened: OpenPullRequestInput[];
  readonly merges: MergePullRequestInput[];
  readonly deleted: string[];
  pullRequest: PullRequest;
  checks: CheckSummary;
  mergeResults: MergeResult[];
  getPullRequestCalls: number;
};

function fakeGit(): FakeGit {
  const pushes: PushBranchInput[] = [];
  const opened: OpenPullRequestInput[] = [];
  const merges: MergePullRequestInput[] = [];
  const deleted: string[] = [];
  return {
    pushes,
    opened,
    merges,
    deleted,
    pullRequest: pullRequest(),
    checks: GREEN_CHECKS,
    mergeResults: [],
    getPullRequestCalls: 0,
    getRepo(): Promise<RepoInfo> {
      return Promise.resolve(REPO_INFO);
    },
    pushBranch(input): Promise<{ branch: string; sha: string }> {
      pushes.push(input);
      return Promise.resolve({ branch: input.branch, sha: HEAD_SHA });
    },
    openPullRequest(input): Promise<PullRequest> {
      opened.push(input);
      return Promise.resolve(this.pullRequest);
    },
    getPullRequest(): Promise<PullRequest> {
      this.getPullRequestCalls += 1;
      return Promise.resolve(this.pullRequest);
    },
    getChecks(): Promise<CheckSummary> {
      return Promise.resolve(this.checks);
    },
    mergePullRequest(input): Promise<MergeResult> {
      merges.push(input);
      const next = this.mergeResults.shift();
      return Promise.resolve(
        next ?? {
          merged: true,
          sha: MERGE_SHA,
          method: 'squash',
          reason: 'merged',
          retryable: false,
        },
      );
    },
    deleteBranch(input): Promise<void> {
      deleted.push(input.branch);
      return Promise.resolve();
    },
  };
}

interface FakeGitRunner extends GitRunner {
  readonly calls: readonly string[][];
}

interface FakeGitRunnerOptions {
  readonly sha?: string;
  readonly patch?: string;
  readonly scanCode?: number;
  /** The 1-based non-cached `diff` call that answers `code: 1`; the secret scan is the first. */
  readonly failScanCall?: number;
}

function fakeGitRunner(options: FakeGitRunnerOptions = {}): FakeGitRunner {
  const calls: string[][] = [];
  const sha = options.sha ?? HEAD_SHA;
  let scanCalls = 0;
  return {
    calls,
    run(input): Promise<{ code: number; stdout: string; stderr: string }> {
      calls.push([...input.args]);
      const [command] = input.args;
      if (command === 'add') return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      if (command === 'diff') {
        // `diff --cached --quiet` is the commit step; anything else is a gate scan's patch.
        if (input.args.includes('--cached')) {
          return Promise.resolve({ code: 1, stdout: '', stderr: '' });
        }
        scanCalls += 1;
        return Promise.resolve({
          code: scanCalls === options.failScanCall ? 1 : (options.scanCode ?? 0),
          stdout: options.patch ?? '',
          stderr: '',
        });
      }
      if (input.args.includes('commit'))
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      if (command === 'rev-parse')
        return Promise.resolve({ code: 0, stdout: `${sha}\n`, stderr: '' });
      return Promise.resolve({ code: 1, stdout: '', stderr: '' });
    },
  };
}

function runInput(overrides: Partial<RunStartInput> = {}): RunStartInput {
  return {
    runId: RUN_ID,
    repo: {
      id: REPO_ID,
      slug: 'acme/widgets',
      defaultBranch: 'main',
      gate: 'exit 0',
      policy: 'auto',
      protectedPaths: ['.github/**', 'ops/**'],
      cloneUrl: CLONE_URL,
    },
    jobId: JOB_ID,
    trigger: 'manual',
    title: 'Add the feature flag',
    prompt: 'Add a flag behind an environment variable.',
    agent: 'build',
    model: null,
    ...overrides,
  };
}

function seedRepo(store: Store, id: string, slug: string): void {
  store.repos.create({
    id,
    slug,
    defaultBranch: 'main',
    gate: 'exit 0',
    policy: 'auto',
    protectedPaths: ['.github/**', 'ops/**'],
    enabled: true,
    createdAt: new Date(NOW).toISOString(),
  });
}

function runInputFor(runId: string, repoId: string, slug: string): RunStartInput {
  return runInput({ runId, repo: { ...runInput().repo, id: repoId, slug } });
}

interface Harness {
  readonly engine: ReturnType<typeof createRunEngine>;
  readonly store: Store;
  readonly emitted: EventRecord[];
  readonly states: RunState[];
  readonly patches: RunPatch[];
  readonly agent: FakeAgent;
  readonly workspaces: FakeWorkspaces;
  readonly git: FakeGit;
  readonly gitRunner: FakeGitRunner;
  readonly lines: Record<string, unknown>[];
  readonly gateCalls: {
    cwd: string;
    command: string;
    shell: string;
    logFile: string;
    runId: string;
  }[];
  advance(ms: number): void;
  setSpend(usd: number): void;
  settings: RunSettings;
}

interface HarnessOptions {
  readonly gate?: RunPorts['gate'];
  readonly settings?: Partial<RunSettings>;
  readonly status?: Partial<WorkspaceStatus>;
  readonly git?: FakeGitRunnerOptions;
}

function harness(options: HarnessOptions = {}): Harness {
  const root = temporaryRoot();
  const worktreePath = join(root, 'worktrees', RUN_ID);
  mkdirSync(worktreePath, { recursive: true });
  const store = openInMemoryStore();
  seedRepo(store, REPO_ID, 'acme/widgets');
  seedRepo(store, SECOND_REPO_ID, 'acme/gadgets');
  store.jobs.create({
    id: JOB_ID,
    repoId: REPO_ID,
    title: 'Add the feature flag',
    prompt: 'Add a flag behind an environment variable.',
    mode: 'work',
    agent: 'build',
    model: null,
    cron: '0 9 * * 1',
    timezone: 'UTC',
    enabled: true,
    policy: 'auto',
    createdAt: new Date(NOW).toISOString(),
    nextFireAt: null,
  });

  const states: RunState[] = [];
  const patches: RunPatch[] = [];
  const update = store.runs.update.bind(store.runs);
  const runs: Store['runs'] = {
    ...store.runs,
    update(id: string, patch: RunPatch) {
      if (patch.state !== undefined) states.push(patch.state);
      patches.push(patch);
      return update(id, patch);
    },
  };
  const wrapped: Store = { ...store, runs };

  const emitted: EventRecord[] = [];
  const agent = new FakeAgent();
  const workspaces = fakeWorkspaces(worktreePath, workspaceStatus(options.status));
  const git = fakeGit();
  const gitRunner = fakeGitRunner(options.git);
  const lines: Record<string, unknown>[] = [];
  const gateCalls: Harness['gateCalls'] = [];
  let nowMs = NOW;
  let spend = 0;
  const settings: RunSettings = {
    gateDefault: 'npm test && npm run build',
    gateShell: '/bin/bash',
    gateTimeoutSeconds: 120,
    runTimeoutSeconds: 3_600,
    maxConcurrency: 3,
    maxPerRepo: 1,
    dailyCostUsd: 10,
    automerge: 'on',
    mergeMethod: 'squash',
    protectedPaths: ['.github/**', 'ops/**'],
    diffMaxFiles: 40,
    diffMaxLines: 2_000,
    probationRuns: 0,
    consecutiveGreenRuns: 0,
    approvalTtlSeconds: 600,
    logsDir: join(root, 'logs'),
    author: { name: 'codebox[bot]', email: 'codebox@users.noreply.github.com' },
    gitTimeoutMs: 30_000,
    ...options.settings,
  };
  const gateStub: RunPorts['gate'] = (input) =>
    Promise.resolve({
      status: 'passed',
      exitCode: 0,
      durationMs: 12,
      timedOut: false,
      cancelled: false,
      tail: ['gate ok'],
      logFile: input.logFile,
    });
  const recordingGate: RunPorts['gate'] = (input) => {
    gateCalls.push({
      cwd: input.cwd,
      command: input.command,
      shell: input.shell,
      logFile: input.logFile,
      runId: input.runId,
    });
    return (options.gate ?? gateStub)(input);
  };
  const engine = createRunEngine({
    workspaces,
    agent,
    git,
    gitRunner,
    gate: recordingGate,
    store: wrapped,
    clock: () => new Date(nowMs),
    logger: createLogger({
      level: 'info',
      sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    }),
    emit: (record) => {
      emitted.push(record);
    },
    spentTodayUsd: () => spend,
    settings,
  });
  return {
    engine,
    store: wrapped,
    emitted,
    states,
    patches,
    agent,
    workspaces,
    git,
    gitRunner,
    lines,
    gateCalls,
    advance: (ms: number) => {
      nowMs += ms;
    },
    setSpend: (usd: number) => {
      spend = usd;
    },
    settings,
  };
}

function eventTypes(emitted: readonly EventRecord[]): readonly string[] {
  return emitted.map((record) => record.type);
}

function guardrailOf(record: {
  guardrails: readonly { readonly id: string }[];
}): readonly string[] {
  return record.guardrails.map((guardrail) => guardrail.id);
}

/** The twelve colour leaves the design gate needs: authored here, never read from `design/`. */
const DESIGN_TOKEN_VALUES: Readonly<Record<string, string>> = {
  'color.surface.page': '#0b0f14',
  'color.surface.overlay': '#121821',
  'color.text.primary': '#e6edf3',
  'color.text.secondary': '#8b98a5',
  'color.state.success': '#22c55e',
  'color.state.warning': '#f59e0b',
  'color.state.danger': '#ef4444',
  'color.border.default': '#5b6772',
  'color.surface.subtle': '#f7f9fb',
  'color.surface.raised-light': '#ffffff',
  'color.state.success-strong': '#15803d',
  'color.state.warning-strong': '#b45309',
};

function tokenDocument(values: Readonly<Record<string, string>>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(values)) {
    const segments = path.split('.');
    const leaf = segments[segments.length - 1];
    if (leaf === undefined) continue;
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      const child = node[segment];
      if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
        node = child as Record<string, unknown>;
        continue;
      }
      const created: Record<string, unknown> = {};
      node[segment] = created;
      node = created;
    }
    node[leaf] = { $value: value, $type: 'color' };
  }
  return root;
}

interface DesignStates {
  readonly loading?: string | null;
  readonly empty?: string | null;
  readonly error?: string | null;
}

/** Writes the design documents into the harness worktree, because the step reads the real one. */
function writeDesignFixture(test: Harness, states: DesignStates = {}): void {
  const root = test.workspaces.worktree.path;
  const screens = join(root, 'design', 'screens');
  mkdirSync(screens, { recursive: true });
  writeFileSync(
    join(root, 'design', 'tokens.json'),
    JSON.stringify(tokenDocument(DESIGN_TOKEN_VALUES)),
    'utf8',
  );
  writeFileSync(
    join(root, 'design', 'routes.json'),
    JSON.stringify({
      routes: [{ path: '/dashboard', screen: 'Dashboard', component: 'DashboardPage' }],
    }),
    'utf8',
  );
  writeFileSync(
    join(screens, 'dashboard.json'),
    JSON.stringify({
      screen: 'Dashboard',
      route: '/dashboard',
      states: {
        loading: 'Loading the dashboard',
        empty: 'No works yet',
        error: 'The dashboard could not load',
        ...states,
      },
    }),
    'utf8',
  );
}

function patchWithColour(colour: string, path = 'apps/app/src/theme/extra.css'): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,0 +1,1 @@',
    `+color: ${colour};`,
    '',
  ].join('\n');
}

function designLogs(test: Harness): Record<string, unknown>[] {
  return test.lines.filter(
    (line) => line['msg'] === 'design_scan_reported' || line['msg'] === 'design_scan_failed',
  );
}

describe('run engine — happy path', () => {
  it('walks queued to succeeded, one state per transition, six events in order', async () => {
    const session = { sessionId: 'ses_fake1' };
    const realGate = harness({ gate: (input) => runGate(input), status: { commitsAhead: 0 } });
    realGate.agent.script = [busyEvent(session.sessionId), idleEvent(session.sessionId)];

    const outcome = await realGate.engine.start(runInput());

    expect(outcome.state).toBe('succeeded');
    expect(outcome.failure).toBeNull();
    expect(outcome.gate?.exitCode).toBe(0);
    expect(outcome.pr?.number).toBe(7);

    expect(realGate.states).toEqual([
      'preparing',
      'running',
      'gating',
      'pr_open',
      'merging',
      'succeeded',
    ]);
    expect(realGate.store.runs.get(RUN_ID)?.state).toBe('succeeded');
    expect(realGate.store.runs.getRecord(RUN_ID)?.baseSha).toBe(BASE_SHA);
    expect(realGate.store.runs.getRecord(RUN_ID)?.worktree).toBe(realGate.workspaces.worktree.path);
    expect(realGate.store.runs.getRecord(RUN_ID)?.sessionId).toBe('ses_fake1');
    expect(realGate.store.runs.getRecord(RUN_ID)?.gateCommand).toBe('exit 0');
    expect(realGate.store.runs.getRecord(RUN_ID)?.promptHash).toMatch(/^[0-9a-f]{64}$/);

    expect(eventTypes(realGate.emitted)).toEqual([
      'run.queued',
      'run.started',
      'run.gate',
      'run.pr',
      'run.merged',
      'run.finished',
    ]);
    const sequences = realGate.emitted.map((record) => record.seq ?? 0);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6]);
    for (const record of realGate.emitted) {
      expect(() => parseSseEvent({ event: record.type, data: record.data })).not.toThrow();
      expect(record.runId).toBe(RUN_ID);
    }

    expect(realGate.workspaces.calls).toEqual([
      'ensureClone',
      `createWorktree:${RUN_ID}`,
      'writeRunMarker',
      'status',
      'removeWorktree',
    ]);
    expect(realGate.workspaces.markers[0]?.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(realGate.workspaces.markers[0]?.repoSlug).toBe('acme/widgets');
    expect(realGate.git.pushes).toHaveLength(1);
    expect(realGate.git.pushes[0]?.branch).toBe(WORKTREE_BRANCH);
    expect(realGate.git.opened[0]?.draft).toBe(false);
    expect(realGate.git.opened[0]?.labels).toEqual(['cb:auto-merge']);
    expect(realGate.git.opened[0]?.body).toContain('### Guardrails');
    expect(realGate.git.opened[0]?.body).not.toContain(CLONE_URL);
    expect(realGate.git.merges).toHaveLength(1);
    expect(realGate.git.merges[0]?.commitTitle).toBe('Add the feature flag (#7)');
    expect(realGate.git.merges[0]?.commitMessage).toBe(`Codebox-Run: ${RUN_ID}`);
    expect(realGate.git.deleted).toEqual([WORKTREE_BRANCH]);
    expect(realGate.gateCalls[0]?.cwd).toBe(realGate.workspaces.worktree.path);
    expect(realGate.gateCalls[0]?.command).toBe('exit 0');
    expect(realGate.gateCalls[0]?.shell).toBe('/bin/bash');
    expect(realGate.gateCalls[0]?.logFile).toBe(
      join(realGate.settings.logsDir, `run-${RUN_ID}`, 'gate.log'),
    );
    expect(realGate.engine.active()).toEqual([]);
  });

  it('runs two runs at once and reports both as active', async () => {
    const test = harness();
    test.agent.script = [];
    const first = test.engine.start(runInput());
    const second = test.engine.start(runInputFor('run_engine0002', SECOND_REPO_ID, 'acme/gadgets'));
    await waitFor(() => test.engine.active().length === 2, 'two live runs');
    expect([...test.engine.active()].sort()).toEqual([RUN_ID, 'run_engine0002']);

    expect(await test.engine.cancel(RUN_ID)).toBe(true);
    expect(await test.engine.cancel('run_engine0002')).toBe(true);
    expect((await first).state).toBe('cancelled');
    expect((await second).state).toBe('cancelled');
    expect(test.store.runs.get('run_engine0002')?.state).toBe('cancelled');
    expect(test.engine.active()).toEqual([]);
  });

  it('never throws when the run row cannot be created', async () => {
    const test = harness();
    const outcome = await test.engine.start(
      runInput({ runId: 'run_missing01', repo: { ...runInput().repo, id: 'repo_missing' } }),
    );
    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('internal');
    expect(test.store.runs.get('run_missing01')).toBeNull();
  });

  it('commits the worktree when the agent left no commit', async () => {
    const test = harness({ status: { commitsAhead: 0 } });
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];
    const outcome = await test.engine.start(runInput());
    expect(outcome.state).toBe('succeeded');
    const commit = test.gitRunner.calls.find((args) => args.includes('commit'));
    expect(commit).toBeDefined();
    expect(commit).toContain('-m');
    expect(commit).toContain('Add the feature flag');
    expect(commit).toContain(`Codebox-Run: ${RUN_ID}`);
  });

  it('does not commit when the agent already committed', async () => {
    const test = harness();
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];
    await test.engine.start(runInput());
    expect(test.gitRunner.calls).toEqual([
      ['diff', '--no-color', '--unified=0', '--no-ext-diff', BASE_SHA, '--'],
      ['diff', '--no-color', '--unified=0', '--no-ext-diff', BASE_SHA, '--'],
    ]);
  });
});

describe('run engine — admission', () => {
  interface FleetRun {
    readonly runId: string;
    readonly repoId: string;
    readonly slug: string;
  }

  const FLEET = {
    one: { runId: 'run_engine0001', repoId: 'repo_engine01', slug: 'acme/widgets' },
    two: { runId: 'run_engine0002', repoId: 'repo_engine02', slug: 'acme/gadgets' },
    three: { runId: 'run_engine0003', repoId: 'repo_engine03', slug: 'acme/gizmos' },
    four: { runId: 'run_engine0004', repoId: 'repo_engine04', slug: 'acme/bolts' },
    five: { runId: 'run_engine0005', repoId: 'repo_engine05', slug: 'acme/nuts' },
  } satisfies Record<string, FleetRun>;
  const SECOND_RUN_ON_ONE = 'run_engine0011';

  function admissionHarness(): Harness {
    const test = harness({ settings: { maxConcurrency: 3, maxPerRepo: 1 } });
    seedRepo(test.store, FLEET.three.repoId, FLEET.three.slug);
    seedRepo(test.store, FLEET.four.repoId, FLEET.four.slug);
    seedRepo(test.store, FLEET.five.repoId, FLEET.five.slug);
    test.agent.script = [];
    return test;
  }

  function startFleet(test: Harness, run: FleetRun): Promise<RunOutcome> {
    return test.engine.start(runInputFor(run.runId, run.repoId, run.slug));
  }

  function startedEvents(test: Harness): string[] {
    return test.emitted
      .filter((record) => record.type === 'run.started')
      .map((record) => record.runId ?? '');
  }

  function logMessages(test: Harness, msg: string): Record<string, unknown>[] {
    return test.lines.filter((line) => line['msg'] === msg);
  }

  async function drain(test: Harness, promises: readonly Promise<RunOutcome>[]): Promise<void> {
    for (const run of Object.values(FLEET)) await test.engine.cancel(run.runId);
    await test.engine.cancel(SECOND_RUN_ON_ONE);
    await Promise.all(promises);
  }

  it('keeps the fourth run queued on three repositories', async () => {
    const test = admissionHarness();
    const promises = [
      startFleet(test, FLEET.one),
      startFleet(test, FLEET.two),
      startFleet(test, FLEET.three),
      startFleet(test, FLEET.four),
    ];
    await waitFor(() => startedEvents(test).length === 3, 'three live runs');

    expect(test.engine.active()).toEqual([FLEET.one.runId, FLEET.two.runId, FLEET.three.runId]);
    expect(test.store.runs.getRecord(FLEET.four.runId)?.state).toBe('queued');
    expect(test.store.runs.getRecord(FLEET.four.runId)?.startedAt).toBeNull();
    expect(startedEvents(test)).not.toContain(FLEET.four.runId);
    expect(
      test.emitted
        .filter((record) => record.runId === FLEET.four.runId)
        .map((record) => record.type),
    ).toEqual(['run.queued']);
    const waiting = logMessages(test, 'run_waiting');
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      runId: FLEET.four.runId,
      repoId: FLEET.four.repoId,
      active: 3,
      maxConcurrency: 3,
    });

    await drain(test, promises);
  });

  it('keeps a second run on a busy repository queued', async () => {
    const test = admissionHarness();
    const first = startFleet(test, FLEET.one);
    const second = test.engine.start(
      runInputFor(SECOND_RUN_ON_ONE, FLEET.one.repoId, FLEET.one.slug),
    );
    await waitFor(() => logMessages(test, 'run_waiting').length === 1, 'the waiting line');

    expect(test.engine.active()).toEqual([FLEET.one.runId]);
    expect(test.store.runs.getRecord(SECOND_RUN_ON_ONE)?.state).toBe('queued');
    expect(logMessages(test, 'run_waiting')[0]).toMatchObject({
      runId: SECOND_RUN_ON_ONE,
      repoId: FLEET.one.repoId,
      active: 1,
    });
    expect(logMessages(test, 'run_admitted')).toEqual([]);

    await drain(test, [first, second]);
  });

  it('starts the waiting run when a slot frees', async () => {
    const test = admissionHarness();
    const promises = [
      startFleet(test, FLEET.one),
      startFleet(test, FLEET.two),
      startFleet(test, FLEET.three),
      startFleet(test, FLEET.four),
    ];
    await waitFor(() => startedEvents(test).length === 3, 'three live runs');
    expect(test.store.runs.getRecord(FLEET.four.runId)?.state).toBe('queued');

    expect(await test.engine.cancel(FLEET.one.runId)).toBe(true);
    await waitFor(() => test.engine.active().includes(FLEET.four.runId), 'the fourth run admitted');

    expect(test.store.runs.getRecord(FLEET.four.runId)?.state).not.toBe('queued');
    const admitted = logMessages(test, 'run_admitted');
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({ runId: FLEET.four.runId, repoId: FLEET.four.repoId });

    await drain(test, promises);
  });

  it('cancels a queued run before it starts', async () => {
    const test = admissionHarness();
    const first = startFleet(test, FLEET.one);
    const second = test.engine.start(
      runInputFor(SECOND_RUN_ON_ONE, FLEET.one.repoId, FLEET.one.slug),
    );
    await waitFor(
      () => startedEvents(test).length === 1 && logMessages(test, 'run_waiting').length === 1,
      'one live run and one waiting run',
    );
    const createsBefore = test.agent.createCalls;
    expect(createsBefore).toBe(1);

    expect(await test.engine.cancel(SECOND_RUN_ON_ONE)).toBe(true);
    expect(await second).toMatchObject({ state: 'cancelled' });

    expect(test.store.runs.getRecord(SECOND_RUN_ON_ONE)?.state).toBe('cancelled');
    const cancelled = test.emitted.filter(
      (record) => record.type === 'run.cancelled' && record.runId === SECOND_RUN_ON_ONE,
    );
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.data).toMatchObject({ state: 'cancelled', reason: 'operator' });
    expect(test.agent.createCalls).toBe(createsBefore);
    expect(test.workspaces.calls.filter((call) => call.includes(SECOND_RUN_ON_ONE))).toHaveLength(
      0,
    );

    expect(await test.engine.cancel(FLEET.one.runId)).toBe(true);
    await first;
  });

  it('admits waiting runs in repository order', async () => {
    const test = admissionHarness();
    const promises = [
      startFleet(test, FLEET.one),
      startFleet(test, FLEET.two),
      startFleet(test, FLEET.three),
      startFleet(test, FLEET.five),
      startFleet(test, FLEET.four),
    ];
    await waitFor(() => logMessages(test, 'run_waiting').length === 2, 'two waiting runs');
    expect(test.engine.active()).toEqual([FLEET.one.runId, FLEET.two.runId, FLEET.three.runId]);

    expect(await test.engine.cancel(FLEET.one.runId)).toBe(true);
    await waitFor(
      () => test.engine.active().includes(FLEET.four.runId),
      'the fourth run admitted first',
    );
    expect(logMessages(test, 'run_admitted').map((line) => line['repoId'])).toEqual([
      FLEET.four.repoId,
    ]);

    expect(await test.engine.cancel(FLEET.two.runId)).toBe(true);
    await waitFor(
      () => test.engine.active().includes(FLEET.five.runId),
      'the fifth run admitted second',
    );
    expect(logMessages(test, 'run_admitted').map((line) => line['repoId'])).toEqual([
      FLEET.four.repoId,
      FLEET.five.repoId,
    ]);

    await drain(test, promises);
  });
});

describe('run engine — permissions', () => {
  it('allows a read, rejects a webfetch and keeps running', async () => {
    const test = harness();
    test.agent.script = [
      busyEvent('ses_fake1'),
      {
        type: 'permission.updated',
        sessionId: 'ses_fake1',
        permissionId: 'apv_read0001',
        tool: 'read',
        title: 'Read the README',
        input: { filePath: join(test.workspaces.worktree.path, 'README.md') },
      },
      {
        type: 'permission.updated',
        sessionId: 'ses_fake1',
        permissionId: 'apv_web00001',
        tool: 'webfetch',
        title: 'Fetch a page',
        input: { url: 'https://example.com' },
      },
      idleEvent('ses_fake1'),
    ];
    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('succeeded');
    expect(test.agent.replies).toEqual([
      { sessionId: 'ses_fake1', requestId: 'apv_read0001', reply: 'once' },
      { sessionId: 'ses_fake1', requestId: 'apv_web00001', reply: 'reject' },
    ]);
    const permission = test.emitted.filter((record) => record.type === 'run.permission');
    expect(permission).toHaveLength(2);
    expect(permission[0]?.data).toMatchObject({ approvalId: 'apv_read0001', tool: 'read' });
    expect(test.store.approvals.listPending(10)).toEqual([]);
    expect(eventTypes(test.emitted)).not.toContain('approval.created');
  });

  it('denies a path outside the worktree', async () => {
    const test = harness();
    test.agent.script = [
      busyEvent('ses_fake1'),
      {
        type: 'permission.updated',
        sessionId: 'ses_fake1',
        permissionId: 'apv_out00001',
        tool: 'edit',
        title: 'Edit a file outside',
        input: { filePath: '/etc/passwd' },
      },
      idleEvent('ses_fake1'),
    ];
    const outcome = await test.engine.start(runInput());
    expect(outcome.state).toBe('succeeded');
    expect(test.agent.replies).toEqual([
      { sessionId: 'ses_fake1', requestId: 'apv_out00001', reply: 'reject' },
    ]);
  });

  it('pins the permission path extractor the chat path reuses', () => {
    expect(permissionPath({ filePath: '/a' })).toBe('/a');
    expect(permissionPath({ path: '/b' })).toBe('/b');
    expect(permissionPath({ filePath: 42, path: '/c' })).toBe('/c');
    expect(permissionPath({})).toBeNull();
  });
});

describe('run engine — failures before the merge', () => {
  it('parks a red gate as failed, pushes nothing and keeps the worktree', async () => {
    const test = harness({ gate: (input) => runGate(input) });
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];
    const outcome = await test.engine.start(
      runInput({ repo: { ...runInput().repo, gate: 'exit 1' } }),
    );

    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('gate_failed');
    expect(outcome.gate?.exitCode).toBe(1);
    expect(test.states).not.toContain('merging');
    expect(test.states).not.toContain('succeeded');
    expect(test.git.pushes).toEqual([]);
    expect(test.git.opened).toEqual([]);
    expect(test.git.merges).toEqual([]);
    expect(test.workspaces.calls).not.toContain('removeWorktree');
    const row = test.store.runs.getRecord(RUN_ID);
    expect(row?.state).toBe('failed');
    expect(row?.failureCode).toBe('gate_failed');
    expect(row?.finishedAt).not.toBeNull();
    expect(eventTypes(test.emitted)).toEqual([
      'run.queued',
      'run.started',
      'run.gate',
      'run.failed',
    ]);
    expect((outcome.gate?.tail ?? []).join('\n')).not.toContain('design_scan');
    expect(designLogs(test)).toEqual([]);
  });

  it('parks a protected path in pr_open with eight guardrails and never merges', async () => {
    const test = harness({
      status: { changedPaths: ['src/flag.ts', 'ops/vm/install.sh'] },
    });
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];
    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('pr_open');
    expect(outcome.blockers.map((blocker) => blocker.code)).toEqual(['protected_path']);
    const row = test.store.runs.getRecord(RUN_ID);
    expect(row?.state).toBe('pr_open');
    expect(row?.finishedAt).toBeNull();
    expect(guardrailOf(row ?? { guardrails: [] })).toEqual([...GUARDRAIL_IDS]);
    expect(row?.guardrails).toEqual(
      expect.arrayContaining([{ id: 'protected_paths', state: 'fail', reason: 'protected_path' }]),
    );
    expect(test.git.merges).toEqual([]);
    expect(test.git.deleted).toEqual([]);
    expect(test.states).not.toContain('merging');
    expect(eventTypes(test.emitted)).not.toContain('run.merged');
    expect(eventTypes(test.emitted)).not.toContain('run.finished');
    expect(test.engine.active()).toEqual([]);
  });

  it('parks the run when the base moved under the pull request', async () => {
    const test = harness();
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];
    test.git.pullRequest = pullRequest({ baseSha: MOVED_SHA });
    const outcome = await test.engine.start(runInput());
    expect(outcome.state).toBe('pr_open');
    expect(outcome.blockers.map((blocker) => blocker.code)).toEqual(['base_moved']);
    expect(test.store.runs.getRecord(RUN_ID)?.state).toBe('pr_open');
    expect(test.git.merges).toEqual([]);
  });

  it('parks the run when a required check is red', async () => {
    const test = harness();
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];
    test.git.checks = {
      state: 'failure',
      checks: [{ name: 'ci', conclusion: 'failure', required: true }],
    };
    const outcome = await test.engine.start(runInput());
    expect(outcome.state).toBe('pr_open');
    expect(outcome.blockers.map((blocker) => blocker.code)).toEqual(['checks_red']);
    expect(test.git.merges).toEqual([]);
  });

  it('retries a retryable merge refusal once and parks on the second', async () => {
    const test = harness();
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];
    const refusal: MergeResult = {
      merged: false,
      sha: null,
      method: 'squash',
      reason: 'head_moved',
      retryable: true,
    };
    test.git.mergeResults = [refusal, refusal];
    const outcome = await test.engine.start(runInput());

    expect(test.git.merges).toHaveLength(2);
    expect(test.git.getPullRequestCalls).toBe(1);
    expect(outcome.state).toBe('pr_open');
    expect(outcome.blockers.map((blocker) => blocker.code)).toEqual(['base_moved']);
    expect(test.store.runs.getRecord(RUN_ID)?.state).toBe('pr_open');
    expect(test.states).toContain('merging');
    expect(test.states.at(-1)).toBe('pr_open');
    expect(eventTypes(test.emitted)).not.toContain('run.merged');
  });
});

describe('run engine — the secret scan gate step', () => {
  const SECRET = `ghp_${'A'.repeat(36)}`;

  function patchWithSecret(path = 'src/x.ts'): string {
    return [
      `diff --git a/${path} b/${path}`,
      'index 1111111..2222222 100644',
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1,3 +1,4 @@',
      ' const a = 1;',
      ' const b = 2;',
      `+const cred = '${SECRET}';`,
      ' const c = 3;',
      '',
    ].join('\n');
  }

  it('fails the run with gate_failed and keeps the literal out of the tail and the logs', async () => {
    const test = harness({ git: { patch: patchWithSecret() } });
    const logDir = join(test.settings.logsDir, `run-${RUN_ID}`);
    mkdirSync(logDir, { recursive: true });
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('gate_failed');
    expect(outcome.gate?.status).toBe('failed');
    expect(outcome.gate?.exitCode).toBe(1);
    expect(outcome.gate?.tail).toContain('src/x.ts:3 github_token');
    expect(test.store.runs.getRecord(RUN_ID)?.gate).toMatchObject({
      status: 'failed',
      exitCode: 1,
    });
    expect(test.store.runs.getRecord(RUN_ID)?.failureCode).toBe('gate_failed');
    expect(test.git.pushes).toEqual([]);
    expect(test.git.opened).toEqual([]);
    expect(eventTypes(test.emitted)).not.toContain('run.pr');
    expect(eventTypes(test.emitted).at(-1)).toBe('run.failed');

    const log = readFileSync(join(logDir, 'gate.log'), 'utf8');
    expect(log).toContain('src/x.ts:3 github_token');
    expect(log).not.toContain(SECRET);
    expect((outcome.gate?.tail ?? []).join('\n')).not.toContain(SECRET);
    expect(JSON.stringify(test.lines)).not.toContain(SECRET);
    const scanLogs = test.lines.filter((line) => line['msg'] === 'secret_scan_failed');
    expect(scanLogs).toHaveLength(1);
    expect(scanLogs[0]).toMatchObject({
      level: 'error',
      runId: RUN_ID,
      findings: 1,
      oversized: false,
    });
  });

  it('fails closed when the diff cannot be read', async () => {
    const test = harness({ git: { scanCode: 1 } });
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('gate_failed');
    expect(outcome.gate?.tail).toContain('secret_scan: git_failed');
    expect(test.store.runs.getRecord(RUN_ID)?.gate).toMatchObject({
      status: 'failed',
      exitCode: 1,
    });
    expect(test.git.pushes).toEqual([]);
    const scanLogs = test.lines.filter((line) => line['msg'] === 'secret_scan_failed');
    expect(scanLogs).toHaveLength(1);
    expect(scanLogs[0]).toMatchObject({ runId: RUN_ID, code: 'git_failed' });
  });

  it('fails an oversized patch without scanning it', async () => {
    const test = harness({ git: { patch: 'x'.repeat(MAX_SECRET_SCAN_BYTES + 1) } });
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('gate_failed');
    expect(outcome.gate?.tail).toContain('secret_scan: patch exceeded 4194304 bytes');
    const scanLogs = test.lines.filter((line) => line['msg'] === 'secret_scan_failed');
    expect(scanLogs[0]).toMatchObject({ runId: RUN_ID, findings: 0, oversized: true });
  });

  it('leaves a clean diff on the existing success path', async () => {
    const test = harness();
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('succeeded');
    expect(outcome.gate?.status).toBe('passed');
    expect(test.store.runs.getRecord(RUN_ID)?.gate).toMatchObject({
      status: 'passed',
      exitCode: 0,
    });
    expect(test.lines.filter((line) => line['msg'] === 'secret_scan_failed')).toEqual([]);
    expect(test.git.pushes).toHaveLength(1);
  });
});

describe('run engine — the design scan gate step', () => {
  const SECRET = `ghp_${'A'.repeat(36)}`;

  function patchWithSecretAndColour(): string {
    return [
      'diff --git a/src/x.ts b/src/x.ts',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,2 +1,4 @@',
      ' const a = 1;',
      ' const b = 2;',
      `+const cred = '${SECRET}';`,
      '+color: #0b1120;',
      '',
    ].join('\n');
  }

  it('passes a token literal and fails the same line written outside the tokens', async () => {
    const green = harness({ git: { patch: patchWithColour('#0b0f14') } });
    writeDesignFixture(green);
    green.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const passed = await green.engine.start(runInput());

    expect(passed.state).toBe('succeeded');
    expect(passed.gate?.status).toBe('passed');
    expect((passed.gate?.tail ?? []).join('\n')).not.toContain('colour_outside_tokens');
    expect(designLogs(green)).toEqual([]);

    const drift = harness({ git: { patch: patchWithColour('#0b1120') } });
    writeDesignFixture(drift);
    drift.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const failed = await drift.engine.start(runInput());

    expect(failed.state).toBe('failed');
    expect(failed.failure?.code).toBe('gate_failed');
    expect(failed.gate?.status).toBe('failed');
    expect(failed.gate?.tail).toContain('apps/app/src/theme/extra.css:1 colour_outside_tokens');
  });

  it('fails the run when a screen declares a colour outside the tokens', async () => {
    const test = harness();
    writeDesignFixture(test, { error: 'The dashboard failed with #0b1120' });
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('gate_failed');
    expect(outcome.gate?.status).toBe('failed');
    expect(outcome.gate?.exitCode).toBe(1);
    expect(outcome.gate?.tail).toContain('design/screens/dashboard.json:1 colour_outside_tokens');
    expect(test.git.pushes).toEqual([]);
    expect(test.git.opened).toEqual([]);
    expect(eventTypes(test.emitted)).not.toContain('run.pr');
    const logs = designLogs(test);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      msg: 'design_scan_reported',
      runId: RUN_ID,
      findings: 1,
      enforced: 1,
      reportOnly: 0,
    });
  });

  it('reports a missing screen state without failing the run', async () => {
    const test = harness();
    writeDesignFixture(test, { empty: null });
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('succeeded');
    expect(outcome.gate?.status).toBe('passed');
    expect(outcome.gate?.exitCode).toBe(0);
    expect(outcome.gate?.tail).toContain(
      'design/screens/dashboard.json:1 screen_state_missing (report-only)',
    );
    expect(test.git.opened).toHaveLength(1);
    const logs = designLogs(test);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'info',
      msg: 'design_scan_reported',
      runId: RUN_ID,
      findings: 1,
      enforced: 0,
      reportOnly: 1,
    });
  });

  it('skips the step when the repository has no token document', async () => {
    const test = harness();
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('succeeded');
    expect(test.git.pushes).toHaveLength(1);
    expect(designLogs(test)).toEqual([]);
    expect(outcome.gate?.tail).toEqual(['gate ok']);
  });

  it('fails closed when the design scan cannot read the diff', async () => {
    const test = harness({ git: { failScanCall: 2 } });
    writeDesignFixture(test);
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('gate_failed');
    expect(outcome.gate?.tail).toContain('design_scan: git_failed');
    expect((outcome.gate?.tail ?? []).join('\n')).not.toContain('secret_scan:');
    const logs = test.lines.filter((line) => line['msg'] === 'design_scan_failed');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ runId: RUN_ID, code: 'git_failed' });
  });

  it('leaves the report to the secret scan when the same diff also holds a colour', async () => {
    const test = harness({ git: { patch: patchWithSecretAndColour() } });
    writeDesignFixture(test);
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];

    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('gate_failed');
    const tail = (outcome.gate?.tail ?? []).join('\n');
    expect(tail).toContain('src/x.ts:3 github_token');
    expect(tail).not.toContain('colour_outside_tokens');
    expect(designLogs(test)).toEqual([]);
  });
});

describe('run engine — cancel, timeout and cost', () => {
  it('cancels a running run and releases its session and worktree', async () => {
    const test = harness();
    test.agent.script = [busyEvent('ses_fake1')];
    const started = test.engine.start(runInput());
    await waitFor(() => test.agent.prompts.length === 1, 'the prompt');
    expect(test.engine.active()).toEqual([RUN_ID]);

    expect(await test.engine.cancel(RUN_ID)).toBe(true);

    expect(test.agent.interrupts).toEqual(['ses_fake1']);
    expect(test.agent.closes).toEqual(['ses_fake1']);
    expect(test.workspaces.calls).toContain('removeWorktree');
    const row = test.store.runs.getRecord(RUN_ID);
    expect(row?.state).toBe('cancelled');
    expect(row?.failureCode).toBeNull();
    expect(row?.finishedAt).not.toBeNull();
    expect(eventTypes(test.emitted)).toContain('run.cancelled');
    const cancelled = test.emitted.find((record) => record.type === 'run.cancelled');
    expect(cancelled?.data).toMatchObject({ state: 'cancelled', reason: 'operator' });
    expect(() => parseSseEvent({ event: 'run.cancelled', data: cancelled?.data })).not.toThrow();

    const outcome = await started;
    expect(outcome.state).toBe('cancelled');
    expect(outcome.failure).toBeNull();
    expect(test.engine.active()).toEqual([]);
  });

  it('refuses a cancel while merging without side effects', async () => {
    const test = harness();
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];
    const held: { release: ((result: MergeResult) => void) | null } = { release: null };
    const merge = test.git.mergePullRequest.bind(test.git);
    test.git.mergePullRequest = (input) => {
      const waiting = new Promise<MergeResult>((resolve) => {
        held.release = resolve;
      });
      void merge(input);
      return waiting;
    };
    const started = test.engine.start(runInput());
    await waitFor(() => held.release !== null, 'the merge call');
    expect(test.store.runs.getRecord(RUN_ID)?.state).toBe('merging');

    expect(await test.engine.cancel(RUN_ID)).toBe(false);
    expect(test.agent.interrupts).toEqual([]);
    expect(test.workspaces.calls).not.toContain('removeWorktree');

    held.release?.({
      merged: true,
      sha: MERGE_SHA,
      method: 'squash',
      reason: 'merged',
      retryable: false,
    });
    const outcome = await started;
    expect(outcome.state).toBe('succeeded');
  });

  it('cancels with timeout when the run clock passed the limit', async () => {
    const test = harness({ settings: { runTimeoutSeconds: 1 } });
    test.agent.script = [busyEvent('ses_fake1')];
    const started = test.engine.start(runInput());
    await waitFor(() => test.agent.prompts.length === 1, 'the prompt');
    test.advance(2_000);
    test.agent.push('ses_fake1', textEvent('ses_fake1', 'late output'));

    const outcome = await started;
    expect(outcome.state).toBe('cancelled');
    expect(outcome.failure?.code).toBe('timeout');
    const row = test.store.runs.getRecord(RUN_ID);
    expect(row?.state).toBe('cancelled');
    expect(row?.failureCode).toBe('timeout');
    expect(test.agent.interrupts).toEqual(['ses_fake1']);
    expect(test.workspaces.calls).toContain('removeWorktree');
    const cancelled = test.emitted.find((record) => record.type === 'run.cancelled');
    expect(cancelled?.data).toMatchObject({ state: 'cancelled', reason: 'timeout' });
  });

  it('cancels with cost_cap_reached and persists the cumulative cost', async () => {
    const test = harness();
    test.setSpend(9.5);
    test.agent.script = [
      busyEvent('ses_fake1'),
      usageEvent('ses_fake1', 1),
      idleEvent('ses_fake1'),
    ];
    const outcome = await test.engine.start(runInput());
    expect(outcome.state).toBe('cancelled');
    expect(outcome.failure?.code).toBe('cost_cap_reached');
    const row = test.store.runs.getRecord(RUN_ID);
    expect(row?.state).toBe('cancelled');
    expect(row?.failureCode).toBe('cost_cap_reached');
    expect(row?.cost).toEqual({ usd: 1, tokensIn: 100, tokensOut: 50 });
    expect(test.agent.interrupts).toEqual(['ses_fake1']);
  });
});

describe('run engine — one transport retry', () => {
  it('re-opens the session once and succeeds on the second attempt', async () => {
    const test = harness();
    test.agent.failCreates = [new AgentError('agent_unavailable', 'down', null, true)];
    test.agent.script = [busyEvent('ses_fake1'), idleEvent('ses_fake1')];
    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('succeeded');
    expect(test.agent.createCalls).toBe(2);
    expect(test.agent.created).toHaveLength(1);
    expect(test.agent.prompts).toHaveLength(1);
    expect(test.store.runs.getRecord(RUN_ID)?.attempt).toBe(2);
    expect(eventTypes(test.emitted).filter((type) => type === 'run.started')).toHaveLength(1);
  });

  it('re-prompts in a fresh session after a transport failure before any tool', async () => {
    const test = harness();
    test.agent.failPrompt = new AgentError('agent_unavailable', 'down', null, true);
    test.agent.script = [busyEvent('ses_fake2'), idleEvent('ses_fake2')];
    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('succeeded');
    expect(test.agent.createCalls).toBe(2);
    expect(test.agent.prompts.map((prompt) => prompt.sessionId)).toEqual([
      'ses_fake1',
      'ses_fake2',
    ]);
    expect(test.store.runs.getRecord(RUN_ID)?.attempt).toBe(2);
    expect(eventTypes(test.emitted).filter((type) => type === 'run.started')).toHaveLength(1);
  });

  it('fails after a second agent_unavailable', async () => {
    const test = harness();
    test.agent.failCreates = [
      new AgentError('agent_unavailable', 'down', null, true),
      new AgentError('agent_unavailable', 'still down', null, true),
    ];
    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('agent_unavailable');
    expect(test.agent.createCalls).toBe(2);
    expect(test.agent.created).toHaveLength(0);
    expect(test.store.runs.getRecord(RUN_ID)?.failureCode).toBe('agent_unavailable');
    expect(test.store.runs.getRecord(RUN_ID)?.attempt).toBe(2);
  });

  it('does not retry a failure that came after a tool event', async () => {
    const test = harness();
    test.agent.script = [busyEvent('ses_fake1'), toolEvent('ses_fake1', 'bash')];
    test.agent.throwAfterScript = new AgentError('agent_unavailable', 'lost', null, true);
    const outcome = await test.engine.start(runInput());

    expect(outcome.state).toBe('failed');
    expect(outcome.failure?.code).toBe('agent_unavailable');
    expect(test.agent.created).toHaveLength(1);
    expect(eventTypes(test.emitted)).toContain('run.tool');
    expect(test.workspaces.calls).not.toContain('removeWorktree');
  });
});
