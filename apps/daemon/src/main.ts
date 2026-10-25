import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { openStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { ContractParseError } from '@codebox/contracts';
import type { CodeboxConfig } from '@codebox/contracts';
import { createApp } from './app.js';
import { reconcile } from './boot.js';
import {
  describeConfigFailure,
  ensureDirectories,
  loadConfig,
  parseBind,
  readBuildInfo,
  resolvePaths,
} from './config.js';
import { createLogger, formatLogLine } from './logger.js';
import type { LogFields } from './logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry, loadModules } from './modules.js';
import type { DaemonContext, ModuleLoadReport } from './modules.js';

export interface MainIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface RunMainOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly io?: MainIo;
  readonly signals?: boolean;
}

export interface StartOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly appDir?: string;
  readonly sink?: (line: string) => void;
}

export interface DaemonHandle {
  readonly port: number;
  readonly hostname: string;
  readonly context: DaemonContext;
  readonly report: ModuleLoadReport;
  stop(reason: string): Promise<void>;
}

type BootStage =
  | 'config_invalid'
  | 'state_dir_failed'
  | 'store_open_failed'
  | 'module_failed'
  | 'listen_failed'
  | 'boot_failed';

const DAEMON_FILE_TMP_SUFFIX = '.tmp';
const SHUTDOWN_TIMEOUT_MS = 5000;
const DEFAULT_IO: MainIo = {
  out: (line: string): void => {
    process.stdout.write(`${line}\n`);
  },
  err: (line: string): void => {
    process.stderr.write(`${line}\n`);
  },
};

class BootFailure extends Error {
  readonly stage: BootStage;
  readonly fields: LogFields;

  constructor(stage: BootStage, message: string, fields: LogFields = {}) {
    super(message);
    this.name = 'BootFailure';
    this.stage = stage;
    this.fields = fields;
  }
}

/** Config → store → reconcile → app → listen, in that order. */
export async function startDaemon(options: StartOptions = {}): Promise<DaemonHandle> {
  const env = options.env ?? process.env;
  const config = loadConfigOrFail(env);
  const logger = createLogger({
    level: config.CB_LOG_LEVEL,
    includeStack: config.CB_ENV !== 'production',
    base: { instance: config.CB_INSTANCE_NAME },
    ...(options.sink === undefined ? {} : { sink: options.sink }),
  });
  const paths = resolvePaths(config);
  try {
    ensureDirectories(paths);
  } catch (error) {
    throw new BootFailure('state_dir_failed', 'the state directory is not writable', {
      err: error,
    });
  }
  let store: Store;
  try {
    store = openStore({ path: paths.dbFile });
  } catch (error) {
    throw new BootFailure('store_open_failed', 'the store could not be opened', { err: error });
  }
  const clock = (): Date => new Date();
  const shutdown = createShutdownRegistry(logger);
  const build = readBuildInfo(config);
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build,
    paths,
    appDir: options.appDir ?? join(config.CB_INSTALL_DIR, 'app'),
    shutdown,
  };
  const app = createApp({ context });

  let report: ModuleLoadReport;
  try {
    report = await loadModules({ app, context });
  } catch (error) {
    await shutdown.run();
    store.close();
    throw new BootFailure('module_failed', 'the modules could not be loaded', { err: error });
  }
  if (report.failed.length > 0) {
    for (const failure of report.failed) {
      logger.error({ msg: 'module_failed', module: failure.name, error: failure.error });
    }
    await shutdown.run();
    store.close();
    throw new BootFailure('module_failed', 'one or more modules failed to load', {
      modules: report.failed.map((failure) => failure.name),
    });
  }

  try {
    reconcile({ store, logger, paths, clock });
  } catch (error) {
    await shutdown.run();
    store.close();
    throw new BootFailure('boot_failed', 'the boot reconciliation failed', { err: error });
  }

  const bind = parseBindOrFail(config.CB_BIND);
  const listening = await listen(app.fetch, bind.hostname, bind.port);
  const port = listening.port;
  try {
    writeDaemonFile(paths.daemonFile, {
      pid: process.pid,
      port,
      hostname: bind.hostname,
      version: build.version,
      startedAt: clock().toISOString(),
    });
  } catch (error) {
    listening.server.close();
    await shutdown.run();
    store.close();
    throw new BootFailure('state_dir_failed', 'the daemon file could not be written', {
      err: error,
    });
  }
  logger.info({ msg: 'listening', port, hostname: bind.hostname, version: build.version });

  let stopping: Promise<void> | null = null;
  return {
    port,
    hostname: bind.hostname,
    context,
    report,
    stop(reason: string): Promise<void> {
      if (stopping !== null) return stopping;
      stopping = shutdownDaemon(reason);
      return stopping;
    },
  };

  async function shutdownDaemon(reason: string): Promise<void> {
    logger.info({ msg: 'shutdown', reason });
    await shutdown.run();
    store.close();
    try {
      unlinkSync(paths.daemonFile);
    } catch (error) {
      if (!isMissingFile(error)) logger.warn({ msg: 'daemon_file_remove_failed', err: error });
    }
    await new Promise<void>((done) => {
      listening.server.close(() => done());
    });
  }
}

/** The whole process, except `process.exit`. Returns the exit code. */
export async function runMain(options: RunMainOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const io = options.io ?? DEFAULT_IO;
  const signals = options.signals ?? false;
  let handle: DaemonHandle;
  try {
    handle = await startDaemon({ env, sink: io.out });
  } catch (error) {
    io.err(fatalLine(error));
    return 1;
  }
  const reason = await waitForSignal(signals);
  return shutdownWithTimeout(handle, reason, io);
}

function loadConfigOrFail(env: NodeJS.ProcessEnv): CodeboxConfig {
  try {
    return loadConfig(env);
  } catch (error) {
    if (!(error instanceof ContractParseError)) {
      throw new BootFailure('boot_failed', 'the configuration could not be read', { err: error });
    }
    const failure = describeConfigFailure(error, env);
    const fields: LogFields = {
      missing: [...failure.missing],
      invalid: [...failure.invalid],
      messages: [...failure.messages],
    };
    throw new BootFailure('config_invalid', 'the configuration is invalid', fields);
  }
}

function parseBindOrFail(bind: string): { readonly hostname: string; readonly port: number } {
  try {
    return parseBind(bind);
  } catch (error) {
    throw new BootFailure('listen_failed', 'the bind address is invalid', { err: error });
  }
}

function listen(
  fetch: (request: Request) => Response | Promise<Response>,
  hostname: string,
  port: number,
): Promise<{ readonly server: ServerType; readonly port: number }> {
  return new Promise((done, fail) => {
    try {
      const server = serve({ fetch, port, hostname }, (info) => {
        done({ server, port: info.port });
      });
      server.on('error', (error: Error) => {
        fail(new BootFailure('listen_failed', 'the server could not listen', { err: error, port }));
      });
    } catch (error) {
      fail(new BootFailure('listen_failed', 'the server could not listen', { err: error, port }));
    }
  });
}

function writeDaemonFile(
  file: string,
  info: {
    readonly pid: number;
    readonly port: number;
    readonly hostname: string;
    readonly version: string;
    readonly startedAt: string;
  },
): void {
  const temporary = `${file}${DAEMON_FILE_TMP_SUFFIX}`;
  writeFileSync(temporary, `${JSON.stringify(info)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

function fatalLine(error: unknown): string {
  const fields: LogFields =
    error instanceof BootFailure
      ? { level: 'fatal', msg: error.stage, ...error.fields }
      : { level: 'fatal', msg: 'boot_failed', err: error };
  return formatLogLine(fields, new Date());
}

function waitForSignal(signals: boolean): Promise<string> {
  return new Promise((done) => {
    if (!signals) return;
    for (const name of ['SIGTERM', 'SIGINT'] as const) {
      process.once(name, () => done(name));
    }
  });
}

async function shutdownWithTimeout(
  handle: DaemonHandle,
  reason: string,
  io: MainIo,
): Promise<number> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(1);
    }, SHUTDOWN_TIMEOUT_MS);
  });
  const stopped = handle.stop(reason).then(
    () => 0,
    (error: unknown) => {
      io.err(formatLogLine({ level: 'fatal', msg: 'shutdown_failed', err: error }, new Date()));
      return 1;
    },
  );
  const code = await Promise.race([stopped, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (timedOut) handle.context.logger.error({ msg: 'shutdown_timeout' });
  return code;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  return fileURLToPath(import.meta.url) === resolve(script);
}

if (isEntryPoint()) {
  void runMain({ signals: true }).then((code) => {
    process.exitCode = code;
  });
}
