import type {
  CheckConclusion,
  CheckRun,
  CheckSummary,
  ChecksInput,
  DeleteBranchInput,
  GitHubProviderOptions,
  GitProvider,
  MergePullRequestInput,
  MergeReason,
  MergeResult,
  OpenPullRequestInput,
  PullRequest,
  PullRequestRefInput,
  PushBranchInput,
  PushResult,
  RepoInfo,
  RepoVerify,
} from './types.js';
import { GitProviderError } from './errors.js';
import {
  type GitHubResponse,
  type HttpMethod,
  type TokenSource,
  createTokenSource,
  invalidResponse,
  providerErrorFor,
  requestGitHub,
} from './tokens.js';

type LogPhrase =
  | 'github request failed'
  | 'github rate limited'
  | 'token refreshed'
  | 'token mint failed'
  | 'push failed'
  | 'pull request updated'
  | 'pull request opened'
  | 'merge rejected';

const SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GIT_PUSH_TIMEOUT_MS = 120_000;
const GIT_REV_PARSE_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSlug(slug: string): { readonly owner: string; readonly name: string } {
  const parts = slug.split('/');
  const owner = parts[0];
  const name = parts[1];
  if (
    parts.length !== 2 ||
    !SLUG_PATTERN.test(slug) ||
    owner === undefined ||
    name === undefined ||
    owner.length === 0 ||
    name.length === 0
  ) {
    throw new GitProviderError('validation_failed', 'repo slug is invalid', null, false);
  }
  return { owner, name };
}

function assertBranch(branch: string): string {
  if (
    branch.length === 0 ||
    branch.length > 255 ||
    /\s/.test(branch) ||
    branch.includes('..') ||
    branch.startsWith('-') ||
    branch.startsWith('/') ||
    branch.endsWith('/')
  ) {
    throw new GitProviderError('validation_failed', 'branch name is invalid', null, false);
  }
  return branch;
}

function assertNumber(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GitProviderError('validation_failed', 'pull request number is invalid', null, false);
  }
  return value;
}

function queryValue(value: string): string {
  return encodeURIComponent(value).replaceAll('%3A', ':').replaceAll('%2F', '/');
}

function pathSegments(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodeRepo(slug: string, input: unknown): RepoInfo {
  if (!isRecord(input)) throw invalidResponse();
  const defaultBranch = input['default_branch'];
  const privateRepo = input['private'];
  const permissions = input['permissions'];
  if (typeof defaultBranch !== 'string' || defaultBranch.length === 0) throw invalidResponse();
  if (typeof privateRepo !== 'boolean') throw invalidResponse();
  const canPush = isRecord(permissions) && permissions['push'] === true;
  return { slug, defaultBranch, private: privateRepo, canPush };
}

function decodeLabels(input: unknown): readonly string[] {
  if (!Array.isArray(input)) return [];
  const names: string[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) continue;
    const name = entry['name'];
    if (typeof name === 'string' && name.length > 0 && !names.includes(name)) names.push(name);
  }
  return names;
}

function decodePullRequest(input: unknown, created: boolean): PullRequest {
  if (!isRecord(input)) throw invalidResponse();
  const number = input['number'];
  const url = input['html_url'];
  const head = isRecord(input['head']) ? input['head']['sha'] : undefined;
  const base = isRecord(input['base']) ? input['base']['sha'] : undefined;
  const rawState = input['state'];
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0)
    throw invalidResponse();
  if (typeof url !== 'string' || !url.startsWith('https://')) throw invalidResponse();
  if (typeof head !== 'string' || head.length === 0) throw invalidResponse();
  if (typeof base !== 'string' || base.length === 0) throw invalidResponse();
  let state: PullRequest['state'];
  if (input['merged'] === true) {
    state = 'merged';
  } else if (rawState === 'open') {
    state = 'open';
  } else if (rawState === 'closed') {
    state = 'closed';
  } else {
    throw invalidResponse();
  }
  return {
    number,
    url,
    mergeable: input['mergeable'] === true,
    headSha: head,
    baseSha: base,
    state,
    draft: input['draft'] === true,
    labels: decodeLabels(input['labels']),
    created,
  };
}

function decodePullRequestList(input: unknown): readonly PullRequest[] {
  if (!Array.isArray(input)) throw invalidResponse();
  return input.map((entry) => decodePullRequest(entry, false));
}

interface RawCheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

function decodeCheckRuns(input: unknown): readonly RawCheckRun[] {
  if (!isRecord(input)) throw invalidResponse();
  const runs = input['check_runs'];
  if (!Array.isArray(runs)) throw invalidResponse();
  return runs.map((entry) => {
    if (!isRecord(entry)) throw invalidResponse();
    const name = entry['name'];
    const status = entry['status'];
    const conclusion = entry['conclusion'];
    if (typeof name !== 'string' || name.length === 0) throw invalidResponse();
    if (typeof status !== 'string') throw invalidResponse();
    if (conclusion !== null && typeof conclusion !== 'string') throw invalidResponse();
    return { name, status, conclusion };
  });
}

function normaliseConclusion(status: string, conclusion: string | null): CheckConclusion {
  if (status !== 'completed' || conclusion === null) return 'pending';
  if (
    conclusion === 'success' ||
    conclusion === 'failure' ||
    conclusion === 'neutral' ||
    conclusion === 'skipped' ||
    conclusion === 'cancelled'
  ) {
    return conclusion;
  }
  return 'failure';
}

function summarise(checks: readonly CheckRun[]): CheckSummary['state'] {
  const required = checks.filter((check) => check.required);
  if (
    required.some((check) => check.conclusion === 'failure' || check.conclusion === 'cancelled')
  ) {
    return 'failure';
  }
  if (required.some((check) => check.conclusion === 'pending')) return 'pending';
  return 'success';
}

function mergeLabels(existing: readonly string[], requested: readonly string[]): readonly string[] {
  const labels = [...existing];
  for (const label of requested) {
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

function asProviderError(cause: unknown): GitProviderError {
  if (cause instanceof GitProviderError) return cause;
  return new GitProviderError('provider_unavailable', 'github request failed', null, true);
}

class GitHubProvider implements GitProvider {
  private readonly options: GitHubProviderOptions;
  private readonly tokens: TokenSource;

  constructor(options: GitHubProviderOptions) {
    this.options = options;
    this.tokens = createTokenSource(options.auth, {
      apiBase: options.apiBase,
      fetch: options.fetch,
      now: options.now,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  async verifyRepo(slug: string): Promise<RepoVerify> {
    const repo = await this.getRepo(slug);
    return {
      ok: repo.canPush,
      defaultBranch: repo.defaultBranch,
      canPush: repo.canPush,
      checks: [
        { name: 'repo', state: 'ok' },
        { name: 'push', state: repo.canPush ? 'ok' : 'forbidden' },
      ],
    };
  }

  async getRepo(slug: string): Promise<RepoInfo> {
    const { owner, name } = parseSlug(slug);
    const response = await this.send('GET', `/repos/${owner}/${name}`);
    return decodeRepo(slug, this.payload(response));
  }

  async pushBranch(input: PushBranchInput): Promise<PushResult> {
    const { owner, name } = parseSlug(input.repo.slug);
    const branch = assertBranch(input.branch);
    const token = await this.token();
    const remote = `https://x-access-token:${token}@${this.options.gitHost}/${owner}/${name}.git`;
    const push = await this.options.git.run({
      args: ['-C', input.worktree, 'push', remote, `HEAD:refs/heads/${branch}`],
      cwd: input.worktree,
      timeoutMs: GIT_PUSH_TIMEOUT_MS,
      env: {},
    });
    if (push.code !== 0) {
      this.emit('warn', 'push failed', null);
      const rejected = /non-fast-forward|rejected/i.test(push.stderr);
      throw rejected
        ? new GitProviderError('conflict', 'git push was refused', null, false)
        : new GitProviderError('provider_unavailable', 'git push failed', null, true);
    }
    const head = await this.options.git.run({
      args: ['-C', input.worktree, 'rev-parse', 'HEAD'],
      cwd: input.worktree,
      timeoutMs: GIT_REV_PARSE_TIMEOUT_MS,
      env: {},
    });
    if (head.code !== 0) {
      throw new GitProviderError('provider_unavailable', 'git rev-parse failed', null, true);
    }
    const sha = head.stdout.trim();
    if (sha.length === 0) {
      throw new GitProviderError('provider_unavailable', 'git rev-parse failed', null, false);
    }
    return { branch, sha };
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequest> {
    const { owner, name } = parseSlug(input.repo.slug);
    const head = assertBranch(input.head);
    const base = assertBranch(input.base);
    const query = `head=${queryValue(`${owner}:${head}`)}&state=open&per_page=1`;
    const listed = await this.send('GET', `/repos/${owner}/${name}/pulls?${query}`);
    const open = decodePullRequestList(this.payload(listed));
    const existing = open[0];
    if (existing !== undefined) {
      const patched = await this.send('PATCH', `/repos/${owner}/${name}/pulls/${existing.number}`, {
        title: input.title,
        body: input.body,
      });
      const updated = decodePullRequest(this.payload(patched), false);
      await this.applyLabels(owner, name, updated.number, input.labels);
      this.emit('info', 'pull request updated', 200);
      return { ...updated, labels: mergeLabels(updated.labels, input.labels), created: false };
    }
    const created = await this.send('POST', `/repos/${owner}/${name}/pulls`, {
      title: input.title,
      head,
      base,
      body: input.body,
      draft: input.draft,
    });
    const pullRequest = decodePullRequest(this.payload(created), true);
    await this.applyLabels(owner, name, pullRequest.number, input.labels);
    this.emit('info', 'pull request opened', 201);
    return { ...pullRequest, labels: mergeLabels(pullRequest.labels, input.labels), created: true };
  }

  async getPullRequest(input: PullRequestRefInput): Promise<PullRequest> {
    const { owner, name } = parseSlug(input.repo.slug);
    const number = assertNumber(input.number);
    const response = await this.send('GET', `/repos/${owner}/${name}/pulls/${number}`);
    return decodePullRequest(this.payload(response), false);
  }

  async getChecks(input: ChecksInput): Promise<CheckSummary> {
    const { owner, name } = parseSlug(input.repo.slug);
    const baseRef = assertBranch(input.baseRef);
    const response = await this.send(
      'GET',
      `/repos/${owner}/${name}/commits/${encodeURIComponent(input.headSha)}/check-runs?filter=latest&per_page=100`,
    );
    const raw = decodeCheckRuns(this.payload(response));
    const required = await this.readRequiredContexts(owner, name, baseRef);
    const checks = raw.map((run) => ({
      name: run.name,
      conclusion: normaliseConclusion(run.status, run.conclusion),
      required: required === null ? true : required.includes(run.name),
    }));
    return { state: summarise(checks), checks };
  }

  async mergePullRequest(input: MergePullRequestInput): Promise<MergeResult> {
    const { owner, name } = parseSlug(input.repo.slug);
    const number = assertNumber(input.number);
    const response = await this.send('PUT', `/repos/${owner}/${name}/pulls/${number}/merge`, {
      merge_method: input.method,
      commit_title: input.commitTitle,
      commit_message: input.commitMessage,
      sha: input.sha,
    });
    const rejected = (reason: MergeReason, retryable: boolean): MergeResult => {
      this.emit('warn', 'merge rejected', response.status);
      return { merged: false, sha: null, method: input.method, reason, retryable };
    };
    if (response.status === 200) {
      if (!isRecord(response.data) || typeof response.data['merged'] !== 'boolean') {
        throw invalidResponse();
      }
      if (response.data['merged'] === true) {
        const sha = response.data['sha'];
        if (typeof sha !== 'string' || sha.length === 0) throw invalidResponse();
        return {
          merged: true,
          sha,
          method: input.method,
          reason: 'merged',
          retryable: false,
        };
      }
      return rejected('not_mergeable', true);
    }
    if (response.status === 405) return rejected('not_mergeable', true);
    if (response.status === 409) return rejected('head_moved', true);
    if (response.status === 422) return rejected('method_not_allowed', false);
    if (response.status === 403) return rejected('not_mergeable', false);
    throw this.fail(response);
  }

  async closePullRequest(input: PullRequestRefInput): Promise<void> {
    const { owner, name } = parseSlug(input.repo.slug);
    const number = assertNumber(input.number);
    const response = await this.send('PATCH', `/repos/${owner}/${name}/pulls/${number}`, {
      state: 'closed',
    });
    if (response.status === 404 || response.status === 422) return;
    this.payload(response);
  }

  async deleteBranch(input: DeleteBranchInput): Promise<void> {
    const { owner, name } = parseSlug(input.repo.slug);
    const branch = assertBranch(input.branch);
    const response = await this.send(
      'DELETE',
      `/repos/${owner}/${name}/git/refs/heads/${pathSegments(branch)}`,
    );
    if (response.status === 404 || response.status === 422) return;
    this.payload(response);
  }

  private async applyLabels(
    owner: string,
    name: string,
    number: number,
    labels: readonly string[],
  ): Promise<void> {
    if (labels.length === 0) return;
    const response = await this.send('POST', `/repos/${owner}/${name}/issues/${number}/labels`, {
      labels,
    });
    this.payload(response);
  }

  private async readRequiredContexts(
    owner: string,
    name: string,
    baseRef: string,
  ): Promise<readonly string[] | null> {
    const response = await this.send(
      'GET',
      `/repos/${owner}/${name}/branches/${pathSegments(baseRef)}/protection/required_status_checks`,
    );
    if (response.status < 200 || response.status >= 300) return null;
    if (!isRecord(response.data)) throw invalidResponse();
    const contexts = response.data['contexts'];
    if (!Array.isArray(contexts)) throw invalidResponse();
    const names = contexts.filter((entry): entry is string => typeof entry === 'string');
    return names.length > 0 ? names : null;
  }

  private async token(): Promise<string> {
    try {
      return await this.tokens.get();
    } catch (cause) {
      this.emit('warn', 'token mint failed', null);
      throw asProviderError(cause);
    }
  }

  private async send(method: HttpMethod, path: string, body?: unknown): Promise<GitHubResponse> {
    const token = await this.token();
    const response = await this.request(method, path, token, body);
    if (response.status !== 401) return response;
    if (!this.tokens.refreshable) throw this.fail(response);
    this.tokens.invalidate();
    const refreshed = await this.token();
    this.emit('info', 'token refreshed', 401);
    const retried = await this.request(method, path, refreshed, body);
    if (retried.status === 401) throw this.fail(retried);
    return retried;
  }

  private request(
    method: HttpMethod,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<GitHubResponse> {
    return requestGitHub({
      apiBase: this.options.apiBase,
      path,
      method,
      authorization: `Bearer ${token}`,
      userAgent: this.options.userAgent,
      fetch: this.options.fetch,
      requestTimeoutMs: this.options.requestTimeoutMs,
      ...(body === undefined ? {} : { body }),
    });
  }

  private payload(response: GitHubResponse): unknown {
    if (response.status >= 200 && response.status < 300) return response.data;
    throw this.fail(response);
  }

  private fail(response: GitHubResponse): GitProviderError {
    const error = providerErrorFor(response.status, response.headers);
    this.emit(
      'warn',
      error.code === 'rate_limited' ? 'github rate limited' : 'github request failed',
      response.status,
    );
    return error;
  }

  private emit(level: 'debug' | 'info' | 'warn', message: LogPhrase, status: number | null): void {
    this.options.log({ level, message, status });
  }
}

export function createGitHubProvider(options: GitHubProviderOptions): GitProvider {
  return new GitHubProvider(options);
}
