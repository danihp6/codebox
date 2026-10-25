export type MergeMethod = 'squash' | 'merge';
export type CheckConclusion =
  'success' | 'failure' | 'neutral' | 'skipped' | 'pending' | 'cancelled';

export interface RepoInfo {
  readonly slug: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly canPush: boolean;
}

export interface RepoVerify {
  readonly ok: boolean;
  readonly defaultBranch: string;
  readonly canPush: boolean;
  readonly checks: readonly { readonly name: string; readonly state: string }[];
}

export interface PullRequest {
  readonly number: number;
  readonly url: string;
  readonly mergeable: boolean;
  readonly headSha: string;
  readonly baseSha: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly draft: boolean;
  readonly labels: readonly string[];
  readonly created: boolean;
}

export interface OpenPullRequestInput {
  readonly repo: RepoInfo;
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
  readonly labels: readonly string[];
}

export interface CheckRun {
  readonly name: string;
  readonly conclusion: CheckConclusion;
  readonly required: boolean;
}

export interface CheckSummary {
  readonly state: 'success' | 'failure' | 'pending';
  readonly checks: readonly CheckRun[];
}

export interface ChecksInput {
  readonly repo: RepoInfo;
  readonly number: number;
  readonly headSha: string;
  readonly baseRef: string;
}

export interface MergePullRequestInput {
  readonly repo: RepoInfo;
  readonly number: number;
  readonly method: MergeMethod;
  readonly commitTitle: string;
  readonly commitMessage: string;
  readonly sha: string;
}

export type MergeReason =
  'merged' | 'not_mergeable' | 'head_moved' | 'method_not_allowed' | 'checks_red';

export interface MergeResult {
  readonly merged: boolean;
  readonly sha: string | null;
  readonly method: MergeMethod;
  readonly reason: MergeReason;
  readonly retryable: boolean;
}

export interface PushBranchInput {
  readonly repo: RepoInfo;
  readonly worktree: string;
  readonly branch: string;
}

export interface PushResult {
  readonly branch: string;
  readonly sha: string;
}

export interface PullRequestRefInput {
  readonly repo: RepoInfo;
  readonly number: number;
}

export interface DeleteBranchInput {
  readonly repo: RepoInfo;
  readonly branch: string;
}

export interface GitProvider {
  verifyRepo(slug: string): Promise<RepoVerify>;
  getRepo(slug: string): Promise<RepoInfo>;
  pushBranch(input: PushBranchInput): Promise<PushResult>;
  openPullRequest(input: OpenPullRequestInput): Promise<PullRequest>;
  getPullRequest(input: PullRequestRefInput): Promise<PullRequest>;
  getChecks(input: ChecksInput): Promise<CheckSummary>;
  mergePullRequest(input: MergePullRequestInput): Promise<MergeResult>;
  closePullRequest(input: PullRequestRefInput): Promise<void>;
  deleteBranch(input: DeleteBranchInput): Promise<void>;
}

export function toPullRequestRef(pullRequest: PullRequest): {
  readonly number: number;
  readonly url: string;
  readonly mergeable: boolean;
} {
  return {
    number: pullRequest.number,
    url: pullRequest.url,
    mergeable: pullRequest.mergeable,
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GitCommandInput {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitCommandRunner {
  run(input: GitCommandInput): Promise<GitResult>;
}

export interface ProviderLogEvent {
  readonly level: 'debug' | 'info' | 'warn';
  readonly message: string;
  readonly status: number | null;
}

export type LogSink = (event: ProviderLogEvent) => void;

export type ProviderAuth =
  | {
      readonly kind: 'app';
      readonly appId: string;
      readonly installationId: string;
      readonly privateKeyPem: string;
    }
  | { readonly kind: 'pat'; readonly token: string }
  | { readonly kind: 'none' };

export interface GitHubProviderOptions {
  readonly auth: ProviderAuth;
  readonly apiBase: string;
  readonly gitHost: string;
  readonly fetch: FetchLike;
  readonly git: GitCommandRunner;
  readonly now: () => number;
  readonly requestTimeoutMs: number;
  readonly log: LogSink;
  readonly userAgent: string;
}
