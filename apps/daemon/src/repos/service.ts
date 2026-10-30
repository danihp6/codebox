import type { Repo, RepoDetail, RepoPolicy, RepoVerify } from '@codebox/contracts';
import { createGitHubProvider } from '@codebox/git-provider';
import type { GitProvider } from '@codebox/git-provider';
import { StoreError, decodeCursor, encodeCursor } from '@codebox/store';
import type { PageResult, Store } from '@codebox/store';
import { createGitRunner } from '@codebox/workspaces';
import type { DaemonContext } from '../modules.js';
import { providerAuth } from '../runs/engine.js';
import { RunApiError } from '../runs/errors.js';
import { newRepoId } from './ids.js';

const GIT_HOST = 'github.com';

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

export interface CreateRepoInput {
  readonly slug: string;
  readonly defaultBranch?: string | undefined;
  readonly gate?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly protectedPaths?: readonly string[] | undefined;
}

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

export interface CreateReposServiceOptions {
  readonly context: DaemonContext;
  readonly verify?: RepoVerifyPort;
}

export interface ReposService {
  list(query: RepoListQuery): PageResult<Repo>;
  detail(id: string): RepoDetail;
  create(input: CreateRepoInput): Repo;
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

export function createReposService(options: CreateReposServiceOptions): ReposService {
  const context = options.context;
  const store = context.store;
  const clock = context.clock;
  let port: RepoVerifyPort | null = options.verify ?? null;

  function verifyPort(): RepoVerifyPort {
    if (port === null) port = defaultVerifyPort(context);
    return port;
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

    create(input: CreateRepoInput): Repo {
      const repo: Repo = {
        id: newRepoId(),
        slug: input.slug,
        defaultBranch: input.defaultBranch ?? REPO_DEFAULTS.defaultBranch,
        gate: input.gate ?? REPO_DEFAULTS.gate,
        policy: input.policy ?? REPO_DEFAULTS.policy,
        protectedPaths: input.protectedPaths === undefined ? [] : [...input.protectedPaths],
        enabled: REPO_DEFAULTS.enabled,
        createdAt: clock().toISOString(),
      };
      // A taken slug is `StoreError('unique_violation')`; `handle` maps it to a 409.
      return store.repos.create(repo);
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
      let answer: { readonly defaultBranch: string; readonly canPush: boolean };
      try {
        answer = await verifyPort().verify(repo.slug);
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
