import { AgentError } from './errors.js';

export interface ChildHandle {
  readonly pid: number;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
) => ChildHandle;

export interface PortState {
  readonly listening: boolean;
  readonly pid: number | null;
}

export type PortProbe = (hostname: string, port: number) => Promise<PortState>;

export type SupervisorState = 'stopped' | 'starting' | 'healthy' | 'restarting' | 'failed';

export interface SupervisorStatus {
  readonly state: SupervisorState;
  readonly pid: number | null;
  readonly spawned: boolean;
  readonly restarts: number;
  readonly lastError: string | null;
}

export interface SupervisorOptions {
  readonly bin: string;
  readonly hostname: string;
  readonly port: number;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly spawn: SpawnFn;
  readonly probePort: PortProbe;
  readonly probeHealth: () => Promise<boolean>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly maxRestarts: number;
  readonly restartWindowMs: number;
  readonly unhealthyAfter: number;
  readonly shutdownGraceMs: number;
}

export interface Supervisor {
  start(): Promise<SupervisorStatus>;
  tick(): Promise<SupervisorStatus>;
  stop(): Promise<void>;
  status(): SupervisorStatus;
  onStatus(listener: (status: SupervisorStatus) => void): () => void;
}

export function createSupervisor(options: SupervisorOptions): Supervisor {
  let state: SupervisorState = 'stopped';
  let pid: number | null = null;
  let spawned = false;
  let restarts = 0;
  let lastError: string | null = null;
  let current: ChildHandle | null = null;
  let restartTimes: number[] = [];
  let consecutiveFailures = 0;
  let restarting = false;
  let closing = false;
  let published: SupervisorState = 'stopped';
  const listeners = new Set<(status: SupervisorStatus) => void>();

  function status(): SupervisorStatus {
    return { state, pid, spawned, restarts, lastError };
  }

  function publish(): void {
    const snapshot = status();
    const changed = snapshot.state !== published;
    published = snapshot.state;
    if (!changed) return;
    for (const listener of listeners) listener(snapshot);
  }

  function transition(next: SupervisorState, error: string | null): void {
    state = next;
    lastError = error;
    publish();
  }

  function spawnChild(): boolean {
    if (closing) return false;
    try {
      const handle = options.spawn(
        options.bin,
        ['serve', '--hostname', options.hostname, '--port', String(options.port)],
        { cwd: options.cwd, env: options.env },
      );
      current = handle;
      spawned = true;
      pid = handle.pid;
      consecutiveFailures = 0;
      handle.onExit(() => {
        if (current !== handle) return;
        current = null;
        pid = null;
        if (closing) {
          transition('stopped', lastError);
          return;
        }
        void scheduleRestart();
      });
      transition('starting', null);
      return true;
    } catch {
      current = null;
      pid = null;
      transition('failed', 'agent_unavailable');
      return false;
    }
  }

  async function scheduleRestart(): Promise<void> {
    if (restarting || closing) return;
    restarting = true;
    try {
      const at = options.now();
      restartTimes = restartTimes.filter((time) => at - time < options.restartWindowMs);
      if (restartTimes.length >= options.maxRestarts) {
        transition('failed', 'agent_unavailable');
        return;
      }
      restartTimes.push(at);
      restarts += 1;
      transition('restarting', lastError);
      await options.sleep(Math.min(2 ** restarts * 1000, 30_000));
      if (closing) return;
      spawnChild();
    } finally {
      restarting = false;
    }
  }

  async function start(): Promise<SupervisorStatus> {
    if (state === 'healthy' || state === 'starting') return status();
    closing = false;
    restartTimes = [];
    consecutiveFailures = 0;

    const probe = await options.probePort(options.hostname, options.port);
    if (probe.listening) {
      const healthy = await options.probeHealth();
      if (!healthy) {
        pid = probe.pid;
        spawned = false;
        transition('failed', 'agent_unavailable');
        throw new AgentError(
          'agent_unavailable',
          `agent port ${options.hostname}:${options.port} is held by pid ${probe.pid ?? 'unknown'} and does not answer`,
          null,
          true,
        );
      }
      pid = probe.pid;
      spawned = false;
      transition('healthy', null);
      return status();
    }

    if (!spawnChild()) {
      throw new AgentError('agent_unavailable', 'agent server could not be started', null, true);
    }
    return status();
  }

  async function tick(): Promise<SupervisorStatus> {
    if (state === 'failed' || state === 'stopped' || state === 'restarting') return status();
    if (restarting) return status();

    const healthy = await options.probeHealth();
    if (healthy) {
      consecutiveFailures = 0;
      transition('healthy', null);
      return status();
    }

    consecutiveFailures += 1;
    if (consecutiveFailures < options.unhealthyAfter) return status();

    consecutiveFailures = 0;
    const handle = current;
    current = null;
    pid = null;
    if (handle !== null) handle.kill('SIGKILL');
    if (!spawned) {
      transition('failed', 'agent_unavailable');
      return status();
    }
    await scheduleRestart();
    return status();
  }

  async function stop(): Promise<void> {
    if (state === 'stopped') return;
    closing = true;
    const handle = current;
    current = null;
    if (handle !== null && spawned) {
      handle.kill('SIGTERM');
      await options.sleep(options.shutdownGraceMs);
      handle.kill('SIGKILL');
    }
    pid = null;
    transition('stopped', lastError);
  }

  return {
    start,
    tick,
    stop,
    status,
    onStatus(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
