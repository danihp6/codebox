export type WorkspaceErrorCode =
  | 'invalid_root'
  | 'clone_failed'
  | 'fetch_failed'
  | 'worktree_failed'
  | 'worktree_exists'
  | 'worktree_missing'
  | 'not_a_worktree'
  | 'git_failed'
  | 'disk_error';

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly command: string | null;
  readonly exitCode: number | null;

  constructor(
    code: WorkspaceErrorCode,
    message: string,
    command: string | null,
    exitCode: number | null,
  ) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    this.command = command;
    this.exitCode = exitCode;
  }
}

/** The message never carries git's stderr, an argument list or a URL: those can hold a token. */
export function gitFailure(
  command: string,
  exitCode: number,
  code: WorkspaceErrorCode,
): WorkspaceError {
  return new WorkspaceError(code, `${command} exited with code ${exitCode}`, command, exitCode);
}

export function gitStartFailure(command: string): WorkspaceError {
  return new WorkspaceError('git_failed', `${command} could not be started`, command, null);
}

export function diskFailure(action: string): WorkspaceError {
  return new WorkspaceError('disk_error', `disk operation failed: ${action}`, null, null);
}

export function errorCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
