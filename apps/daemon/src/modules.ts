import type { Hono } from 'hono';
import type { CodeboxConfig } from '@codebox/contracts';
import type { Store } from '@codebox/store';
import type { BuildInfo, StatePaths } from './config.js';
import type { Logger } from './logger.js';

export interface AppVariables {
  requestId: string;
}

export type DaemonApp = Hono<{ Variables: AppVariables }>;

export type SubsystemName =
  | 'auth'
  | 'chat'
  | 'events'
  | 'run'
  | 'gate'
  | 'jobs'
  | 'runs'
  | 'push'
  | 'routines'
  | 'schedules'
  | 'credentials'
  | 'providers'
  | 'telemetry'
  | 'cli'
  | 'works'
  | 'backlog'
  | 'sessions';

export const SUBSYSTEMS: readonly SubsystemName[] = Object.freeze([
  'auth',
  'chat',
  'events',
  'run',
  'gate',
  'jobs',
  'runs',
  'push',
  'routines',
  'schedules',
  'credentials',
  'providers',
  'telemetry',
  'cli',
  'works',
  'backlog',
  'sessions',
]);

export type SubsystemFlags = Readonly<Record<SubsystemName, boolean>>;

export const DEFAULT_SUBSYSTEM_FLAGS: SubsystemFlags = Object.freeze({
  auth: true,
  chat: true,
  events: true,
  run: true,
  gate: true,
  jobs: true,
  runs: true,
  push: true,
  routines: true,
  schedules: true,
  credentials: true,
  providers: true,
  telemetry: true,
  cli: true,
  works: true,
  backlog: true,
  sessions: true,
});

export function subsystemPath(name: SubsystemName): string {
  return `./${name}/index.js`;
}

export type ShutdownHook = () => void | Promise<void>;

export interface ShutdownRegistry {
  register(name: string, hook: ShutdownHook): void;
  run(): Promise<readonly { readonly name: string; readonly error: string | null }[]>;
}

export interface DaemonContext {
  readonly config: CodeboxConfig;
  readonly store: Store;
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly flags: SubsystemFlags;
  readonly build: BuildInfo;
  readonly paths: StatePaths;
  readonly appDir: string;
  readonly shutdown: ShutdownRegistry;
}

export interface DaemonModule {
  readonly name: string;
  register(app: DaemonApp, context: DaemonContext): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

/** The export every subsystem directory must provide at `src/<name>/index.ts`. */
export interface ModuleFactory {
  createModule(context: DaemonContext): DaemonModule;
}

export interface ModuleLoadReport {
  readonly loaded: readonly SubsystemName[];
  readonly disabled: readonly SubsystemName[];
  readonly absent: readonly SubsystemName[];
  readonly failed: readonly { readonly name: SubsystemName; readonly error: string }[];
}

export interface LoadModulesOptions {
  readonly app: DaemonApp;
  readonly context: DaemonContext;
  readonly root?: URL;
  readonly importModule?: (specifier: string) => Promise<unknown>;
}

const MODULE_NOT_FOUND = 'ERR_MODULE_NOT_FOUND';
const MISSING_SPECIFIER = /^Cannot find (?:module|package) '([^']+)'/;

export function createShutdownRegistry(logger: Logger): ShutdownRegistry {
  const hooks: { readonly name: string; readonly hook: ShutdownHook }[] = [];
  return {
    register(name: string, hook: ShutdownHook): void {
      hooks.push({ name, hook });
    },
    async run(): Promise<readonly { readonly name: string; readonly error: string | null }[]> {
      const results: { readonly name: string; readonly error: string | null }[] = [];
      for (const entry of [...hooks].reverse()) {
        try {
          await entry.hook();
          results.push({ name: entry.name, error: null });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ name: entry.name, error: message });
          logger.error({ msg: 'shutdown_hook_failed', hook: entry.name, err: error });
        }
      }
      return results;
    },
  };
}

export async function loadModules(options: LoadModulesOptions): Promise<ModuleLoadReport> {
  const root = options.root ?? new URL('./', import.meta.url);
  const importModule = options.importModule ?? ((specifier: string) => import(specifier));
  const { app, context } = options;
  const loaded: SubsystemName[] = [];
  const disabled: SubsystemName[] = [];
  const absent: SubsystemName[] = [];
  const failed: { readonly name: SubsystemName; readonly error: string }[] = [];

  for (const name of SUBSYSTEMS) {
    if (!context.flags[name]) {
      disabled.push(name);
      continue;
    }
    const candidate = new URL(subsystemPath(name), root).href;
    let imported: unknown;
    try {
      imported = await importModule(candidate);
    } catch (error) {
      if (isMissingSubsystem(error, name)) {
        absent.push(name);
        context.logger.info({ msg: 'module_absent', module: name });
        continue;
      }
      failed.push({ name, error: errorMessage(error) });
      continue;
    }
    try {
      const factory = imported as Partial<ModuleFactory> | null | undefined;
      if (factory === null || factory === undefined || typeof factory.createModule !== 'function') {
        failed.push({ name, error: 'no createModule export' });
        continue;
      }
      const module = factory.createModule(context);
      await module.register(app, context);
      if (module.shutdown !== undefined) {
        const hook = module.shutdown.bind(module);
        context.shutdown.register(`module:${name}`, () => hook());
      }
      loaded.push(name);
    } catch (error) {
      failed.push({ name, error: errorMessage(error) });
    }
  }

  return { loaded, disabled, absent, failed };
}

export function isMissingSubsystem(error: unknown, name: SubsystemName): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== MODULE_NOT_FOUND || typeof candidate.message !== 'string') return false;
  if (candidate.message.includes(subsystemPath(name))) return true;
  const specifier = MISSING_SPECIFIER.exec(candidate.message)?.[1];
  if (specifier === undefined) return false;
  const normalised = specifier.replaceAll('\\', '/');
  return normalised.endsWith(`/${name}/index.js`) || normalised.endsWith(`/${name}/index.ts`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
