import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  idempotencyKeySchema,
  pageOfJob,
  pageOfRun,
  parseBrake,
  parseJob,
  parseRun,
  parseSettings,
} from '@codebox/contracts';
import type { Brake, Job, Page, Run, Settings } from '@codebox/contracts';
import { UsageError } from './args.js';
import { doctorChecks, doctorJson, formatDoctor, readHealth } from './doctor.js';
import { formatTable, jsonLine } from './output.js';
import { DEFAULT_BASE_URL, TransportError, apiErrorFrom, isSuccessStatus } from './transport.js';
import type { CliResponse, CliTransport } from './transport.js';

export interface CommandIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface CommandRunner {
  run(input: {
    readonly file: string;
    readonly args: readonly string[];
  }): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
}

export interface CommandContext {
  readonly transport: CliTransport;
  readonly io: CommandIo;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runner: CommandRunner;
  readonly now: () => Date;
  readonly baseUrl: string;
  readonly token: string | null;
  readonly json: boolean;
  readonly version: string;
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly positionals: readonly string[];
}

export const UPGRADE_SCRIPT = '/usr/local/lib/codebox/upgrade.sh';
export const BACKUP_SCRIPT = '/usr/local/lib/codebox/backup.sh';
export const PAIRING_TTL_MIN_SECONDS = 30;
export const PAIRING_TTL_MAX_SECONDS = 3600;
export const JOBS_LIMIT = 50;
export const RUNNING_RUNS_LIMIT = 5;
export const EVENTS_AFTER = 0;
export const EVENTS_LIMIT = 200;
export const JOB_COLUMNS: readonly string[] = Object.freeze([
  'id',
  'title',
  'cron',
  'timezone',
  'enabled',
  'nextFireAt',
]);

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

export function dispatchCommand(command: string, context: CommandContext): Promise<number> {
  switch (command) {
    case 'pair':
      return pairCommand(context);
    case 'status':
      return statusCommand(context);
    case 'doctor':
      return doctorCommand(context);
    case 'run':
      return runJobCommand(context);
    case 'jobs':
      return jobsCommand(context);
    case 'logs':
      return logsCommand(context);
    case 'events':
      return logsCommand(context);
    case 'brake':
      return brakeCommand(context);
    case 'update':
      return updateCommand(context);
    case 'backup':
      return backupCommand(context);
    case 'revert':
      return revertCommand(context);
    case 'help':
      return helpCommand(context);
    case 'version':
      return versionCommand(context);
    default:
      throw new UsageError(`unknown command: ${command}`, null);
  }
}

export function usageLines(): string[] {
  return [
    'usage: cb <command> [options]',
    '',
    'commands:',
    '  pair --name <name> [--ttl <seconds>]   mint a one-time pairing code',
    '  status                                 health, queue, running runs, brake',
    '  doctor [--json]                        one line per dependency',
    '  run <jobId>                            trigger a job now',
    '  jobs [--pause <id>] [--resume <id>]    list, pause or resume jobs',
    '  logs <runId>                           the events of one run',
    '  events <runId>                         the persisted timeline of one run',
    '  brake on|off|status                    the global auto-merge switch',
    '  update [--to <version>] [--rollback]   run upgrade.sh on the box',
    '  backup [--verify]                      run backup.sh on the box',
    '  revert <runId> [--job <jobId>]         open a revert run',
    '  help                                   this text',
    '  version                                the CLI version',
    '',
    'global options:',
    '  --json           machine output, where the command supports it',
    `  --url <url>      daemon base URL (default ${DEFAULT_BASE_URL})`,
    '  --token <token>  bearer token (default CODEBOX_TOKEN, then <state>/cli.token)',
    '  -h, --help       this text',
    '  --version        the CLI version',
  ];
}

export async function pairCommand(context: CommandContext): Promise<number> {
  const name = flagValue(context.flags, 'name');
  if (name === null) throw new UsageError('cb pair needs --name <name>', '--name');
  const ttlText = flagValue(context.flags, 'ttl');
  const ttl = ttlText === null ? null : parseTtl(ttlText);

  const body: Record<string, unknown> = { name };
  if (ttl !== null) body['ttlSeconds'] = ttl;
  const response = await context.transport.send({
    method: 'POST',
    path: '/v1/pair/code',
    body,
    token: null,
  });
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  const issued = readPairCode(response.body, 'POST /v1/pair/code');
  const deepLink = `codebox://pair?url=${context.baseUrl}&code=${issued.code}`;

  if (context.json) {
    context.io.out(jsonLine({ ...issued, deepLink }));
    return 0;
  }
  for (const line of formatTable([
    ['code', issued.code],
    ['expires', issued.expiresAt],
    ['link', deepLink],
  ])) {
    context.io.out(line);
  }
  return 0;
}

export async function statusCommand(context: CommandContext): Promise<number> {
  const health = await readHealth(context.transport, context.token);
  const runs = await readRunningRuns(context.transport, context.token);
  const settings = await readSettings(context.transport, context.token);

  if (context.json) {
    context.io.out(jsonLine({ health, runs, settings }));
    return 0;
  }

  const rows: string[][] = [
    ['status', health.status],
    ['version', health.version],
    [
      'queue',
      `${health.queue.running} running, ${health.queue.pending} pending, max ${health.queue.maxConcurrency}`,
    ],
    ['running', runs.length === 0 ? 'none' : runs.map((run) => run.id).join(', ')],
  ];
  if (settings !== null) rows.push(['brake', brakeWord(settings.automerge === false)]);
  for (const line of formatTable(rows)) context.io.out(line);
  return 0;
}

export async function doctorCommand(context: CommandContext): Promise<number> {
  const report = await doctorChecks(context.transport, {
    now: context.now,
    token: context.token,
  });
  if (context.json) {
    context.io.out(jsonLine(doctorJson(report)));
  } else {
    for (const line of formatDoctor(report)) context.io.out(line);
  }
  return report.ok ? 0 : 1;
}

export async function runJobCommand(context: CommandContext): Promise<number> {
  const jobId = positional(context, 0);
  const response = await context.transport.send({
    method: 'POST',
    path: `/v1/jobs/${encodeURIComponent(jobId)}/run`,
    token: context.token,
    idempotencyKey: newIdempotencyKey(),
  });
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  const run = readRun(response.body, `POST /v1/jobs/${jobId}/run`);
  if (context.json) {
    context.io.out(jsonLine(run));
    return 0;
  }
  for (const line of formatTable([
    ['run', run.id],
    ['state', run.state],
  ])) {
    context.io.out(line);
  }
  return 0;
}

export async function jobsCommand(context: CommandContext): Promise<number> {
  const pause = flagValue(context.flags, 'pause');
  const resume = flagValue(context.flags, 'resume');
  if (pause !== null && resume !== null) {
    throw new UsageError('--pause and --resume are exclusive', '--pause');
  }
  if (pause !== null) return toggleJob(context, pause, 'pause');
  if (resume !== null) return toggleJob(context, resume, 'resume');

  const response = await context.transport.send({
    method: 'GET',
    path: '/v1/jobs',
    query: { limit: JOBS_LIMIT },
    token: context.token,
  });
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  const page = readPage<Job>(pageOfJob, response, 'GET /v1/jobs');
  if (context.json) {
    context.io.out(jsonLine(page));
    return 0;
  }
  for (const line of formatTable(page.data.map(jobRow), JOB_COLUMNS)) context.io.out(line);
  return 0;
}

export async function logsCommand(context: CommandContext): Promise<number> {
  const runId = positional(context, 0);
  const response = await context.transport.send({
    method: 'GET',
    path: `/v1/runs/${encodeURIComponent(runId)}/events`,
    query: { after: EVENTS_AFTER, limit: EVENTS_LIMIT },
    token: context.token,
  });
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  if (context.json) {
    context.io.out(jsonLine(response.body));
    return 0;
  }
  for (const event of readEvents(response.body, runId)) {
    context.io.out(`${event.ts} ${event.type} ${event.data}`);
  }
  return 0;
}

export async function brakeCommand(context: CommandContext): Promise<number> {
  const action = positional(context, 0);
  if (action !== 'on' && action !== 'off' && action !== 'status') {
    throw new UsageError(`unknown brake action: ${action}`, null);
  }

  const response =
    action === 'status'
      ? await context.transport.send({ method: 'GET', path: '/v1/settings', token: context.token })
      : await context.transport.send({
          method: 'POST',
          path: '/v1/admin/brake',
          body: { enabled: action === 'on' },
          token: context.token,
        });
  if (response.status === 404) {
    context.io.err('unsupported');
    return 5;
  }
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);

  const enabled =
    action === 'status'
      ? readSettingsBody(response.body, 'GET /v1/settings').automerge === false
      : readBrake(response.body).enabled;
  if (context.json) {
    context.io.out(jsonLine({ enabled }));
    return 0;
  }
  context.io.out(`brake ${brakeWord(enabled)}`);
  return 0;
}

export async function updateCommand(context: CommandContext): Promise<number> {
  const to = flagValue(context.flags, 'to');
  const rollback = context.flags['rollback'] === true;
  if (to !== null && rollback) {
    throw new UsageError('--to and --rollback are exclusive', '--to');
  }
  if (to !== null && !VERSION_PATTERN.test(to)) {
    throw new UsageError(`invalid version: ${to}`, '--to');
  }
  const args = to === null ? (rollback ? ['--rollback'] : []) : ['--to', to];
  return runScript(context, UPGRADE_SCRIPT, args);
}

export async function backupCommand(context: CommandContext): Promise<number> {
  const verify = context.flags['verify'] === true;
  return runScript(context, BACKUP_SCRIPT, verify ? ['--verify'] : []);
}

export async function revertCommand(context: CommandContext): Promise<number> {
  const runId = positional(context, 0);
  const jobId = flagValue(context.flags, 'job');
  const response = await context.transport.send({
    method: 'POST',
    path: `/v1/runs/${encodeURIComponent(runId)}/revert`,
    body: jobId === null ? {} : { jobId },
    token: context.token,
    idempotencyKey: newIdempotencyKey(),
  });
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  const run = readRun(response.body, `POST /v1/runs/${runId}/revert`);
  if (context.json) {
    context.io.out(jsonLine(run));
    return 0;
  }
  context.io.out(`run  ${run.id}`);
  return 0;
}

export async function helpCommand(context: CommandContext): Promise<number> {
  for (const line of usageLines()) context.io.out(line);
  return 0;
}

export async function versionCommand(context: CommandContext): Promise<number> {
  context.io.out(`codebox ${context.version}`);
  return 0;
}

export function defaultCommandRunner(): CommandRunner {
  return {
    run(input) {
      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        const child = spawn(input.file, [...input.args], {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
          stdout += chunk;
        });
        child.stderr?.on('data', (chunk: string) => {
          stderr += chunk;
        });
        child.on('error', (error: Error) => {
          resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
        });
        child.on('close', (code: number | null) => {
          resolve({ code: code ?? 1, stdout, stderr });
        });
      });
    },
  };
}

async function toggleJob(
  context: CommandContext,
  jobId: string,
  action: 'pause' | 'resume',
): Promise<number> {
  const response = await context.transport.send({
    method: 'POST',
    path: `/v1/jobs/${encodeURIComponent(jobId)}/${action}`,
    token: context.token,
  });
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  const job = readJob(response.body, `POST /v1/jobs/${jobId}/${action}`);
  if (context.json) {
    context.io.out(jsonLine(job));
    return 0;
  }
  for (const line of formatTable([
    ['job', job.id],
    ['enabled', String(job.enabled)],
  ])) {
    context.io.out(line);
  }
  return 0;
}

async function runScript(
  context: CommandContext,
  file: string,
  args: readonly string[],
): Promise<number> {
  const result = await context.runner.run({ file, args });
  for (const line of splitLines(result.stdout)) context.io.out(line);
  for (const line of splitLines(result.stderr)) context.io.err(line);
  return result.code;
}

async function readRunningRuns(transport: CliTransport, token: string | null): Promise<Run[]> {
  const response = await transport.send({
    method: 'GET',
    path: '/v1/runs',
    query: { state: 'running', limit: RUNNING_RUNS_LIMIT },
    token,
  });
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  return readPage<Run>(pageOfRun, response, 'GET /v1/runs').data;
}

async function readSettings(
  transport: CliTransport,
  token: string | null,
): Promise<Settings | null> {
  const response = await transport.send({ method: 'GET', path: '/v1/settings', token });
  if (response.status === 404) return null;
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  return readSettingsBody(response.body, 'GET /v1/settings');
}

function readSettingsBody(body: unknown, what: string): Settings {
  try {
    return parseSettings(body);
  } catch {
    throw badResponse(what);
  }
}

function readBrake(body: unknown): Brake {
  try {
    return parseBrake(body);
  } catch {
    throw badResponse('POST /v1/admin/brake');
  }
}

function readJob(body: unknown, what: string): Job {
  try {
    return parseJob(body);
  } catch {
    throw badResponse(what);
  }
}

function readRun(body: unknown, what: string): Run {
  try {
    return parseRun(body);
  } catch {
    throw badResponse(what);
  }
}

function readPage<T>(
  schema: { safeParse(input: unknown): { success: true; data: Page<T> } | { success: false } },
  response: CliResponse,
  what: string,
): Page<T> {
  const parsed = schema.safeParse(response.body);
  if (!parsed.success) throw badResponse(what);
  return parsed.data;
}

interface PairCode {
  readonly code: string;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
  readonly name: string;
}

function readPairCode(body: unknown, what: string): PairCode {
  if (!isRecord(body)) throw badResponse(what);
  const code = body['code'];
  const expiresAt = body['expiresAt'];
  const name = body['name'];
  const scopes = body['scopes'];
  if (typeof code !== 'string' || code.length === 0) throw badResponse(what);
  if (typeof expiresAt !== 'string' || expiresAt.length === 0) throw badResponse(what);
  return {
    code,
    expiresAt,
    scopes: Array.isArray(scopes)
      ? scopes.filter((scope): scope is string => typeof scope === 'string')
      : [],
    name: typeof name === 'string' ? name : '',
  };
}

interface EventLine {
  readonly ts: string;
  readonly type: string;
  readonly data: string;
}

function readEvents(body: unknown, runId: string): EventLine[] {
  const what = `GET /v1/runs/${runId}/events`;
  const list = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body['data'])
      ? body['data']
      : null;
  if (list === null) throw badResponse(what);
  return list.map(renderEvent);
}

function renderEvent(entry: unknown): EventLine {
  if (!isRecord(entry)) return { ts: '-', type: 'unknown', data: jsonLine(entry) };
  const data = 'data' in entry ? entry['data'] : null;
  const type =
    typeof entry['type'] === 'string'
      ? entry['type']
      : typeof entry['event'] === 'string'
        ? entry['event']
        : 'unknown';
  const ts = typeof entry['ts'] === 'string' ? entry['ts'] : dataTimestamp(data);
  return { ts, type, data: jsonLine(data) };
}

function dataTimestamp(data: unknown): string {
  if (isRecord(data) && typeof data['ts'] === 'string') return data['ts'];
  return '-';
}

function jobRow(job: Job): string[] {
  return [job.id, job.title, job.cron, job.timezone, String(job.enabled), job.nextFireAt ?? '-'];
}

function positional(context: CommandContext, index: number): string {
  const value = context.positionals[index];
  if (value === undefined) throw new UsageError('missing argument', null);
  return value;
}

function flagValue(flags: Readonly<Record<string, string | boolean>>, name: string): string | null {
  const value = flags[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseTtl(text: string): number {
  const value = Number(text);
  if (
    !Number.isInteger(value) ||
    value < PAIRING_TTL_MIN_SECONDS ||
    value > PAIRING_TTL_MAX_SECONDS
  ) {
    throw new UsageError(
      `--ttl must be an integer between ${PAIRING_TTL_MIN_SECONDS} and ${PAIRING_TTL_MAX_SECONDS}`,
      '--ttl',
    );
  }
  return value;
}

function newIdempotencyKey(): string {
  const key = randomUUID();
  const parsed = idempotencyKeySchema.safeParse(key);
  return parsed.success ? parsed.data : key;
}

function brakeWord(enabled: boolean): string {
  return enabled ? 'on' : 'off';
}

function badResponse(what: string): TransportError {
  return new TransportError('bad_response', `${what} did not answer with the documented JSON`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
