import { join } from 'node:path';
import { matchesGlob } from '@codebox/core';
import { createAgentRuntime } from '@codebox/opencode';
import { createGitHubProvider, decodePrivateKey } from '@codebox/git-provider';
import type { LogSink, ProviderAuth } from '@codebox/git-provider';
import { createWorkspaceManager, createGitRunner } from '@codebox/workspaces';
import type { WorkspaceManager } from '@codebox/workspaces';
import { runGate } from '../gate/run-gate.js';
import type { DaemonContext } from '../modules.js';
import { createRunEngine } from '../run/engine.js';
import type { RunEngine, RunPorts, RunSettings } from '../run/ports.js';

const AGENT_REQUEST_TIMEOUT_MS = 30_000;
const AGENT_RECONNECT_DELAY_MS = 1_000;
const GIT_HOST = 'github.com';

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The workspace manager the run flow and the diff route share, built from `CB_*` only. */
export function createDaemonWorkspaces(context: DaemonContext): WorkspaceManager {
  const config = context.config;
  return createWorkspaceManager({
    repoRoot: config.CB_REPO_ROOT,
    workspaceRoot: config.CB_WORKSPACE_ROOT,
    git: createGitRunner(),
    matchesGlob,
    cloneDepth: config.CB_CLONE_DEPTH,
    httpTimeoutSeconds: config.CB_GIT_HTTP_TIMEOUT_SECONDS,
    now: context.clock,
  });
}

/**
 * App keys first, the fine-grained PAT as the fallback of docs/providers.md. A malformed App key
 * must not turn every run request into a 500: the provider degrades to `none` and a run that
 * needs git fails at its git step with `provider_unavailable`.
 */
export function providerAuth(context: DaemonContext): ProviderAuth {
  const config = context.config;
  const appId = config.CB_GITHUB_APP_ID;
  const encodedKey = config.CB_GITHUB_APP_PRIVATE_KEY_BASE64;
  const installationId = config.CB_GITHUB_INSTALLATION_ID;
  if (appId !== null && encodedKey !== null && installationId !== null) {
    try {
      return {
        kind: 'app',
        appId,
        installationId,
        privateKeyPem: decodePrivateKey(encodedKey),
      };
    } catch {
      context.logger.warn({ msg: 'github_app_key_invalid' });
    }
  }
  if (config.CB_GITHUB_TOKEN !== null) return { kind: 'pat', token: config.CB_GITHUB_TOKEN };
  return { kind: 'none' };
}

export function createDaemonSettings(context: DaemonContext): RunSettings {
  const config = context.config;
  return {
    gateDefault: config.CB_GATE_DEFAULT,
    gateShell: config.CB_GATE_SHELL,
    gateTimeoutSeconds: config.CB_GATE_TIMEOUT_SECONDS,
    runTimeoutSeconds: config.CB_RUN_TIMEOUT_SECONDS,
    maxConcurrency: config.CB_MAX_CONCURRENCY,
    maxPerRepo: config.CB_MAX_CONCURRENCY_PER_REPO,
    dailyCostUsd: config.CB_DAILY_COST_USD,
    automerge: config.CB_AUTOMERGE,
    mergeMethod: config.CB_MERGE_METHOD,
    protectedPaths: config.CB_PROTECTED_PATHS,
    diffMaxFiles: config.CB_DIFF_MAX_FILES,
    diffMaxLines: config.CB_DIFF_MAX_LINES,
    probationRuns: config.CB_PROBATION_RUNS,
    consecutiveGreenRuns: 0,
    approvalTtlSeconds: config.CB_APPROVAL_TTL_SECONDS,
    logsDir: join(config.CB_STATE_DIR, 'logs'),
    author: { name: config.CB_GIT_AUTHOR_NAME, email: config.CB_GIT_AUTHOR_EMAIL },
    gitTimeoutMs: config.CB_GIT_HTTP_TIMEOUT_SECONDS * 1000,
  };
}

/** Every effect of the run flow, wired from the merged packages. Construction does no I/O. */
export function createDaemonPorts(context: DaemonContext): RunPorts {
  const config = context.config;
  const store = context.store;
  const clock = context.clock;
  const logger = context.logger;
  const gitRunner = createGitRunner();
  const providerLog: LogSink = (event): void => {
    logger.debug({
      msg: 'git_provider',
      level: event.level,
      detail: event.message,
      status: event.status,
    });
  };
  return {
    workspaces: createDaemonWorkspaces(context),
    agent: createAgentRuntime({
      baseUrl: config.CB_OPENCODE_URL,
      token: config.CB_OPENCODE_TOKEN,
      healthPath: config.CB_OPENCODE_HEALTH_PATH,
      fetch: (url, init) => fetch(url, init),
      requestTimeoutMs: AGENT_REQUEST_TIMEOUT_MS,
      reconnectDelayMs: AGENT_RECONNECT_DELAY_MS,
      sleep,
    }),
    git: createGitHubProvider({
      auth: providerAuth(context),
      apiBase: config.CB_GITHUB_API_URL,
      gitHost: GIT_HOST,
      fetch: (url, init) => fetch(url, init),
      git: gitRunner,
      now: () => clock().getTime(),
      requestTimeoutMs: config.CB_GIT_HTTP_TIMEOUT_SECONDS * 1000,
      log: providerLog,
      userAgent: `codebox/${context.build.version}`,
    }),
    gitRunner,
    gate: runGate,
    store,
    clock,
    logger,
    // Delivery is the SSE bridge's poll over `run_events`; the engine gets a debug line only.
    emit: (record): void => {
      logger.debug({ msg: 'run_event', event: record.type, eventId: record.id });
    },
    spentTodayUsd: (): number => store.usage.spendOnDay(clock().toISOString().slice(0, 10)),
    settings: createDaemonSettings(context),
  };
}

/** The daemon's one engine: built on the first run request, never at module register time. */
export function createDaemonEngine(context: DaemonContext): RunEngine {
  return createRunEngine(createDaemonPorts(context));
}
