import { describe, expect, it } from 'vitest';
import { ContractParseError } from './parse.js';
import {
  CONFIG_DEFAULTS,
  SECRET_CONFIG_KEYS,
  configKeyNames,
  configSchema,
  parseConfig,
} from './config.js';

const secret = 'x'.repeat(40);

const configKeys = [
  'CB_ACCESS_AUD',
  'CB_ACCESS_TEAM_DOMAIN',
  'CB_ACCESS_TOKEN_TTL_SECONDS',
  'CB_ALLOWED_ORIGINS',
  'CB_APNS_KEY_ID',
  'CB_APNS_PRIVATE_KEY_BASE64',
  'CB_APNS_TEAM_ID',
  'CB_APPROVAL_TTL_SECONDS',
  'CB_AUTOMERGE',
  'CB_BIND',
  'CB_CLONE_DEPTH',
  'CB_COMMIT',
  'CB_DAILY_COST_USD',
  'CB_DEFAULT_AGENT',
  'CB_DEFAULT_MODEL',
  'CB_DIFF_MAX_FILES',
  'CB_DIFF_MAX_LINES',
  'CB_ENV',
  'CB_FCM_PROJECT_ID',
  'CB_FCM_SERVICE_ACCOUNT_BASE64',
  'CB_GATE_DEFAULT',
  'CB_GATE_SHELL',
  'CB_GATE_TIMEOUT_SECONDS',
  'CB_GITHUB_API_URL',
  'CB_GITHUB_APP_ID',
  'CB_GITHUB_APP_PRIVATE_KEY_BASE64',
  'CB_GITHUB_INSTALLATION_ID',
  'CB_GITHUB_TOKEN',
  'CB_GITHUB_WEBHOOK_SECRET',
  'CB_GIT_AUTHOR_EMAIL',
  'CB_GIT_AUTHOR_NAME',
  'CB_GIT_HTTP_TIMEOUT_SECONDS',
  'CB_GIT_PROVIDER',
  'CB_INSTALL_DIR',
  'CB_INSTANCE_NAME',
  'CB_INTEGRATION_TIMEOUT_SECONDS',
  'CB_LOG_LEVEL',
  'CB_MAX_CONCURRENCY',
  'CB_MAX_CONCURRENCY_PER_REPO',
  'CB_MERGE_METHOD',
  'CB_MISFIRE_GRACE_SECONDS',
  'CB_MODEL_PROVIDER_KEYS',
  'CB_OPENCODE_AUTO',
  'CB_OPENCODE_BIN',
  'CB_OPENCODE_HEALTH_PATH',
  'CB_OPENCODE_HOSTNAME',
  'CB_OPENCODE_PORT',
  'CB_OPENCODE_TOKEN',
  'CB_OPENCODE_URL',
  'CB_OWNER_EMAIL',
  'CB_PAIRING_TTL_SECONDS',
  'CB_PROBATION_RUNS',
  'CB_PROTECTED_PATHS',
  'CB_PUBLIC_HOSTNAME',
  'CB_PUBLIC_URL',
  'CB_QUIET_HOURS',
  'CB_REFRESH_TOKEN_TTL_DAYS',
  'CB_REPO_ALLOWLIST',
  'CB_REPO_ROOT',
  'CB_RETENTION_APPROVALS_DAYS',
  'CB_RETENTION_CHAT_DAYS',
  'CB_RETENTION_EVENTS_DAYS',
  'CB_RETENTION_LOGS_DAYS',
  'CB_RETENTION_RUNS_DAYS',
  'CB_RUN_TIMEOUT_SECONDS',
  'CB_SCHEDULER_TICK_SECONDS',
  'CB_SESSION_SECRET',
  'CB_SECRETS_KEY',
  'CB_STATE_DIR',
  'CB_TIMEZONE',
  'CB_TMP_DIR',
  'CB_TUNNEL_METRICS',
  'CB_TUNNEL_TOKEN',
  'CB_VAPID_PRIVATE_KEY',
  'CB_VAPID_PUBLIC_KEY',
  'CB_VAPID_SUBJECT',
  'CB_WORKSPACE_ROOT',
  'CB_WORKSPACE_TTL_HOURS',
];

function dev(overrides: Record<string, string> = {}): Record<string, string> {
  return { CB_ENV: 'development', CB_SESSION_SECRET: secret, ...overrides };
}

function parseError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (thrown) {
    return thrown;
  }
  return null;
}

function firstPath(error: unknown): string | null {
  return error instanceof ContractParseError ? error.first.path : null;
}

describe('config', () => {
  it('config requires CB_SESSION_SECRET', () => {
    const error = parseError(() => parseConfig({}));
    expect(error).toBeInstanceOf(ContractParseError);
    expect(firstPath(error)).toBe('config.CB_SESSION_SECRET');

    const tooShort = parseError(() => parseConfig({ CB_SESSION_SECRET: 'short' }));
    expect(firstPath(tooShort)).toBe('config.CB_SESSION_SECRET');

    expect(parseConfig(dev()).CB_SESSION_SECRET).toBe(secret);
  });

  it('config accepts documented defaults', () => {
    const config = parseConfig(dev());
    expect(config.CB_BIND).toBe('127.0.0.1:8787');
    expect(config.CB_STATE_DIR).toBe('/var/lib/codebox');
    expect(config.CB_MAX_CONCURRENCY).toBe(3);
    expect(config.CB_MAX_CONCURRENCY_PER_REPO).toBe(1);
    expect(config.CB_AUTOMERGE).toBe('on');
    expect(config.CB_MERGE_METHOD).toBe('squash');
    expect(config.CB_DAILY_COST_USD).toBe(10);
    expect(config.CB_OPENCODE_AUTO).toBe(true);
    expect(config.CB_PROTECTED_PATHS[0]).toBe('.github/**');
    expect(Object.keys(config).sort()).toEqual([...configKeys].sort());
    expect(Object.keys(config)).toHaveLength(78);
  });

  it('config never echoes a secret value', () => {
    const shortSecret = parseError(() => parseConfig({ CB_SESSION_SECRET: 'short-value-xyz' }));
    const wrongType = parseError(() =>
      parseConfig({ CB_SESSION_SECRET: secret, CB_GITHUB_TOKEN: 1234567890 }),
    );

    expect(String(shortSecret)).not.toContain('short-value-xyz');
    expect(String(shortSecret)).toContain('CB_SESSION_SECRET');
    expect(JSON.stringify(shortSecret instanceof Error ? shortSecret.issues : [])).not.toContain(
      'short-value-xyz',
    );

    expect(String(wrongType)).not.toContain('1234567890');
    expect(String(wrongType)).toContain('CB_GITHUB_TOKEN');
    expect(firstPath(wrongType)).toBe('config.CB_GITHUB_TOKEN');
  });

  it('lists every documented key once, sorted, and never a pipeline key', () => {
    const names = configKeyNames();
    expect([...names]).toEqual([...names].sort());
    expect([...names].sort()).toEqual([...configKeys].sort());
    for (const name of names) {
      expect(name.startsWith('CB_')).toBe(true);
      expect(/^CB_(AGENT|OCI)_/.test(name)).toBe(false);
      expect(name.startsWith('OCI_CLI_')).toBe(false);
    }
    for (const key of Object.keys(CONFIG_DEFAULTS)) {
      expect(names).toContain(key);
    }
    for (const key of SECRET_CONFIG_KEYS) {
      expect(names).toContain(key);
      expect(CONFIG_DEFAULTS[key]).toBeUndefined();
    }
  });

  it('parses numbers from strings and fails on the key path otherwise', () => {
    const config = parseConfig(
      dev({ CB_MAX_CONCURRENCY: '3', CB_DAILY_COST_USD: '2.5', CB_CLONE_DEPTH: '0' }),
    );
    expect(config.CB_MAX_CONCURRENCY).toBe(3);
    expect(config.CB_DAILY_COST_USD).toBe(2.5);
    expect(config.CB_CLONE_DEPTH).toBe(0);

    expect(firstPath(parseError(() => parseConfig(dev({ CB_MAX_CONCURRENCY: 'two' }))))).toBe(
      'config.CB_MAX_CONCURRENCY',
    );
    expect(firstPath(parseError(() => parseConfig(dev({ CB_WORKSPACE_TTL_HOURS: '-1' }))))).toBe(
      'config.CB_WORKSPACE_TTL_HOURS',
    );
  });

  it('rejects a zero concurrency', () => {
    expect(firstPath(parseError(() => parseConfig(dev({ CB_MAX_CONCURRENCY: '0' }))))).toBe(
      'config.CB_MAX_CONCURRENCY',
    );
    expect(
      firstPath(parseError(() => parseConfig(dev({ CB_MAX_CONCURRENCY_PER_REPO: '0' })))),
    ).toBe('config.CB_MAX_CONCURRENCY_PER_REPO');
    expect(() => parseConfig(dev({ CB_MAX_CONCURRENCY: '0' }))).toThrow(
      /expected a positive integer/,
    );
  });

  it('rejects a malformed bind, tunnel address or url', () => {
    expect(firstPath(parseError(() => parseConfig(dev({ CB_BIND: '8787' }))))).toBe(
      'config.CB_BIND',
    );
    expect(firstPath(parseError(() => parseConfig(dev({ CB_TUNNEL_METRICS: 'nope' }))))).toBe(
      'config.CB_TUNNEL_METRICS',
    );
    expect(firstPath(parseError(() => parseConfig(dev({ CB_OPENCODE_URL: 'not a url' }))))).toBe(
      'config.CB_OPENCODE_URL',
    );
    expect(firstPath(parseError(() => parseConfig(dev({ CB_GITHUB_API_URL: 'nope' }))))).toBe(
      'config.CB_GITHUB_API_URL',
    );
  });

  it('enforces the production loopback bind and the https public url', () => {
    expect(firstPath(parseError(() => parseConfig({ CB_SESSION_SECRET: secret })))).toBe(
      'config.CB_PUBLIC_URL',
    );
    expect(
      firstPath(
        parseError(() =>
          parseConfig({
            CB_SESSION_SECRET: secret,
            CB_PUBLIC_URL: 'http://cb.example.com',
          }),
        ),
      ),
    ).toBe('config.CB_PUBLIC_URL');
    expect(
      firstPath(
        parseError(() =>
          parseConfig({
            CB_SESSION_SECRET: secret,
            CB_PUBLIC_URL: 'https://cb.example.com',
            CB_BIND: '0.0.0.0:8787',
          }),
        ),
      ),
    ).toBe('config.CB_BIND');

    const production = parseConfig({
      CB_SESSION_SECRET: secret,
      CB_PUBLIC_URL: 'https://cb.example.com',
    });
    expect(production.CB_ENV).toBe('production');
    expect(production.CB_ALLOWED_ORIGINS).toEqual(['https://cb.example.com']);
  });

  it('derives the allowed origins and the vapid subject, and parses csv lists', () => {
    const development = parseConfig(
      dev({
        CB_OWNER_EMAIL: 'you@example.com',
        CB_ALLOWED_ORIGINS: 'capacitor://localhost, http://localhost:8100',
        CB_REPO_ALLOWLIST: 'you/scratch, you/other',
        CB_MODEL_PROVIDER_KEYS: 'ANTHROPIC_API_KEY,OPENAI_API_KEY',
        CB_PROTECTED_PATHS: 'ops/**,infra/**',
        CB_QUIET_HOURS: '22:00-08:00',
      }),
    );
    expect(development.CB_ALLOWED_ORIGINS).toEqual([
      'capacitor://localhost',
      'http://localhost:8100',
    ]);
    expect(development.CB_REPO_ALLOWLIST).toEqual(['you/scratch', 'you/other']);
    expect(development.CB_MODEL_PROVIDER_KEYS).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    expect(development.CB_PROTECTED_PATHS).toEqual(['ops/**', 'infra/**']);
    expect(development.CB_VAPID_SUBJECT).toBe('mailto:you@example.com');
    expect(development.CB_QUIET_HOURS).toBe('22:00-08:00');

    const bare = parseConfig(dev());
    expect(bare.CB_ALLOWED_ORIGINS).toEqual([]);
    expect(bare.CB_VAPID_SUBJECT).toBeNull();
    expect(bare.CB_REPO_ALLOWLIST).toEqual([]);
    expect(bare.CB_MODEL_PROVIDER_KEYS).toEqual([]);
    expect(bare.CB_PUBLIC_URL).toBeNull();
    expect(bare.CB_COMMIT).toBeNull();

    expect(firstPath(parseError(() => parseConfig(dev({ CB_QUIET_HOURS: '8am-10pm' }))))).toBe(
      'config.CB_QUIET_HOURS',
    );
  });

  it('ignores the process environment and rejects an unknown CB_ key', () => {
    const config = parseConfig(
      dev({ PATH: '/usr/local/bin', HOME: '/home/codebox', NODE_ENV: 'test' }),
    );
    expect('PATH' in config).toBe(false);
    expect('NODE_ENV' in config).toBe(false);

    expect(firstPath(parseError(() => parseConfig(dev({ CB_TYPO: 'x' }))))).toBe('config.CB_TYPO');
    expect(firstPath(parseError(() => parseConfig(dev({ CB_AGENT_TOKEN: 'x' }))))).toBe(
      'config.CB_AGENT_TOKEN',
    );
    expect(firstPath(parseError(() => parseConfig(dev({ CB_OCI_RETRY: 'off' }))))).toBe(
      'config.CB_OCI_RETRY',
    );
    expect(firstPath(parseError(() => parseConfig(dev({ OCI_CLI_REGION: 'eu-madrid-1' }))))).toBe(
      null,
    );
    expect(parseConfig(dev({ OCI_CLI_REGION: 'eu-madrid-1' })).CB_ENV).toBe('development');
  });

  it('accepts both github auth modes and neither, and rejects an unknown provider', () => {
    const both = parseConfig(
      dev({
        CB_GITHUB_APP_ID: '123456',
        CB_GITHUB_APP_PRIVATE_KEY_BASE64: 'cGVt',
        CB_GITHUB_INSTALLATION_ID: '7890',
        CB_GITHUB_TOKEN: 'placeholder-pat-value',
      }),
    );
    expect(both.CB_GITHUB_APP_ID).toBe('123456');
    expect(both.CB_GITHUB_TOKEN).toBe('placeholder-pat-value');

    const neither = parseConfig(dev());
    expect(neither.CB_GITHUB_APP_ID).toBeNull();
    expect(neither.CB_GITHUB_TOKEN).toBeNull();
    expect(neither.CB_GIT_PROVIDER).toBe('github');

    expect(firstPath(parseError(() => parseConfig(dev({ CB_GIT_PROVIDER: 'gitea' }))))).toBe(
      'config.CB_GIT_PROVIDER',
    );
  });

  it('adds the secrets key and the integration timeout without making either required', () => {
    const masterKey = Buffer.alloc(32, 7).toString('base64');
    expect(masterKey).toHaveLength(44);

    const configured = parseConfig(dev({ CB_SECRETS_KEY: masterKey }));
    expect(configured.CB_SECRETS_KEY).toBe(masterKey);
    expect(configured.CB_INTEGRATION_TIMEOUT_SECONDS).toBe(15);

    expect(parseConfig(dev()).CB_SECRETS_KEY).toBeNull();
    expect(
      parseConfig(dev({ CB_INTEGRATION_TIMEOUT_SECONDS: '0' })).CB_INTEGRATION_TIMEOUT_SECONDS,
    ).toBe(0);

    const invalid = parseError(() => parseConfig(dev({ CB_SECRETS_KEY: 'not-a-44-char-key-xyz' })));
    expect(firstPath(invalid)).toBe('config.CB_SECRETS_KEY');
    expect(String(invalid)).toContain('CB_SECRETS_KEY');
    expect(String(invalid)).not.toContain('not-a-44-char-key-xyz');
    expect(
      JSON.stringify(invalid instanceof ContractParseError ? invalid.issues : []),
    ).not.toContain('not-a-44-char-key-xyz');

    expect(
      firstPath(parseError(() => parseConfig(dev({ CB_INTEGRATION_TIMEOUT_SECONDS: '1.5' })))),
    ).toBe('config.CB_INTEGRATION_TIMEOUT_SECONDS');
    expect(SECRET_CONFIG_KEYS).toContain('CB_SECRETS_KEY');
  });

  it('exposes the schema without reading the environment', () => {
    const result = configSchema.safeParse(dev());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CB_ENV).toBe('development');
      expect(result.data.CB_SESSION_SECRET).toBe(secret);
    }
    expect(configSchema.safeParse({ CB_SESSION_SECRET: secret }).success).toBe(false);
  });
});
