import { z } from 'zod';
import { parseOrThrowRedacted } from './parse.js';
import type { ParseIssue } from './parse.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface CodeboxConfig {
  CB_ENV: 'production' | 'staging' | 'development' | 'test';
  CB_BIND: string;
  CB_PUBLIC_URL: string | null;
  CB_LOG_LEVEL: LogLevel;
  CB_TIMEZONE: string;
  CB_INSTANCE_NAME: string;
  CB_COMMIT: string | null;
  CB_STATE_DIR: string;
  CB_REPO_ROOT: string;
  CB_WORKSPACE_ROOT: string;
  CB_INSTALL_DIR: string;
  CB_TMP_DIR: string;
  CB_SESSION_SECRET: string;
  CB_SECRETS_KEY: string | null;
  CB_PAIRING_TTL_SECONDS: number;
  CB_ACCESS_TOKEN_TTL_SECONDS: number;
  CB_REFRESH_TOKEN_TTL_DAYS: number;
  CB_OWNER_EMAIL: string | null;
  CB_ALLOWED_ORIGINS: string[];
  CB_ACCESS_TEAM_DOMAIN: string | null;
  CB_ACCESS_AUD: string | null;
  CB_OPENCODE_URL: string;
  CB_OPENCODE_BIN: string;
  CB_OPENCODE_HOSTNAME: string;
  CB_OPENCODE_PORT: number;
  CB_OPENCODE_TOKEN: string | null;
  CB_OPENCODE_AUTO: boolean;
  CB_DEFAULT_AGENT: string;
  CB_DEFAULT_MODEL: string | null;
  CB_MODEL_PROVIDER_KEYS: string[];
  CB_OPENCODE_HEALTH_PATH: string;
  CB_GIT_PROVIDER: 'github' | 'gitlab';
  CB_GITHUB_APP_ID: string | null;
  CB_GITHUB_APP_PRIVATE_KEY_BASE64: string | null;
  CB_GITHUB_INSTALLATION_ID: string | null;
  CB_GITHUB_WEBHOOK_SECRET: string | null;
  CB_GITHUB_TOKEN: string | null;
  CB_GITHUB_API_URL: string;
  CB_GIT_AUTHOR_NAME: string;
  CB_GIT_AUTHOR_EMAIL: string;
  CB_REPO_ALLOWLIST: string[];
  CB_GATE_DEFAULT: string;
  CB_GATE_TIMEOUT_SECONDS: number;
  CB_GATE_SHELL: string;
  CB_WORKSPACE_TTL_HOURS: number;
  CB_CLONE_DEPTH: number;
  CB_GIT_HTTP_TIMEOUT_SECONDS: number;
  CB_MAX_CONCURRENCY: number;
  CB_MAX_CONCURRENCY_PER_REPO: number;
  CB_RUN_TIMEOUT_SECONDS: number;
  CB_DAILY_COST_USD: number;
  CB_AUTOMERGE: 'on' | 'off';
  CB_MERGE_METHOD: 'squash' | 'merge';
  CB_PROTECTED_PATHS: string[];
  CB_DIFF_MAX_FILES: number;
  CB_DIFF_MAX_LINES: number;
  CB_MISFIRE_GRACE_SECONDS: number;
  CB_SCHEDULER_TICK_SECONDS: number;
  CB_APPROVAL_TTL_SECONDS: number;
  CB_PROBATION_RUNS: number;
  CB_INTEGRATION_TIMEOUT_SECONDS: number;
  CB_RETENTION_RUNS_DAYS: number;
  CB_RETENTION_EVENTS_DAYS: number;
  CB_RETENTION_LOGS_DAYS: number;
  CB_RETENTION_CHAT_DAYS: number;
  CB_RETENTION_APPROVALS_DAYS: number;
  CB_VAPID_PUBLIC_KEY: string | null;
  CB_VAPID_PRIVATE_KEY: string | null;
  CB_VAPID_SUBJECT: string | null;
  CB_FCM_PROJECT_ID: string | null;
  CB_FCM_SERVICE_ACCOUNT_BASE64: string | null;
  CB_APNS_KEY_ID: string | null;
  CB_APNS_TEAM_ID: string | null;
  CB_APNS_PRIVATE_KEY_BASE64: string | null;
  CB_QUIET_HOURS: string | null;
  CB_PUBLIC_HOSTNAME: string | null;
  CB_TUNNEL_TOKEN: string | null;
  CB_TUNNEL_METRICS: string;
}

export type ConfigInput = Record<string, string | undefined>;

const PROTECTED_PATHS_CSV = '.github/**,ops/**,infra/**,**/*.env,CODEOWNERS,.gitmodules';

export const CONFIG_DEFAULTS: Readonly<Record<string, string | number | boolean | string[]>> =
  Object.freeze({
    CB_ENV: 'production',
    CB_BIND: '127.0.0.1:8787',
    CB_LOG_LEVEL: 'info',
    CB_TIMEZONE: 'Europe/Madrid',
    CB_INSTANCE_NAME: 'cb-instance',
    CB_STATE_DIR: '/var/lib/codebox',
    CB_REPO_ROOT: '/srv/codebox/repos',
    CB_WORKSPACE_ROOT: '/srv/codebox/worktrees',
    CB_INSTALL_DIR: '/opt/codebox',
    CB_TMP_DIR: '/var/tmp/codebox',
    CB_PAIRING_TTL_SECONDS: 300,
    CB_ACCESS_TOKEN_TTL_SECONDS: 900,
    CB_REFRESH_TOKEN_TTL_DAYS: 30,
    CB_OPENCODE_URL: 'http://127.0.0.1:4096',
    CB_OPENCODE_BIN: 'opencode',
    CB_OPENCODE_HOSTNAME: '127.0.0.1',
    CB_OPENCODE_PORT: 4096,
    CB_OPENCODE_AUTO: true,
    CB_DEFAULT_AGENT: 'build',
    CB_MODEL_PROVIDER_KEYS: [],
    CB_OPENCODE_HEALTH_PATH: '/api/info',
    CB_GIT_PROVIDER: 'github',
    CB_GITHUB_API_URL: 'https://api.github.com',
    CB_GIT_AUTHOR_NAME: 'codebox[bot]',
    CB_GIT_AUTHOR_EMAIL: 'codebox@users.noreply.github.com',
    CB_REPO_ALLOWLIST: [],
    CB_GATE_DEFAULT: 'npm test && npm run build',
    CB_GATE_TIMEOUT_SECONDS: 1800,
    CB_GATE_SHELL: '/bin/bash',
    CB_INTEGRATION_TIMEOUT_SECONDS: 15,
    CB_WORKSPACE_TTL_HOURS: 168,
    CB_CLONE_DEPTH: 0,
    CB_GIT_HTTP_TIMEOUT_SECONDS: 120,
    CB_MAX_CONCURRENCY: 3,
    CB_MAX_CONCURRENCY_PER_REPO: 1,
    CB_RUN_TIMEOUT_SECONDS: 5400,
    CB_DAILY_COST_USD: 10,
    CB_AUTOMERGE: 'on',
    CB_MERGE_METHOD: 'squash',
    CB_PROTECTED_PATHS: PROTECTED_PATHS_CSV.split(','),
    CB_DIFF_MAX_FILES: 40,
    CB_DIFF_MAX_LINES: 2000,
    CB_MISFIRE_GRACE_SECONDS: 900,
    CB_SCHEDULER_TICK_SECONDS: 15,
    CB_APPROVAL_TTL_SECONDS: 600,
    CB_PROBATION_RUNS: 0,
    CB_RETENTION_RUNS_DAYS: 90,
    CB_RETENTION_EVENTS_DAYS: 14,
    CB_RETENTION_LOGS_DAYS: 30,
    CB_RETENTION_CHAT_DAYS: 90,
    CB_RETENTION_APPROVALS_DAYS: 7,
    CB_TUNNEL_METRICS: '127.0.0.1:20241',
  });

export const SECRET_CONFIG_KEYS: readonly string[] = Object.freeze([
  'CB_SESSION_SECRET',
  'CB_SECRETS_KEY',
  'CB_GITHUB_APP_PRIVATE_KEY_BASE64',
  'CB_GITHUB_WEBHOOK_SECRET',
  'CB_GITHUB_TOKEN',
  'CB_OPENCODE_TOKEN',
  'CB_VAPID_PRIVATE_KEY',
  'CB_FCM_SERVICE_ACCOUNT_BASE64',
  'CB_APNS_PRIVATE_KEY_BASE64',
  'CB_TUNNEL_TOKEN',
]);

const QUIET_HOURS_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const HOST_PORT_PATTERN = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9_.-]+):[0-9]{1,5}$/;

function csv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function textField(fallback: string): z.ZodType<string, string | undefined> {
  return z.string().default(fallback);
}

function nullableTextField(): z.ZodType<string | null, string | undefined> {
  return z
    .string()
    .optional()
    .transform((value) => value ?? null);
}

function intField(fallback: number): z.ZodType<number, string | undefined> {
  return z
    .string()
    .regex(/^\d+$/, 'expected a non-negative integer')
    .default(String(fallback))
    .transform(Number);
}

function positiveIntField(fallback: number): z.ZodType<number, string | undefined> {
  return z
    .string()
    .regex(/^[1-9]\d*$/, 'expected a positive integer')
    .default(String(fallback))
    .transform(Number);
}

function usdField(fallback: number): z.ZodType<number, string | undefined> {
  return z
    .string()
    .regex(/^\d+(?:\.\d+)?$/, 'expected a non-negative number')
    .default(String(fallback))
    .transform(Number);
}

function csvField(fallback: string): z.ZodType<string[], string | undefined> {
  return z.string().default(fallback).transform(csv);
}

function hostPortField(fallback: string): z.ZodType<string, string | undefined> {
  return z
    .string()
    .default(fallback)
    .refine((value) => HOST_PORT_PATTERN.test(value), { message: 'expected host:port' });
}

const configFieldSchemas = {
  // §2 Core
  CB_ENV: z.enum(['production', 'staging', 'development', 'test']).default('production'),
  CB_BIND: hostPortField('127.0.0.1:8787'),
  CB_PUBLIC_URL: z
    .url()
    .optional()
    .transform((value) => value ?? null),
  CB_LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  CB_TIMEZONE: textField('Europe/Madrid'),
  CB_INSTANCE_NAME: textField('cb-instance'),
  CB_COMMIT: nullableTextField(),
  // §3 Paths
  CB_STATE_DIR: textField('/var/lib/codebox'),
  CB_REPO_ROOT: textField('/srv/codebox/repos'),
  CB_WORKSPACE_ROOT: textField('/srv/codebox/worktrees'),
  CB_INSTALL_DIR: textField('/opt/codebox'),
  CB_TMP_DIR: textField('/var/tmp/codebox'),
  // §4 Auth and devices
  CB_SESSION_SECRET: z.string().min(32),
  CB_SECRETS_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/)
    .optional()
    .transform((value) => value ?? null),
  CB_PAIRING_TTL_SECONDS: intField(300),
  CB_ACCESS_TOKEN_TTL_SECONDS: intField(900),
  CB_REFRESH_TOKEN_TTL_DAYS: intField(30),
  CB_OWNER_EMAIL: nullableTextField(),
  CB_ALLOWED_ORIGINS: csvField(''),
  CB_ACCESS_TEAM_DOMAIN: nullableTextField(),
  CB_ACCESS_AUD: nullableTextField(),
  // §5 OpenCode
  CB_OPENCODE_URL: z.url().default('http://127.0.0.1:4096'),
  CB_OPENCODE_BIN: textField('opencode'),
  CB_OPENCODE_HOSTNAME: textField('127.0.0.1'),
  CB_OPENCODE_PORT: intField(4096),
  CB_OPENCODE_TOKEN: nullableTextField(),
  CB_OPENCODE_AUTO: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  CB_DEFAULT_AGENT: textField('build'),
  CB_DEFAULT_MODEL: nullableTextField(),
  CB_MODEL_PROVIDER_KEYS: csvField(''),
  CB_OPENCODE_HEALTH_PATH: textField('/api/info'),
  // §6 Git provider
  CB_GIT_PROVIDER: z.enum(['github', 'gitlab']).default('github'),
  CB_GITHUB_APP_ID: nullableTextField(),
  CB_GITHUB_APP_PRIVATE_KEY_BASE64: nullableTextField(),
  CB_GITHUB_INSTALLATION_ID: nullableTextField(),
  CB_GITHUB_WEBHOOK_SECRET: nullableTextField(),
  CB_GITHUB_TOKEN: nullableTextField(),
  CB_GITHUB_API_URL: z.url().default('https://api.github.com'),
  CB_GIT_AUTHOR_NAME: textField('codebox[bot]'),
  CB_GIT_AUTHOR_EMAIL: textField('codebox@users.noreply.github.com'),
  // §7 Repositories and workspaces
  CB_REPO_ALLOWLIST: csvField(''),
  CB_GATE_DEFAULT: textField('npm test && npm run build'),
  CB_GATE_TIMEOUT_SECONDS: intField(1800),
  CB_GATE_SHELL: textField('/bin/bash'),
  CB_WORKSPACE_TTL_HOURS: intField(168),
  CB_CLONE_DEPTH: intField(0),
  CB_GIT_HTTP_TIMEOUT_SECONDS: intField(120),
  // §8 Runs, merge and scheduler
  CB_MAX_CONCURRENCY: positiveIntField(3),
  CB_MAX_CONCURRENCY_PER_REPO: positiveIntField(1),
  CB_RUN_TIMEOUT_SECONDS: intField(5400),
  CB_DAILY_COST_USD: usdField(10),
  CB_AUTOMERGE: z.enum(['on', 'off']).default('on'),
  CB_MERGE_METHOD: z.enum(['squash', 'merge']).default('squash'),
  CB_PROTECTED_PATHS: csvField(PROTECTED_PATHS_CSV),
  CB_DIFF_MAX_FILES: intField(40),
  CB_DIFF_MAX_LINES: intField(2000),
  CB_MISFIRE_GRACE_SECONDS: intField(900),
  CB_SCHEDULER_TICK_SECONDS: intField(15),
  CB_APPROVAL_TTL_SECONDS: intField(600),
  CB_PROBATION_RUNS: intField(0),
  CB_INTEGRATION_TIMEOUT_SECONDS: intField(15),
  // §9 Retention
  CB_RETENTION_RUNS_DAYS: intField(90),
  CB_RETENTION_EVENTS_DAYS: intField(14),
  CB_RETENTION_LOGS_DAYS: intField(30),
  CB_RETENTION_CHAT_DAYS: intField(90),
  CB_RETENTION_APPROVALS_DAYS: intField(7),
  // §10 Notifications
  CB_VAPID_PUBLIC_KEY: nullableTextField(),
  CB_VAPID_PRIVATE_KEY: nullableTextField(),
  CB_VAPID_SUBJECT: nullableTextField(),
  CB_FCM_PROJECT_ID: nullableTextField(),
  CB_FCM_SERVICE_ACCOUNT_BASE64: nullableTextField(),
  CB_APNS_KEY_ID: nullableTextField(),
  CB_APNS_TEAM_ID: nullableTextField(),
  CB_APNS_PRIVATE_KEY_BASE64: nullableTextField(),
  CB_QUIET_HOURS: z
    .string()
    .regex(QUIET_HOURS_PATTERN)
    .optional()
    .transform((value) => value ?? null),
  // §11 Tunnel
  CB_PUBLIC_HOSTNAME: nullableTextField(),
  CB_TUNNEL_TOKEN: nullableTextField(),
  CB_TUNNEL_METRICS: hostPortField('127.0.0.1:20241'),
} as const;

const configObjectSchema = z.strictObject(configFieldSchemas);

type ParsedConfig = z.infer<typeof configObjectSchema>;

function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function loopbackHost(bind: string): string {
  const index = bind.lastIndexOf(':');
  return index === -1 ? bind : bind.slice(0, index);
}

function normaliseEnv(input: ConfigInput): ConfigInput {
  const output: ConfigInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith('CB_')) continue;
    if (value === undefined || value === '') continue;
    output[key] = value;
  }
  return output;
}

function toConfig(parsed: ParsedConfig): CodeboxConfig {
  const publicOrigin = parsed.CB_PUBLIC_URL === null ? null : originOf(parsed.CB_PUBLIC_URL);
  const allowedOrigins =
    parsed.CB_ALLOWED_ORIGINS.length > 0
      ? parsed.CB_ALLOWED_ORIGINS
      : publicOrigin === null
        ? []
        : [publicOrigin];
  const vapidSubject =
    parsed.CB_VAPID_SUBJECT ??
    (parsed.CB_OWNER_EMAIL === null ? null : `mailto:${parsed.CB_OWNER_EMAIL}`);
  return { ...parsed, CB_ALLOWED_ORIGINS: allowedOrigins, CB_VAPID_SUBJECT: vapidSubject };
}

export const configSchema: z.ZodType<CodeboxConfig, ConfigInput> = z
  .preprocess(normaliseEnv, configObjectSchema)
  .transform(toConfig)
  .refine(
    (config) =>
      config.CB_ENV !== 'production' ||
      (config.CB_PUBLIC_URL !== null && config.CB_PUBLIC_URL.startsWith('https://')),
    { message: 'CB_PUBLIC_URL must be an https URL in production', path: ['CB_PUBLIC_URL'] },
  )
  .refine(
    (config) =>
      config.CB_ENV !== 'production' ||
      ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(loopbackHost(config.CB_BIND)),
    { message: 'CB_BIND must be loopback in production', path: ['CB_BIND'] },
  );

export function configKeyNames(): readonly string[] {
  return Object.keys(configFieldSchemas).sort();
}

function secretKeyOf(path: string): string | null {
  const segments = path.split('.');
  const key = segments[1];
  if (key === undefined) return null;
  return SECRET_CONFIG_KEYS.includes(key) ? key : null;
}

function redactSecret(issue: ParseIssue): ParseIssue {
  const key = secretKeyOf(issue.path);
  return key === null ? issue : { ...issue, message: `${key} is invalid` };
}

export function parseConfig(input: ConfigInput): CodeboxConfig {
  return parseOrThrowRedacted(configSchema, input, 'config', redactSecret);
}
