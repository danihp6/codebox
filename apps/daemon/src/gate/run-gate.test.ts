import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GateExecution } from './run-gate.js';
import {
  GATE_CANCELLED_EXIT_CODE,
  GATE_SPAWN_FAILURE_EXIT_CODE,
  GATE_TAIL_LINES,
  GATE_TIMEOUT_EXIT_CODE,
  gateChildEnv,
  runGate,
} from './run-gate.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cb-14-gate-'));
  roots.push(directory);
  return directory;
}

function execution(overrides: Partial<GateExecution> = {}): GateExecution {
  const base = root();
  return {
    cwd: base,
    command: 'true',
    shell: '/bin/bash',
    timeoutMs: 10_000,
    runId: 'run_gate0001',
    logFile: join(base, 'logs', 'run-run_gate0001', 'gate.log'),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function processesMentioning(marker: string): readonly number[] {
  const pids: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    for (const file of ['cmdline', 'environ']) {
      try {
        const raw = readFileSync(`/proc/${entry}/${file}`, 'utf8');
        if (raw.includes(marker)) {
          pids.push(Number(entry));
          break;
        }
      } catch {
        break;
      }
    }
  }
  return pids;
}

describe('runGate', () => {
  it('passes a clean exit and writes the log file', async () => {
    const input = execution({ command: 'echo gate output' });
    const result = await runGate(input);
    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.tail).toEqual(['gate output']);
    expect(result.logFile).toBe(input.logFile);
    expect(readFileSync(input.logFile, 'utf8')).toBe('gate output\n');
    expect(statSync(dirname(input.logFile)).mode & 0o777).toBe(0o750);
  });

  it('fails with the exit code the child chose and keeps both streams in the log', async () => {
    const input = execution({ command: 'echo to-stdout; echo to-stderr >&2; exit 3' });
    const result = await runGate(input);
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.tail).toEqual(['to-stdout', 'to-stderr']);
    const log = readFileSync(input.logFile, 'utf8');
    expect(log).toContain('to-stdout');
    expect(log).toContain('to-stderr');
  });

  it('keeps the last hundred lines in memory and the whole output on disk', async () => {
    const input = execution({
      command: 'for i in $(seq 1 150); do echo line$i; done',
    });
    const result = await runGate(input);
    expect(result.status).toBe('passed');
    expect(result.tail).toHaveLength(GATE_TAIL_LINES);
    expect(result.tail[0]).toBe('line51');
    expect(result.tail.at(-1)).toBe('line150');
    const log = readFileSync(input.logFile, 'utf8').trimEnd().split('\n');
    expect(log).toHaveLength(150);
  });

  it('truncates a single long retained line to two thousand characters', async () => {
    const input = execution({
      command: "node -e \"process.stdout.write('x'.repeat(2500) + '\\n')\"",
    });
    const result = await runGate(input);
    expect(result.tail).toHaveLength(1);
    expect(result.tail[0]).toHaveLength(2_000);
  });

  it('times out with 124 and leaves no child process behind', async () => {
    const runId = 'run_gate_timeout01';
    const input = execution({ command: 'sleep 10', timeoutMs: 100, runId });
    const startedAt = Date.now();
    const result = await runGate(input);
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(GATE_TIMEOUT_EXIT_CODE);
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    await waitFor(() => processesMentioning(runId).length === 0, 'the gate process group to die');
  });

  it('cancels with 130 when the signal aborts', async () => {
    const controller = new AbortController();
    const input = execution({ command: 'sleep 10', signal: controller.signal });
    const running = runGate(input);
    setTimeout(() => controller.abort(), 100);
    const result = await running;
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(GATE_CANCELLED_EXIT_CODE);
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it('never rejects and reports 127 when the shell cannot start', async () => {
    const input = execution({ shell: '/nonexistent/cb-shell' });
    const result = await runGate(input);
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(GATE_SPAWN_FAILURE_EXIT_CODE);
    expect(result.tail).toHaveLength(1);
    expect(result.tail[0]).toContain('/nonexistent/cb-shell');
  });

  it('reports 127 when spawn itself throws', async () => {
    const result = await runGate(execution(), {
      spawn: () => {
        throw new Error('spawn failed hard');
      },
    });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(GATE_SPAWN_FAILURE_EXIT_CODE);
    expect(result.tail).toEqual(['spawn failed hard']);
  });

  it('gives the child the allowlist and nothing else of the daemon environment', async () => {
    const inherited = {
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env['HOME'] ?? '/tmp',
      TMPDIR: '/tmp',
      CB_GITHUB_TOKEN: 'ghp_fixture_secret',
      CB_OPENCODE_TOKEN: 'opencode_fixture_secret',
      GITHUB_TOKEN: 'gha_fixture_secret',
      OPENCODE_TOKEN: 'fixture_secret',
      AWS_SECRET_ACCESS_KEY: 'aws_fixture_secret',
      OCI_CLI_AUTH: 'oci_fixture_secret',
    };
    const input = execution({ command: 'env', runId: 'run_gate_env01' });
    const result = await runGate(input, { inheritedEnv: inherited });
    expect(result.status).toBe('passed');
    const printed = result.tail.join('\n');
    expect(printed).toContain('CI=1');
    expect(printed).toContain('NO_COLOR=1');
    expect(printed).toContain('CB_RUN_ID=run_gate_env01');
    for (const secret of ['CB_GITHUB_TOKEN', 'ghp_fixture_secret', 'OPENCODE_TOKEN']) {
      expect(printed).not.toContain(secret);
    }
    for (const secret of [
      'CB_OPENCODE_TOKEN',
      'GITHUB_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'OCI_CLI_AUTH',
    ]) {
      expect(printed).not.toContain(secret);
    }
  });
});

describe('gateChildEnv', () => {
  it('keeps only the three inherited keys plus the allowlist', () => {
    const env = gateChildEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/runner',
        TMPDIR: '/tmp',
        LANG: 'en_GB.UTF-8',
        CB_GITHUB_TOKEN: 'ghp_fixture_secret',
        GITHUB_ACTIONS: 'true',
      },
      'run_child0001',
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/runner',
      TMPDIR: '/tmp',
      CI: '1',
      NO_COLOR: '1',
      CB_RUN_ID: 'run_child0001',
    });
  });

  it('drops an inherited key whose value is empty', () => {
    const env = gateChildEnv({ PATH: '/usr/bin', TMPDIR: '' }, 'run_child0002');
    expect(env).not.toHaveProperty('TMPDIR');
  });
});

describe('runGate cwd', () => {
  it('runs the command in the worktree it was given', async () => {
    const cwd = root();
    mkdirSync(join(cwd, 'marker'), { recursive: true });
    const result = await runGate(execution({ cwd, command: 'pwd' }));
    expect(result.tail[0]).toBe(cwd);
    expect(existsSync(join(cwd, 'marker'))).toBe(true);
  });
});
