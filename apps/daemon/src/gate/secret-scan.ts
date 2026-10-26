import { scanPatchForSecrets } from '@codebox/security';
import type { SecretFinding } from '@codebox/security';
import { GIT_ENV } from '@codebox/workspaces';
import type { GitRunner } from '@codebox/workspaces';

export const MAX_SECRET_SCAN_BYTES = 4_194_304;

export type SecretScanFailureCode = 'git_failed';

export class SecretScanError extends Error {
  readonly code: SecretScanFailureCode;

  constructor(code: SecretScanFailureCode) {
    super(`secret scan failed: ${code}`);
    this.name = 'SecretScanError';
    this.code = code;
  }
}

export interface SecretScanOutcome {
  readonly findings: readonly SecretFinding[];
  readonly oversized: boolean;
}

export interface SecretScanInput {
  readonly cwd: string;
  readonly baseSha: string;
  readonly timeoutMs: number;
}

/**
 * The run's own diff against its base, and nothing else: a secret already on the base branch is
 * not this run's to fix. A diff that cannot be read fails closed.
 */
export async function scanWorktree(
  git: GitRunner,
  input: SecretScanInput,
): Promise<SecretScanOutcome> {
  const result = await git.run({
    args: ['diff', '--no-color', '--unified=0', '--no-ext-diff', input.baseSha, '--'],
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    env: GIT_ENV,
  });
  if (result.code !== 0) throw new SecretScanError('git_failed');
  if (Buffer.byteLength(result.stdout, 'utf8') > MAX_SECRET_SCAN_BYTES) {
    return { findings: [], oversized: true };
  }
  return { findings: scanPatchForSecrets(result.stdout), oversized: false };
}
