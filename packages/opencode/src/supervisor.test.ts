import { describe, expect, it } from 'vitest';
import { AgentError } from './errors.js';
import type { ChildHandle, PortState, Supervisor, SupervisorState } from './supervisor.js';
import { createSupervisor } from './supervisor.js';

const HOSTNAME = '127.0.0.1';
const PORT = 4096;

interface TestChild {
  readonly handle: ChildHandle;
  readonly kills: string[];
  exit(code: number | null, signal: string | null): void;
}

function testChild(pid: number): TestChild {
  let listener: ((code: number | null, signal: string | null) => void) | null = null;
  const kills: string[] = [];
  return {
    kills,
    handle: {
      pid,
      onExit(next) {
        listener = next;
      },
      kill(signal) {
        kills.push(signal);
      },
    },
    exit(code, signal) {
      listener?.(code, signal);
    },
  };
}

interface Harness {
  readonly supervisor: Supervisor;
  readonly spawned: TestChild[];
  readonly sleeps: number[];
  readonly state: {
    health: boolean;
    port: PortState;
    clock: number;
    healthCalls: number;
  };
}

function harness(): Harness {
  const spawned: TestChild[] = [];
  const sleeps: number[] = [];
  const state = {
    health: true,
    port: { listening: false, pid: null } as PortState,
    clock: 0,
    healthCalls: 0,
  };
  let nextPid = 1000;
  const supervisor = createSupervisor({
    bin: 'opencode',
    hostname: HOSTNAME,
    port: PORT,
    cwd: '/tmp/cb-state',
    env: { PATH: '/usr/bin', CB_MODEL_PROVIDER_KEYS: 'ANTHROPIC_API_KEY' },
    spawn: () => {
      const child = testChild(nextPid);
      nextPid += 1;
      spawned.push(child);
      return child.handle;
    },
    probePort: async () => state.port,
    probeHealth: async () => {
      state.healthCalls += 1;
      return state.health;
    },
    now: () => state.clock,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    maxRestarts: 5,
    restartWindowMs: 600_000,
    unhealthyAfter: 3,
    shutdownGraceMs: 10_000,
  });
  return { supervisor, spawned, sleeps, state };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('supervisor', () => {
  it('spawns once and reports starting', async () => {
    const { supervisor, spawned } = harness();
    const status = await supervisor.start();
    expect(spawned).toHaveLength(1);
    expect(status).toMatchObject({ state: 'starting', spawned: true, pid: 1000, restarts: 0 });
  });

  it('flips to healthy on the first successful tick', async () => {
    const { supervisor } = harness();
    await supervisor.start();
    expect((await supervisor.tick()).state).toBe('healthy');
    expect(supervisor.status().state).toBe('healthy');
  });

  it('supervisor restarts a dead child', async () => {
    const { supervisor, spawned, sleeps } = harness();
    await supervisor.start();
    await supervisor.tick();

    spawned[0]?.exit(1, null);
    await waitFor(() => spawned.length === 2, 'the restart');

    expect(spawned).toHaveLength(2);
    expect(sleeps).toEqual([2_000]);
    expect(supervisor.status()).toMatchObject({ state: 'starting', restarts: 1, pid: 1001 });
  });

  it('supervisor doubles the backoff up to the thirty-second ceiling', async () => {
    const { supervisor, spawned, sleeps } = harness();
    await supervisor.start();
    for (let restart = 0; restart < 5; restart += 1) {
      spawned.at(-1)?.exit(1, null);
      await waitFor(() => spawned.length === restart + 2, `restart ${restart + 1}`);
    }
    expect(sleeps).toEqual([2_000, 4_000, 8_000, 16_000, 30_000]);
  });

  it('supervisor fails after the sixth restart inside the window', async () => {
    const { supervisor, spawned } = harness();
    await supervisor.start();
    for (let restart = 0; restart < 5; restart += 1) {
      spawned.at(-1)?.exit(1, null);
      await waitFor(() => spawned.length === restart + 2, `restart ${restart + 1}`);
    }
    expect(spawned).toHaveLength(6);

    spawned.at(-1)?.exit(1, null);
    await waitFor(() => supervisor.status().state === 'failed', 'the failed state');

    expect(supervisor.status()).toMatchObject({
      state: 'failed',
      lastError: 'agent_unavailable',
      restarts: 5,
    });
    expect(spawned).toHaveLength(6);
  });

  it('supervisor ignores every tick after it failed', async () => {
    const { supervisor, spawned, state } = harness();
    await supervisor.start();
    for (let restart = 0; restart < 5; restart += 1) {
      spawned.at(-1)?.exit(1, null);
      await waitFor(() => spawned.length === restart + 2, `restart ${restart + 1}`);
    }
    spawned.at(-1)?.exit(1, null);
    await waitFor(() => supervisor.status().state === 'failed', 'the failed state');

    const calls = state.healthCalls;
    expect((await supervisor.tick()).state).toBe('failed');
    expect(state.healthCalls).toBe(calls);
  });

  it('supervisor adopts an already-running healthy server without spawning', async () => {
    const { supervisor, spawned, state } = harness();
    state.port = { listening: true, pid: 4242 };
    const status = await supervisor.start();
    expect(spawned).toHaveLength(0);
    expect(status).toMatchObject({ state: 'healthy', spawned: false, pid: 4242 });
    expect((await supervisor.tick()).state).toBe('healthy');
    expect(spawned).toHaveLength(0);
  });

  it('supervisor refuses an unhealthy listener and names the host, the port and the pid', async () => {
    const { supervisor, spawned, state } = harness();
    state.port = { listening: true, pid: 4242 };
    state.health = false;

    let caught: unknown;
    try {
      await supervisor.start();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentError);
    const error = caught as AgentError;
    expect(error.code).toBe('agent_unavailable');
    expect(error.message).toContain(`${HOSTNAME}:${PORT}`);
    expect(error.message).toContain('4242');
    expect(spawned).toHaveLength(0);
    expect(supervisor.status().state).toBe('failed');
  });

  it('supervisor kills and restarts a child that stays unhealthy', async () => {
    const { supervisor, spawned, state } = harness();
    await supervisor.start();
    await supervisor.tick();
    state.health = false;

    await supervisor.tick();
    await supervisor.tick();
    expect(spawned[0]?.kills).toEqual([]);
    expect(spawned).toHaveLength(1);

    await supervisor.tick();
    await waitFor(() => spawned.length === 2, 'the restart after unhealthy probes');
    expect(spawned[0]?.kills).toEqual(['SIGKILL']);
  });

  it('supervisor resets the failure counter after a successful probe', async () => {
    const { supervisor, spawned, state } = harness();
    await supervisor.start();
    await supervisor.tick();

    state.health = false;
    await supervisor.tick();
    await supervisor.tick();
    state.health = true;
    await supervisor.tick();
    state.health = false;
    await supervisor.tick();
    await supervisor.tick();

    expect(spawned[0]?.kills).toEqual([]);
    expect(spawned).toHaveLength(1);

    await supervisor.tick();
    await waitFor(() => spawned.length === 2, 'the restart');
  });

  it('supervisor stops a child with SIGTERM, the grace sleep and SIGKILL', async () => {
    const { supervisor, spawned, sleeps } = harness();
    await supervisor.start();
    await supervisor.tick();

    await supervisor.stop();

    expect(spawned[0]?.kills).toEqual(['SIGTERM', 'SIGKILL']);
    expect(sleeps).toEqual([10_000]);
    expect(supervisor.status()).toMatchObject({ state: 'stopped', pid: null });
  });

  it('supervisor never kills the pid of an adopted server on stop', async () => {
    const { supervisor, spawned, state } = harness();
    state.port = { listening: true, pid: 4242 };
    await supervisor.start();
    await supervisor.stop();
    expect(spawned).toHaveLength(0);
    expect(supervisor.status()).toMatchObject({ state: 'stopped', pid: null });
  });

  it('supervisor reports stopped exactly once', async () => {
    const { supervisor } = harness();
    const seen: SupervisorState[] = [];
    supervisor.onStatus((status) => seen.push(status.state));
    await supervisor.start();
    await supervisor.stop();
    await supervisor.stop();
    expect(seen.filter((state) => state === 'stopped')).toHaveLength(1);
  });

  it('supervisor onStatus fires on every change and unsubscribes', async () => {
    const { supervisor } = harness();
    const seen: SupervisorState[] = [];
    const unsubscribe = supervisor.onStatus((status) => seen.push(status.state));

    await supervisor.start();
    await supervisor.tick();
    await supervisor.stop();
    expect(seen).toEqual(['starting', 'healthy', 'stopped']);

    unsubscribe();
    await supervisor.start();
    expect(seen).toEqual(['starting', 'healthy', 'stopped']);
  });
});
