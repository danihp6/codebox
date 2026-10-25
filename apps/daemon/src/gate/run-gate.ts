import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface GateExecution {
  readonly cwd: string;
  readonly command: string;
  readonly shell: string;
  readonly timeoutMs: number;
  readonly runId: string;
  readonly logFile: string;
  readonly signal?: AbortSignal;
}

export interface GateExecutionResult {
  readonly status: 'passed' | 'failed';
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly tail: readonly string[];
  readonly logFile: string;
}

export interface GateDeps {
  readonly spawn?: typeof nodeSpawn;
  readonly inheritedEnv?: Readonly<Record<string, string | undefined>>;
}

export const GATE_TAIL_LINES = 100;
export const GATE_TAIL_LINE_CHARS = 2_000;
export const GATE_KILL_GRACE_MS = 2_000;
export const GATE_TIMEOUT_EXIT_CODE = 124;
export const GATE_CANCELLED_EXIT_CODE = 130;
export const GATE_SPAWN_FAILURE_EXIT_CODE = 127;

const DIRECTORY_MODE = 0o750;
const INHERITED_KEYS: readonly string[] = Object.freeze(['PATH', 'HOME', 'TMPDIR']);
const ALLOWED_KEYS: Readonly<Record<string, string>> = Object.freeze({
  CI: '1',
  NO_COLOR: '1',
});

class LineTail {
  private readonly lines: string[] = [];
  private partial = '';

  push(text: string): void {
    const combined = this.partial + text.replaceAll('\r\n', '\n');
    const parts = combined.split('\n');
    this.partial = parts.pop() ?? '';
    for (const part of parts) this.keep(part);
  }

  finish(): void {
    if (this.partial === '') return;
    this.keep(this.partial);
    this.partial = '';
  }

  value(): readonly string[] {
    return [...this.lines];
  }

  private keep(line: string): void {
    const trimmed = line.length > GATE_TAIL_LINE_CHARS ? line.slice(0, GATE_TAIL_LINE_CHARS) : line;
    this.lines.push(trimmed);
    if (this.lines.length > GATE_TAIL_LINES) this.lines.shift();
  }
}

/** The gate child sees the allowlist below and nothing else of the daemon's environment. */
export function gateChildEnv(
  inherited: Readonly<Record<string, string | undefined>>,
  runId: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_KEYS) {
    const value = inherited[key];
    if (value !== undefined && value !== '') env[key] = value;
  }
  for (const [key, value] of Object.entries(ALLOWED_KEYS)) env[key] = value;
  env['CB_RUN_ID'] = runId;
  return env;
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    // `detached: true` made the child its own process-group leader, so the group id is its pid.
    process.kill(-pid, signal);
  } catch {
    // Already gone: the close handler is the only authority on the outcome.
  }
}

export function runGate(input: GateExecution, deps: GateDeps = {}): Promise<GateExecutionResult> {
  const spawn = deps.spawn ?? nodeSpawn;
  const inherited = deps.inheritedEnv ?? process.env;
  const startedAt = Date.now();
  const tail = new LineTail();

  return new Promise<GateExecutionResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let graceTimer: NodeJS.Timeout | null = null;
    let child: ChildProcess | null = null;

    try {
      mkdirSync(dirname(input.logFile), { recursive: true, mode: DIRECTORY_MODE });
    } catch {
      // A gate without a log file still decides the run; the tail stays with the result.
    }

    function append(text: string): void {
      if (text === '') return;
      tail.push(text);
      try {
        appendFileSync(input.logFile, text, 'utf8');
      } catch {
        // The log is evidence, not the decision: an unwritable log never changes the verdict.
      }
    }

    function clearTimers(): void {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      if (graceTimer !== null) clearTimeout(graceTimer);
      timeoutTimer = null;
      graceTimer = null;
    }

    function settle(exitCode: number): void {
      if (settled) return;
      settled = true;
      clearTimers();
      input.signal?.removeEventListener('abort', onAbort);
      tail.finish();
      const effective = cancelled
        ? GATE_CANCELLED_EXIT_CODE
        : timedOut
          ? GATE_TIMEOUT_EXIT_CODE
          : exitCode;
      resolve({
        status: !cancelled && !timedOut && effective === 0 ? 'passed' : 'failed',
        exitCode: effective,
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut,
        cancelled,
        tail: tail.value(),
        logFile: input.logFile,
      });
    }

    function terminate(): void {
      const pid = child?.pid;
      killGroup(pid, 'SIGTERM');
      graceTimer = setTimeout(() => {
        killGroup(pid, 'SIGKILL');
      }, GATE_KILL_GRACE_MS);
    }

    function onAbort(): void {
      if (cancelled || settled) return;
      cancelled = true;
      terminate();
    }

    try {
      child = spawn(input.shell, ['-lc', input.command], {
        cwd: input.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: gateChildEnv(inherited, input.runId),
      });
    } catch (error) {
      append(`${error instanceof Error ? error.message : String(error)}\n`);
      settle(GATE_SPAWN_FAILURE_EXIT_CODE);
      return;
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      append(chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      append(chunk);
    });

    child.once('error', (error: Error) => {
      if (settled) return;
      append(`${error.message}\n`);
      settle(GATE_SPAWN_FAILURE_EXIT_CODE);
    });

    child.once('close', (code: number | null) => {
      settle(code ?? 1);
    });

    if (input.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (settled || timedOut || cancelled) return;
        timedOut = true;
        terminate();
      }, input.timeoutMs);
    }

    if (input.signal !== undefined) {
      input.signal.addEventListener('abort', onAbort, { once: true });
      if (input.signal.aborted) onAbort();
    }
  });
}
