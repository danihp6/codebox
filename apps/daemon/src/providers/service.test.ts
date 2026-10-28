import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderAccountId } from '@codebox/contracts';
import { AgentError } from '@codebox/opencode';
import type { ModelRef } from '@codebox/opencode';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { seedProviderCatalog } from './catalog.js';
import type { ProviderCredentialPort } from './credentials.js';
import { RunApiError } from '../runs/errors.js';
import { ProviderExhaustedError } from './errors.js';
import { createProvidersService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-28T14:55:00.000Z';
const COOLDOWN_INSTANT = '2026-10-28T15:10:00.000Z';
const TOKEN = 'tok_Q7mZ4xR9pL2vB6nK8wT3';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface Sealed {
  readonly id: string;
  readonly name: string;
  readonly value: string;
}

interface Fixture {
  readonly context: DaemonContext;
  readonly store: Store;
  readonly port: ProviderCredentialPort;
  readonly sealed: Sealed[];
  readonly removed: string[];
  readonly lines: string[];
  advance(seconds: number): void;
}

function fixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'cb-73-providers-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const store = openInMemoryStore();
  stores.push(store);
  seedProviderCatalog(store, NOW);
  const lines: string[] = [];
  const logger = createLogger({ level: 'trace', sink: (line) => lines.push(line) });
  let at = new Date(NOW).getTime();
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date(at),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const sealed: Sealed[] = [];
  const removed: string[] = [];
  const lastFour = new Map<string, string>();
  let counter = 0;
  const port: ProviderCredentialPort = {
    create(input) {
      counter += 1;
      const id = `cred_service${counter}`;
      sealed.push({ id, name: input.name, value: input.value });
      lastFour.set(id, input.value.slice(-4));
      return { id, lastFour: input.value.slice(-4) };
    },
    lastFour(id) {
      return lastFour.get(id) ?? '';
    },
    remove(id) {
      removed.push(id);
      lastFour.delete(id);
    },
  };
  return {
    context,
    store,
    port,
    sealed,
    removed,
    lines,
    advance(seconds: number): void {
      at += seconds * 1_000;
    },
  };
}

function service(h: Fixture, runtime?: { listModels(): Promise<readonly ModelRef[]> }) {
  return createProvidersService({
    context: h.context,
    credentials: h.port,
    ...(runtime === undefined ? {} : { runtime }),
  });
}

function add(
  target: ReturnType<typeof service>,
  label: string,
  priority: number,
  providerId: 'opencode-go' | 'anthropic' = 'opencode-go',
) {
  return target.addTokenAccount(providerId, { label, priority, auth: 'token', value: TOKEN });
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to be refused');
}

function calls(h: Fixture, msg: string): Record<string, unknown>[] {
  return h.lines
    .filter((line) => line.includes(`"msg":"${msg}"`))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('addTokenAccount', () => {
  it('seals exactly one credential and answers a view without the token', () => {
    const h = fixture();
    const view = add(service(h), 'go · main', 1);

    expect(h.sealed).toHaveLength(1);
    expect(h.sealed[0]?.value).toBe(TOKEN);
    expect(view.state).toBe('active');
    expect(view.resetAt).toBeNull();
    expect(view.priority).toBe(1);
    expect(view.usedToday).toEqual({ day: '1970-01-01', usd: 0 });
    expect(view.lastFour).toBe('8wT3');

    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain(TOKEN);
    for (let length = 5; length <= TOKEN.length; length += 1) {
      expect(serialised, TOKEN.slice(0, length)).not.toContain(TOKEN.slice(0, length));
    }
  });

  it('refuses an unknown provider', () => {
    const h = fixture();
    const refused = thrownBy(() =>
      service(h).addTokenAccount('nope', {
        label: 'go · main',
        priority: 1,
        auth: 'token',
        value: TOKEN,
      }),
    );
    expect(refused).toBeInstanceOf(RunApiError);
    expect((refused as RunApiError).status).toBe(422);
    expect(h.sealed).toHaveLength(0);
  });

  it('drops the sealed credential when the account cannot be stored', () => {
    const h = fixture();
    const target = service(h);
    add(target, 'go · main', 1);
    expect(thrownBy(() => add(target, 'go · main', 2))).toMatchObject({
      code: 'unique_violation',
    });
    expect(h.removed).toEqual([h.sealed[1]?.id]);
  });
});

describe('beginTurn', () => {
  it('throws with a null retry instant when the provider has no account', () => {
    const h = fixture();
    let thrown: unknown;
    try {
      service(h).beginTurn('opencode-go');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProviderExhaustedError);
    expect((thrown as ProviderExhaustedError).retryAt).toBeNull();
    expect(calls(h, 'provider_exhausted')).toHaveLength(1);
  });

  it('answers the selected account and its credential', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    expect(target.beginTurn('opencode-go')).toEqual({
      providerId: 'opencode-go',
      accountId: first.id,
      credentialId: first.credentialId,
      model: null,
    });
  });
});

describe('recordFailure', () => {
  it('exhausts a quota failure, logs the state and hands the turn to the next account', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    const second = add(target, 'go · spare', 2);

    const outcome = target.recordFailure({
      accountId: first.id,
      failure: { status: 429, reason: null, resetAt: null },
      toolCallEmitted: false,
      retriedOnAccount: false,
    });

    expect(outcome.action).toBe('next_account');
    expect(outcome.account.state).toBe('exhausted');
    expect(outcome.account.resetAt).toBe(COOLDOWN_INSTANT);
    expect(outcome.retryAt).toBe(COOLDOWN_INSTANT);
    const logged = calls(h, 'provider_account_state').filter(
      (entry) => entry['accountId'] === first.id,
    );
    expect(logged).toHaveLength(2);
    expect(logged[1]).toMatchObject({
      providerId: 'opencode-go',
      accountId: first.id,
      state: 'exhausted',
      reason: 'quota',
    });
    expect((outcome.account as { readonly lastFour: string }).lastFour).toBe('8wT3');

    expect(target.beginTurn('opencode-go').accountId).toBe(second.id);
  });

  it('marks an auth failure invalid', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    add(target, 'go · spare', 2);
    const outcome = target.recordFailure({
      accountId: first.id,
      failure: { status: 401, reason: null, resetAt: null },
      toolCallEmitted: false,
      retriedOnAccount: false,
    });
    expect(outcome.action).toBe('next_account');
    expect(outcome.account.state).toBe('invalid');
    expect(outcome.account.resetAt).toBeNull();
  });

  it('stops after a tool call and still writes the state', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    const outcome = target.recordFailure({
      accountId: first.id,
      failure: { status: 429, reason: 'insufficient_quota', resetAt: null },
      toolCallEmitted: true,
      retriedOnAccount: false,
    });
    expect(outcome.action).toBe('stop');
    expect(h.store.providerAccounts.get(first.id)?.state).toBe('exhausted');
    expect(h.store.providerAccounts.get(first.id)?.resetAt).toBe(COOLDOWN_INSTANT);
  });

  it('retries a transient failure once without writing, then moves on', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    const before = h.store.providerAccounts.get(first.id);

    const retry = target.recordFailure({
      accountId: first.id,
      failure: { status: 500, reason: null, resetAt: null },
      toolCallEmitted: false,
      retriedOnAccount: false,
    });
    expect(retry.action).toBe('retry_same');
    expect(h.store.providerAccounts.get(first.id)).toEqual(before);
    expect(calls(h, 'provider_account_state')).toHaveLength(1);

    const next = target.recordFailure({
      accountId: first.id,
      failure: { status: 500, reason: null, resetAt: null },
      toolCallEmitted: false,
      retriedOnAccount: true,
    });
    expect(next.action).toBe('next_account');
  });

  it('keeps the provider instant the provider reports', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    const outcome = target.recordFailure({
      accountId: first.id,
      failure: { status: 429, reason: null, resetAt: '2026-10-28T15:00:00.000Z' },
      toolCallEmitted: false,
      retriedOnAccount: false,
    });
    expect(outcome.account.resetAt).toBe('2026-10-28T15:00:00.000Z');
  });
});

describe('releaseDue', () => {
  it('flips a due reset, logs it and returns the number of rows', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    add(target, 'go · spare', 2);
    target.recordFailure({
      accountId: first.id,
      failure: { status: 429, reason: null, resetAt: null },
      toolCallEmitted: false,
      retriedOnAccount: false,
    });

    expect(target.releaseDue(new Date(NOW))).toBe(0);
    h.advance(901);
    expect(target.releaseDue(new Date('2026-10-28T15:10:01.000Z'))).toBe(1);
    expect(target.releaseDue(new Date('2026-10-28T15:10:01.000Z'))).toBe(0);

    const released = h.store.providerAccounts.get(first.id);
    expect(released?.state).toBe('active');
    expect(released?.resetAt).toBeNull();
    expect(calls(h, 'provider_account_reset')).toHaveLength(1);
  });

  it('releases a due reset before selecting a turn', () => {
    const h = fixture();
    const target = service(h);
    const only = add(target, 'go · main', 1);
    target.recordFailure({
      accountId: only.id,
      failure: { status: 429, reason: null, resetAt: null },
      toolCallEmitted: false,
      retriedOnAccount: false,
    });
    h.advance(901);
    expect(target.beginTurn('opencode-go').accountId).toBe(only.id);
  });
});

describe('beginTurn when every account is dry', () => {
  it('throws with the account reset instant', () => {
    const h = fixture();
    const target = service(h);
    const only = add(target, 'go · main', 1);
    target.recordFailure({
      accountId: only.id,
      failure: { status: 401, reason: null, resetAt: null },
      toolCallEmitted: false,
      retriedOnAccount: false,
    });
    target.recordFailure({
      accountId: only.id,
      failure: { status: 429, reason: null, resetAt: null },
      toolCallEmitted: false,
      retriedOnAccount: false,
    });
    let thrown: unknown;
    try {
      target.beginTurn('opencode-go');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProviderExhaustedError);
    expect((thrown as ProviderExhaustedError).retryAt).toBe(COOLDOWN_INSTANT);
    expect(calls(h, 'provider_exhausted')[0]).toMatchObject({
      providerId: 'opencode-go',
      retryAt: COOLDOWN_INSTANT,
    });
  });
});

describe('testAccount', () => {
  const anthropicModel: ModelRef = {
    id: 'claude-sonnet-4',
    providerId: 'anthropic',
    name: 'Claude Sonnet 4',
  };

  it('answers ok when the runtime knows the provider', async () => {
    const h = fixture();
    const account = add(service(h), 'anthropic · main', 1, 'anthropic');
    const target = service(h, { listModels: () => Promise.resolve([anthropicModel]) });
    expect(await target.testAccount(account.id)).toEqual({
      ok: true,
      state: 'active',
      lastError: null,
    });
  });

  it('answers provider_unknown when the runtime does not list it', async () => {
    const h = fixture();
    const account = add(service(h), 'go · main', 1);
    const target = service(h, { listModels: () => Promise.resolve([]) });
    expect(await target.testAccount(account.id)).toEqual({
      ok: false,
      state: 'active',
      lastError: 'provider_unknown',
    });
  });

  it('answers agent_unavailable when the runtime throws an AgentError', async () => {
    const h = fixture();
    const account = add(service(h), 'go · main', 1);
    const target = service(h, {
      listModels: () => Promise.reject(new AgentError('agent_unavailable', 'down', null, true)),
    });
    expect(await target.testAccount(account.id)).toEqual({
      ok: false,
      state: 'active',
      lastError: 'agent_unavailable',
    });
  });

  it('answers not_active without calling the runtime', async () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    add(target, 'go · spare', 2);
    expect(target.patchAccount(first.id, { enabled: false }).state).toBe('disabled');

    let calls = 0;
    const spy = service(h, {
      listModels: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    });
    expect(await spy.testAccount(first.id)).toEqual({
      ok: false,
      state: 'disabled',
      lastError: 'not_active',
    });
    expect(calls).toBe(0);
  });
});

describe('patchAccount and removeAccount', () => {
  it('keeps at least one active account per provider', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    expect(thrownBy(() => target.patchAccount(first.id, { enabled: false }))).toMatchObject({
      status: 409,
      details: { reason: 'no_active_account' },
    });
    expect(thrownBy(() => target.removeAccount(first.id))).toMatchObject({
      status: 409,
      details: { reason: 'no_active_account' },
    });

    add(target, 'go · spare', 2);
    expect(target.patchAccount(first.id, { enabled: false }).state).toBe('disabled');
    expect(target.patchAccount(first.id, { enabled: true }).state).toBe('active');
  });

  it('writes the editable fields and never accepts a state', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    const patched = target.patchAccount(first.id, {
      label: 'go · renamed',
      priority: 4,
      budgetUsd: 5,
    });
    expect(patched.label).toBe('go · renamed');
    expect(patched.priority).toBe(4);
    expect(patched.budgetUsd).toBe(5);
    expect(patched.state).toBe('active');
  });

  it('removes a non-active account and its credential', () => {
    const h = fixture();
    const target = service(h);
    const first = add(target, 'go · main', 1);
    const second = add(target, 'go · spare', 2);
    target.patchAccount(first.id, { enabled: false });
    target.removeAccount(first.id);
    expect(h.store.providerAccounts.get(first.id)).toBeNull();
    expect(h.removed).toEqual([first.credentialId]);
    expect(target.beginTurn('opencode-go').accountId).toBe(second.id);
  });

  it('answers 404 for an account that does not exist', () => {
    const h = fixture();
    const target = service(h);
    const missing = 'acct_missing000' as ProviderAccountId;
    expect(thrownBy(() => target.patchAccount(missing, { enabled: true }))).toMatchObject({
      status: 404,
    });
    expect(thrownBy(() => target.removeAccount(missing))).toMatchObject({ status: 404 });
    expect(() => target.beginTurn('opencode-go')).toThrow(ProviderExhaustedError);
  });
});

describe('list', () => {
  it('orders accounts by priority then id and carries the last four', () => {
    const h = fixture();
    const target = service(h);
    const third = add(target, 'go · third', 3);
    const first = add(target, 'go · first', 1);
    const list = target.list();
    expect(list.providers.map((provider) => provider.id)).toEqual([
      'opencode-go',
      'anthropic',
      'openai',
    ]);
    const accounts = list.providers[0]?.accounts ?? [];
    expect(accounts.map((account) => account.id)).toEqual([first.id, third.id]);
    expect(accounts[0]?.lastFour).toBe('8wT3');
    expect(JSON.stringify(list)).not.toContain(TOKEN);
  });
});
