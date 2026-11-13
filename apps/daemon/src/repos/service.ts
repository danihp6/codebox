import { join } from 'node:path';
import type { CreateRepoBody, Repo, RepoDetail, RepoPolicy, RepoVerify } from '@codebox/contracts';
import { createGitHubProvider } from '@codebox/git-provider';
import type { GitProvider } from '@codebox/git-provider';
import { StoreError, decodeCursor, encodeCursor } from '@codebox/store';
import type { PageResult, Store } from '@codebox/store';
import { GIT_ENV, WorkspaceError, createGitRunner, initLocal } from '@codebox/workspaces';
import type { DaemonContext } from '../modules.js';
import { providerAuth } from '../runs/engine.js';
import { RunApiError } from '../runs/errors.js';
import { newRepoId } from './ids.js';

const GIT_HOST = 'github.com';

/** `nameSchema`'s ceiling; a slug tail longer than this is cut, never refused. */
const NAME_MAX_LENGTH = 64;

const LOCAL_VERIFY_TIMEOUT_MS = 30_000;

export const REPO_DEFAULTS = Object.freeze({
  defaultBranch: 'main',
  gate: 'npm ci && npm test && npm run build',
  policy: 'auto' as const,
  protectedPaths: [] as readonly string[],
  enabled: true,
});

export interface RepoListQuery {
  readonly limit: number;
  readonly cursor: string | null;
}

/** `index.ts` re-exports the name; the service now takes the contract body itself. */
export type CreateRepoInput = CreateRepoBody;

export interface RepoPatchInput {
  readonly gate?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly protectedPaths?: readonly string[] | undefined;
  readonly enabled?: boolean | undefined;
}

/** The minimum the daemon needs from git; the default implementation wraps GitProvider.verifyRepo. */
export interface RepoVerifyPort {
  verify(slug: string): Promise<{ readonly defaultBranch: string; readonly canPush: boolean }>;
}

/** D62: the box's own answer for a repository with no remote. */
export interface RepoLocalVerifyPort {
  checks(input: { readonly name: string; readonly defaultBranch: string }): Promise<{
    readonly repo: string;
    readonly branch: string;
  }>;
}

export interface RepoLocalInitPort {
  init(input: { readonly name: string; readonly defaultBranch: string }): Promise<{
    readonly path: string;
  }>;
}

export interface CreateReposServiceOptions {
  readonly context: DaemonContext;
  readonly verify?: RepoVerifyPort;
  readonly localInit?: RepoLocalInitPort;
  readonly localVerify?: RepoLocalVerifyPort;
}

export interface ReposService {
  list(query: RepoListQuery): PageResult<Repo>;
  detail(id: string): RepoDetail;
  create(input: CreateRepoBody): Promise<Repo>;
  patch(id: string, input: RepoPatchInput): Repo;
  remove(id: string): void;
  verify(id: string): Promise<RepoVerify>;
}

const SERVICES = new WeakMap<DaemonContext, ReposService>();

function notFound(): RunApiError {
  return new RunApiError('not_found', 404, { path: 'repo.id' });
}

function requireRepo(store: Store, id: string): Repo {
  const repo = store.repos.get(id);
  if (repo === null) throw notFound();
  return repo;
}

/**
 * D62: the `name` the github arm sends. The store derives one from the slug tail for a legacy row,
 * and a tail that starts outside `[a-z0-9]` (`acme/.github`) would fail `nameSchema` at the edge.
 */
function nameOfSlug(slug: string): string {
  const separator = slug.indexOf('/');
  const tail = separator === -1 ? slug : slug.slice(separator + 1);
  const stripped = tail.toLowerCase().replace(/^[^a-z0-9]+/, '');
  const name = stripped.slice(0, NAME_MAX_LENGTH);
  return name.length === 0 ? 'repo' : name;
}

/** `docs/api.md` §5.2: the four checks, in this order, and `ok` only when all four are `ok`. */
function verifyChecks(
  repo: Repo,
  answer: { readonly defaultBranch: string; readonly canPush: boolean },
): RepoVerify['checks'] {
  return [
    { name: 'repo', state: 'ok' },
    { name: 'branch', state: answer.defaultBranch === repo.defaultBranch ? 'ok' : 'mismatch' },
    { name: 'push', state: answer.canPush ? 'ok' : 'forbidden' },
    { name: 'gate', state: repo.gate.length > 0 ? 'ok' : 'missing' },
  ];
}

function defaultVerifyPort(context: DaemonContext): RepoVerifyPort {
  const git = createGitRunner();
  let provider: GitProvider | null = null;
  function github(): GitProvider {
    if (provider === null) {
      provider = createGitHubProvider({
        auth: providerAuth(context),
        apiBase: context.config.CB_GITHUB_API_URL,
        gitHost: GIT_HOST,
        fetch: (url, init) => fetch(url, init),
        git,
        now: () => context.clock().getTime(),
        requestTimeoutMs: context.config.CB_GIT_HTTP_TIMEOUT_SECONDS * 1000,
        log: (event): void => {
          context.logger.debug({ msg: 'git_provider', level: event.level, status: event.status });
        },
        userAgent: `codebox/${context.build.version}`,
      });
    }
    return provider;
  }
  return {
    async verify(slug: string): Promise<{ defaultBranch: string; canPush: boolean }> {
      const answer = await github().verifyRepo(slug);
      return { defaultBranch: answer.defaultBranch, canPush: answer.canPush };
    },
  };
}

function defaultLocalInitPort(context: DaemonContext): RepoLocalInitPort {
  return {
    async init(input: {
      readonly name: string;
      readonly defaultBranch: string;
    }): Promise<{ path: string }> {
      const created = await initLocal({
        repoRoot: context.config.CB_REPO_ROOT,
        name: input.name,
        defaultBranch: input.defaultBranch,
        git: createGitRunner(),
      });
      return { path: created.path };
    },
  };
}

function defaultLocalVerifyPort(context: DaemonContext): RepoLocalVerifyPort {
  const git = createGitRunner();

  async function state(cwd: string, args: readonly string[]): Promise<string> {
    try {
      const answer = await git.run({ args, cwd, timeoutMs: LOCAL_VERIFY_TIMEOUT_MS, env: GIT_ENV });
      return answer.code === 0 ? 'ok' : 'missing';
    } catch {
      return 'missing';
    }
  }

  return {
    async checks(input: {
      readonly name: string;
      readonly defaultBranch: string;
    }): Promise<{ repo: string; branch: string }> {
      // A missing folder is a git failure, and here that is an answer rather than a 503.
      const cwd = join(context.config.CB_REPO_ROOT, input.name);
      return {
        repo: await state(cwd, ['rev-parse', '--is-inside-work-tree']),
        branch: await state(cwd, ['rev-parse', `refs/heads/${input.defaultBranch}`]),
      };
    },
  };
}

export function createReposService(options: CreateReposServiceOptions): ReposService {
  const context = options.context;
  const store = context.store;
  const clock = context.clock;
  let port: RepoVerifyPort | null = options.verify ?? null;
  let init: RepoLocalInitPort | null = options.localInit ?? null;
  let local: RepoLocalVerifyPort | null = options.localVerify ?? null;

  function verifyPort(): RepoVerifyPort {
    if (port === null) port = defaultVerifyPort(context);
    return port;
  }

  function initPort(): RepoLocalInitPort {
    if (init === null) init = defaultLocalInitPort(context);
    return init;
  }

  function localVerifyPort(): RepoLocalVerifyPort {
    if (local === null) local = defaultLocalVerifyPort(context);
    return local;
  }

  function defaultsOf(input: CreateRepoBody): {
    defaultBranch: string;
    gate: string;
    policy: RepoPolicy;
    protectedPaths: string[];
    enabled: boolean;
  } {
    return {
      defaultBranch: input.defaultBranch ?? REPO_DEFAULTS.defaultBranch,
      gate: input.gate ?? REPO_DEFAULTS.gate,
      policy: input.policy ?? REPO_DEFAULTS.policy,
      protectedPaths: input.protectedPaths === undefined ? [] : [...input.protectedPaths],
      enabled: REPO_DEFAULTS.enabled,
    };
  }

  function removeRowQuietly(id: string): void {
    try {
      store.repos.delete(id);
    } catch {
      // A secondary failure changes neither the answer below nor the warn line that carries it.
    }
  }

  async function createLocal(input: CreateRepoBody): Promise<Repo> {
    const name = input.name;
    if (name === undefined) throw new RunApiError('validation_failed', 422, { path: 'repo.name' });
    // The unique index is the duplicate gate: a taken name must refuse before a folder exists.
    const repo = store.repos.create({
      id: newRepoId(),
      source: 'local',
      name,
      slug: null,
      ...defaultsOf(input),
      createdAt: clock().toISOString(),
    });
    try {
      await initPort().init({ name, defaultBranch: repo.defaultBranch });
    } catch (error) {
      removeRowQuietly(repo.id);
      context.logger.warn({
        msg: 'repo_create_failed',
        name,
        code: error instanceof WorkspaceError ? error.code : 'unexpected',
      });
      throw new RunApiError('agent_unavailable', 503, { reason: 'workspace_unavailable' });
    }
    return repo;
  }

  async function verifyLocal(repo: Repo): Promise<RepoVerify> {
    const answer = await localVerifyPort().checks({
      name: repo.name ?? '',
      defaultBranch: repo.defaultBranch,
    });
    // D62: a repository with no remote has nothing to push, so `push` is neither pass nor failure.
    const checks: RepoVerify['checks'] = [
      { name: 'repo', state: answer.repo },
      { name: 'branch', state: answer.branch },
      { name: 'push', state: 'not_applicable' },
      { name: 'gate', state: repo.gate.length > 0 ? 'ok' : 'missing' },
    ];
    return {
      ok: answer.repo === 'ok' && answer.branch === 'ok' && repo.gate.length > 0,
      defaultBranch: repo.defaultBranch,
      canPush: false,
      checks,
    };
  }

  return {
    list(query: RepoListQuery): PageResult<Repo> {
      const cursor = query.cursor === null ? null : decodeCursor(query.cursor);
      const all = store.repos.list();
      // The cursor is (createdAt, id), never an offset: an insert between two pages repeats nothing.
      const remaining =
        cursor === null
          ? all
          : all.filter(
              (repo) =>
                repo.createdAt < cursor.createdAt ||
                (repo.createdAt === cursor.createdAt && repo.id < cursor.id),
            );
      const data = remaining.slice(0, query.limit);
      const last = data.at(-1);
      const nextCursor =
        last === undefined || remaining.length <= data.length
          ? null
          : encodeCursor(last.createdAt, last.id);
      return { data, nextCursor };
    },

    detail(id: string): RepoDetail {
      const repo = requireRepo(store, id);
      const lastRun = store.runs.list({ repoId: id, limit: 1, cursor: null }).data[0] ?? null;
      return { ...repo, lastRun };
    },

    async create(input: CreateRepoBody): Promise<Repo> {
      if (input.mode === 'connect') {
        // Batch 35/Task-128 replaces this refusal with the App installation; no row, no provider.
        throw new RunApiError('conflict', 409, { reason: 'github_app_installed_required' });
      }
      if (input.mode === 'local') return createLocal(input);
      const slug = input.slug;
      if (slug === undefined) {
        throw new RunApiError('validation_failed', 422, { path: 'repo.slug' });
      }
      // A taken slug is `StoreError('unique_violation')`; `handle` maps it to a 409.
      return store.repos.create({
        id: newRepoId(),
        source: 'github',
        name: nameOfSlug(slug),
        slug,
        ...defaultsOf(input),
        createdAt: clock().toISOString(),
      });
    },

    patch(id: string, input: RepoPatchInput): Repo {
      // Slug and default branch are not patchable over HTTP: the slug is the repository's identity.
      const patch: {
        gate?: string;
        policy?: RepoPolicy;
        protectedPaths?: readonly string[];
        enabled?: boolean;
      } = {};
      if (input.gate !== undefined) patch.gate = input.gate;
      if (input.policy !== undefined) patch.policy = input.policy;
      if (input.protectedPaths !== undefined) patch.protectedPaths = [...input.protectedPaths];
      if (input.enabled !== undefined) patch.enabled = input.enabled;
      return store.repos.update(id, patch);
    },

    remove(id: string): void {
      try {
        store.repos.delete(id);
      } catch (error) {
        if (error instanceof StoreError) {
          if (error.code === 'repo_has_live_run') {
            throw new RunApiError('conflict', 409, { reason: 'repo_has_live_run' });
          }
          if (error.code === 'foreign_key_violation') {
            throw new RunApiError('conflict', 409, { reason: 'repo_has_history' });
          }
        }
        throw error;
      }
    },

    async verify(id: string): Promise<RepoVerify> {
      const repo = requireRepo(store, id);
      if (repo.source === 'local') return verifyLocal(repo);
      const slug = repo.slug;
      if (slug === null) {
        throw new RunApiError('provider_unavailable', 503, { reason: 'provider_unavailable' });
      }
      let answer: { readonly defaultBranch: string; readonly canPush: boolean };
      try {
        answer = await verifyPort().verify(slug);
      } catch {
        context.logger.warn({ msg: 'repo_verify_failed', repoId: repo.id, slug: repo.slug });
        throw new RunApiError('provider_unavailable', 503, { reason: 'provider_unreachable' });
      }
      const checks = verifyChecks(repo, answer);
      return {
        ok: checks.every((check) => check.state === 'ok'),
        defaultBranch: answer.defaultBranch,
        canPush: answer.canPush,
        checks,
      };
    },
  };
}

export function reposService(context: DaemonContext): ReposService {
  const existing = SERVICES.get(context);
  if (existing !== undefined) return existing;
  const created = createReposService({ context });
  SERVICES.set(context, created);
  return created;
}
