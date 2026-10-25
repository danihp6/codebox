import type { RunDiff } from '@codebox/contracts';
import type { ProtectedPathHit } from '@codebox/core';

export interface RepoRef {
  readonly slug: string;
  readonly defaultBranch: string;
  /** https URL with the credential inside; never logged and never placed in an error. */
  readonly cloneUrl: string;
}

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

export interface GitRunner {
  run(input: GitCommandInput): Promise<GitResult>;
}

export type GlobMatcher = (pattern: string, path: string) => boolean;

export interface WorkspaceManagerOptions {
  readonly repoRoot: string;
  readonly workspaceRoot: string;
  readonly git: GitRunner;
  readonly matchesGlob: GlobMatcher;
  readonly cloneDepth: number;
  readonly httpTimeoutSeconds: number;
  readonly now: () => Date;
}

export interface CloneResult {
  readonly path: string;
  /** True only when this call cloned; false when an existing cache was fetched. */
  readonly created: boolean;
  readonly headSha: string;
}

export interface CreateWorktreeInput {
  readonly repo: RepoRef;
  readonly runId: string;
  readonly baseRef: string;
  readonly title: string;
}

export interface Worktree {
  readonly runId: string;
  readonly repoSlug: string;
  readonly path: string;
  readonly branch: string;
  readonly baseRef: string;
  /** The commit the branch was cut from; guardrail G4 compares it with the provider's base tip. */
  readonly baseSha: string;
}

export interface WorktreeInfo {
  readonly path: string;
  readonly runId: string | null;
  readonly repoSlug: string | null;
  readonly branch: string | null;
  readonly modifiedAt: string;
  readonly bytes: number;
}

export interface RunMarker {
  readonly runId: string;
  readonly repoSlug: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly baseSha: string;
  /** Empty when createWorktree writes the marker; the run engine overwrites it with the hash. */
  readonly promptHash: string;
  readonly createdAt: string;
}

export interface WorkspaceStatus {
  readonly branch: string;
  /** The recorded base, never re-resolved from the cache. */
  readonly baseSha: string;
  readonly headSha: string;
  readonly commitsAhead: number;
  readonly dirty: boolean;
  /** Exactly the runDiffSchema shape, so the gate can feed it to evaluateDiffBudget. */
  readonly diff: RunDiff;
  readonly changedPaths: readonly string[];
  readonly protectedHits: readonly ProtectedPathHit[];
}

export interface CleanupOptions {
  readonly ttlHours: number;
}

export interface CleanupReport {
  readonly removed: readonly string[];
  readonly kept: number;
  readonly orphans: number;
  readonly bytesFreed: number;
}

export interface DiskUsage {
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly usedPercent: number;
}

export interface WorkspaceManager {
  ensureClone(repo: RepoRef): Promise<CloneResult>;
  createWorktree(input: CreateWorktreeInput): Promise<Worktree>;
  removeWorktree(worktree: Worktree): Promise<void>;
  listWorktrees(): Promise<readonly WorktreeInfo[]>;
  status(worktree: Worktree, protectedPaths: readonly string[]): Promise<WorkspaceStatus>;
  readRunMarker(worktree: Worktree): Promise<RunMarker | null>;
  writeRunMarker(worktree: Worktree, marker: RunMarker): Promise<void>;
  cleanup(options: CleanupOptions): Promise<CleanupReport>;
  diskUsage(): Promise<DiskUsage>;
}
