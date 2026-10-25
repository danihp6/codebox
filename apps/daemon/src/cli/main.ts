import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs } from './args.js';
import { defaultCommandRunner, dispatchCommand, usageLines } from './commands.js';
import type { CommandContext, CommandRunner } from './commands.js';
import { createRedactingIo, formatApiError } from './output.js';
import type { CliWriter } from './output.js';
import {
  ApiResponseError,
  DEFAULT_BASE_URL,
  TransportError,
  createHttpTransport,
  exitCodeForStatus,
  normaliseBaseUrl,
} from './transport.js';
import type { CliTransport } from './transport.js';

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface CliOptions {
  readonly argv: readonly string[];
  readonly io?: CliIo;
  readonly env?: Record<string, string | undefined>;
  readonly transport?: CliTransport;
  readonly runner?: CommandRunner;
  readonly version?: string;
}

export const DEFAULT_STATE_DIR = '/var/lib/codebox';
export const TOKEN_FILE_NAME = 'cli.token';
export const TOKEN_MAX_BYTES = 4096;
export const NO_TOKEN_MESSAGE = 'no token: set CODEBOX_TOKEN or --token';

const AUTHENTICATED_COMMANDS: ReadonlySet<string> = new Set([
  'status',
  'doctor',
  'run',
  'jobs',
  'logs',
  'events',
  'brake',
  'revert',
]);

export async function run(options: CliOptions): Promise<number> {
  const raw = options.io ?? processIo();
  const env = options.env ?? process.env;
  let token: string | null = null;

  try {
    const parsed = parseArgs(options.argv);
    const baseUrl = normaliseBaseUrl(
      flagString(parsed.flags, 'url') ?? envString(env, 'CODEBOX_URL') ?? DEFAULT_BASE_URL,
    );
    token = resolveToken(parsed.flags, env);
    const io = createRedactingIo(raw, token);
    const version = options.version ?? readPackageVersion();

    const transport =
      options.transport ??
      createHttpTransport({
        baseUrl,
        fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
      });
    if (AUTHENTICATED_COMMANDS.has(parsed.command) && token === null) {
      io.err(NO_TOKEN_MESSAGE);
      return 4;
    }
    const context: CommandContext = {
      transport,
      io,
      env,
      runner: options.runner ?? defaultCommandRunner(),
      now: (): Date => new Date(),
      baseUrl,
      token,
      json: parsed.flags['json'] === true,
      version,
      flags: parsed.flags,
      positionals: parsed.positionals,
    };
    return await dispatchCommand(parsed.command, context);
  } catch (error) {
    return reportError(error, createRedactingIo(raw, token));
  }
}

export function readPackageVersion(): string {
  try {
    const path = fileURLToPath(new URL('../../package.json', import.meta.url));
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const version = (parsed as { readonly version?: unknown }).version;
      if (typeof version === 'string' && version.length > 0) return version;
    }
  } catch {
    return '0.0.0';
  }
  return '0.0.0';
}

function reportError(error: unknown, io: CliWriter): number {
  if (error instanceof UsageError) {
    io.err(`cb: ${error.message}`);
    for (const line of usageLines()) io.err(line);
    return 2;
  }
  if (error instanceof TransportError) {
    io.err(`${transportLabel(error.kind)}: ${error.message}`);
    return 3;
  }
  if (error instanceof ApiResponseError) {
    if (error.envelope !== null) io.err(formatApiError(error.envelope));
    else io.err(`request failed with status ${error.status}`);
    return exitCodeForStatus(error.status);
  }
  io.err(`cb: ${error instanceof Error ? error.message : String(error)}`);
  return 5;
}

function transportLabel(kind: TransportError['kind']): string {
  if (kind === 'timeout') return 'daemon timed out';
  if (kind === 'bad_response') return 'invalid daemon response';
  return 'daemon unreachable';
}

function resolveToken(
  flags: Readonly<Record<string, string | boolean>>,
  env: Record<string, string | undefined>,
): string | null {
  return flagString(flags, 'token') ?? envString(env, 'CODEBOX_TOKEN') ?? readTokenFile(env);
}

function readTokenFile(env: Record<string, string | undefined>): string | null {
  const stateDir = envString(env, 'CODEBOX_STATE_DIR') ?? DEFAULT_STATE_DIR;
  try {
    const buffer = readFileSync(join(stateDir, TOKEN_FILE_NAME));
    const text = buffer.subarray(0, TOKEN_MAX_BYTES).toString('utf8').trim();
    return text.length === 0 ? null : text;
  } catch {
    return null;
  }
}

function flagString(
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
): string | null {
  const value = flags[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function envString(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function processIo(): CliIo {
  return {
    out: (line: string): void => {
      process.stdout.write(`${line}\n`);
    },
    err: (line: string): void => {
      process.stderr.write(`${line}\n`);
    },
  };
}
