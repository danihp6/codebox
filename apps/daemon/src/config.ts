import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '@codebox/contracts';
import type { CodeboxConfig, ConfigInput } from '@codebox/contracts';
import type { ContractParseError } from '@codebox/contracts';

export interface BindAddress {
  readonly hostname: string;
  readonly port: number;
}

export interface StatePaths {
  readonly stateDir: string;
  readonly tmpDir: string;
  readonly dbFile: string;
  readonly locksDir: string;
  readonly daemonFile: string;
}

export interface BuildInfo {
  readonly version: string;
  readonly commit: string | null;
  readonly builtAt: string | null;
}

export interface ConfigFailure {
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
  readonly messages: readonly string[];
}

const DIRECTORY_MODE = 0o750;
const BUILD_INFO_FILE = new URL('../package.json', import.meta.url);
const FALLBACK_VERSION = '0.0.0';
const PORT_PATTERN = /^\d{1,5}$/;
const MAX_PORT = 65535;

/** Thin wrapper over `parseConfig` that turns a `ContractParseError` into a key list. */
export function loadConfig(input: ConfigInput): CodeboxConfig {
  return parseConfig(input);
}

/**
 * Never includes an issue message or a value: the key name plus one fixed phrase. A zod
 * message may echo the received value, and a secret value must never leave the process.
 */
export function describeConfigFailure(
  error: ContractParseError,
  input: ConfigInput,
): ConfigFailure {
  const missing = new Set<string>();
  const invalid = new Set<string>();
  const messages = new Set<string>();
  for (const issue of error.issues) {
    const key = issue.path.split('.')[1];
    if (key === undefined || key === '') continue;
    const value = input[key];
    if (value === undefined || value === '') {
      missing.add(key);
      messages.add(`${key} is required`);
      continue;
    }
    invalid.add(key);
    messages.add(
      issue.code === 'unrecognized_keys'
        ? `${key} is not a known configuration key`
        : `${key} is invalid`,
    );
  }
  return {
    missing: [...missing].sort(),
    invalid: [...invalid].sort(),
    messages: [...messages].sort(),
  };
}

/** "127.0.0.1:8787", "[::1]:8787", "127.0.0.1:0". Throws on an unparseable value. */
export function parseBind(bind: string): BindAddress {
  const index = bind.lastIndexOf(':');
  if (index === -1) throw new Error('invalid bind address: expected host:port');
  const rawHost = bind.slice(0, index);
  const rawPort = bind.slice(index + 1);
  const hostname =
    rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (hostname === '') throw new Error('invalid bind address: the host is empty');
  if (!PORT_PATTERN.test(rawPort)) throw new Error('invalid bind address: expected a numeric port');
  const port = Number(rawPort);
  if (port > MAX_PORT) throw new Error('invalid bind address: the port is out of range');
  return { hostname, port };
}

export function resolvePaths(config: CodeboxConfig): StatePaths {
  return {
    stateDir: config.CB_STATE_DIR,
    tmpDir: config.CB_TMP_DIR,
    dbFile: join(config.CB_STATE_DIR, 'state.db'),
    locksDir: join(config.CB_STATE_DIR, 'locks'),
    daemonFile: join(config.CB_STATE_DIR, 'daemon.json'),
  };
}

/** mkdir -p stateDir and locksDir with mode 0750. Idempotent. */
export function ensureDirectories(paths: StatePaths): void {
  mkdirSync(paths.stateDir, { recursive: true, mode: DIRECTORY_MODE });
  mkdirSync(paths.locksDir, { recursive: true, mode: DIRECTORY_MODE });
}

/** Reads `apps/daemon/package.json` relative to this module; "0.0.0" if unreadable. */
export function readBuildInfo(config: CodeboxConfig): BuildInfo {
  return {
    version: readPackageVersion(),
    commit: config.CB_COMMIT,
    builtAt: null,
  };
}

function readPackageVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(BUILD_INFO_FILE, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === 'string' && version !== '') return version;
    }
    return FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
