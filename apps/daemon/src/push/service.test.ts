import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePushSubscription } from '@codebox/contracts';
import type { NotificationPreferences, PushSubscription } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { PushError } from './errors.js';
import type { PushMessage } from './mapping.js';
import { MAX_PUSH_SUBSCRIPTIONS } from './storage.js';
import { createPushService } from './service.js';
import type { PushService } from './service.js';
import type { PushKind, PushSendInput, PushSendOutcome, PushTransport } from './transport.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const TS = '2026-10-25T10:00:00.000Z';
const RUN_ID = 'run_01JABCDEFG';
const ENDPOINT_A = 'https://push.example.com/a';
const ENDPOINT_B = 'https://push.example.com/b';
const KEYS = { p256dh: 'p256dh-key', auth: 'auth-key' };
const PR = { number: 42, url: 'https://github.com/acme/widgets/pull/42', mergeable: true };

class FakeTransport implements PushTransport {
  readonly sent: PushSendInput[] = [];
  private readonly outcomes = new Map<string, PushSendOutcome>();

  answer(endpoint: string, outcome: PushSendOutcome): void {
    this.outcomes.set(endpoint, outcome);
  }

  send(input: PushSendInput): Promise<PushSendOutcome> {
    this.sent.push(input);
    return Promise.resolve(
      this.outcomes.get(input.subscription.endpoint) ?? { kind: 'accepted', status: 201 },
    );
  }
}

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Harness {
  readonly service: PushService;
  readonly transport: FakeTransport;
  readonly store: Store;
  readonly lines: Record<string, unknown>[];
  advance(iso: string): void;
}

interface HarnessOptions {
  readonly clock?: string;
  readonly injectedTransports?: Partial<Record<PushKind, PushTransport>> | null;
  readonly vapid?: boolean;
}

function harness(options: HarnessOptions = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-16-push-service-'));
  directories.push(directory);
  const appDir = join(directory, 'app');
  mkdirSync(appDir, { recursive: true });
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_LOG_LEVEL: 'debug',
  });
  const store = openInMemoryStore();
  stores.push(store);
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  let current = new Date(options.clock ?? TS);
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => current,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir,
    shutdown: createShutdownRegistry(logger),
  };
  const transport = new FakeTransport();
  const injected =
    options.injectedTransports === null
      ? undefined
      : (options.injectedTransports ?? { web: transport });
  const service = createPushService({
    context,
    now: () => current,
    ...(injected === undefined ? {} : { transports: injected }),
  });
  return {
    service,
    transport,
    store,
    lines,
    advance(iso: string): void {
      current = new Date(iso);
    },
  };
}

function append(
  store: Store,
  type: 'run.merged' | 'run.finished' | 'run.failed' | 'run.cancelled' | 'approval.created',
  data: Record<string, unknown>,
): void {
  store.events.append({ runId: null, chatId: null, seq: null, type, data, ts: TS });
}

function mergedData(): Record<string, unknown> {
  return { runId: RUN_ID, seq: 1, ts: TS, pr: PR, mergeCommit: 'a'.repeat(40), method: 'squash' };
}

function finishedData(seq = 2): Record<string, unknown> {
  return { runId: RUN_ID, seq, ts: TS, state: 'succeeded' };
}

function subscribe(service: PushService, endpoint = ENDPOINT_A): PushSubscription {
  return service.subscribe({ kind: 'web', endpoint, keys: KEYS }).subscription;
}

function messages(
  lines: readonly Record<string, unknown>[],
  msg: string,
): Record<string, unknown>[] {
  return lines.filter((line) => line['msg'] === msg);
}

describe('push service pump', () => {
  it('sends one push per run, not one per event, and never repeats it', async () => {
    const { service, transport, store, lines } = harness();
    await service.pump();
    const first = subscribe(service, ENDPOINT_A);
    const second = subscribe(service, ENDPOINT_B);
    append(store, 'run.merged', mergedData());
    append(store, 'run.finished', finishedData());

    const report = await service.pump();

    expect(transport.sent).toHaveLength(2);
    expect(transport.sent.map((sent) => sent.subscription.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(transport.sent.map((sent) => sent.message.tag)).toEqual([
      `run:${RUN_ID}`,
      `run:${RUN_ID}`,
    ]);
    expect(transport.sent[0]?.message.body).toBe('Pull request #42 was merged.');
    expect(report).toMatchObject({ scanned: 2, sent: 2, held: 0, pruned: 0, skipped: 1 });
    expect(messages(lines, 'push_skipped')).toContainEqual(
      expect.objectContaining({ reason: 'dedupe', type: 'run.finished', tag: `run:${RUN_ID}` }),
    );

    const secondReport = await service.pump();
    expect(transport.sent).toHaveLength(2);
    expect(secondReport).toEqual({ scanned: 0, sent: 0, held: 0, pruned: 0, skipped: 0 });
  });

  it('prunes exactly the subscription a 410 reports as gone', async () => {
    const { service, transport, store, lines } = harness();
    await service.pump();
    const gone = subscribe(service, ENDPOINT_A);
    const kept = subscribe(service, ENDPOINT_B);
    transport.answer(ENDPOINT_A, { kind: 'expired', status: 410 });
    append(store, 'run.finished', finishedData());

    const report = await service.pump();

    expect(report).toMatchObject({ sent: 1, pruned: 1 });
    expect(service.listSubscriptions().map((subscription) => subscription.id)).toEqual([kept.id]);
    const stored = store.settings.get('push.subscriptions');
    expect(Array.isArray(stored)).toBe(true);
    expect((stored as unknown[]).length).toBe(1);
    expect(messages(lines, 'push_pruned')).toContainEqual(
      expect.objectContaining({ subscriptionId: gone.id, status: 410 }),
    );
  });

  it('skips an event the preferences do not enable', async () => {
    const { service, transport, store, lines } = harness();
    service.updatePreferences({ events: ['run.failed'], quietHours: null });
    await service.pump();
    subscribe(service);
    append(store, 'run.finished', finishedData());

    const report = await service.pump();

    expect(transport.sent).toHaveLength(0);
    expect(report).toMatchObject({ scanned: 1, sent: 0, skipped: 1 });
    expect(messages(lines, 'push_skipped')).toContainEqual(
      expect.objectContaining({
        reason: 'preference',
        type: 'run.finished',
        tag: `run:${RUN_ID}`,
      }),
    );
  });

  it('holds a non-critical push during quiet hours and drains it afterwards', async () => {
    const { service, transport, store, lines, advance } = harness({
      clock: '2026-11-10T21:30:00.000Z',
    });
    service.updatePreferences({ events: ['run.finished'], quietHours: '22:00-08:00' });
    await service.pump();
    subscribe(service);
    append(store, 'run.finished', finishedData());

    const held = await service.pump();
    expect(transport.sent).toHaveLength(0);
    expect(held).toMatchObject({ scanned: 1, sent: 0, held: 1 });
    expect(messages(lines, 'push_held')).toContainEqual(
      expect.objectContaining({ tag: `run:${RUN_ID}`, type: 'run.finished' }),
    );

    advance('2026-11-11T07:30:00.000Z');
    const drained = await service.pump();
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.message.tag).toBe(`run:${RUN_ID}`);
    expect(drained).toMatchObject({ scanned: 0, sent: 1, held: 0 });

    await service.pump();
    expect(transport.sent).toHaveLength(1);
  });

  it('still delivers a critical approval during quiet hours', async () => {
    const { service, transport, store } = harness({ clock: '2026-11-10T21:30:00.000Z' });
    service.updatePreferences({ events: ['approval.created'], quietHours: '22:00-08:00' });
    await service.pump();
    subscribe(service);
    append(store, 'approval.created', {
      approvalId: 'apv_01JABCDEFG',
      runId: null,
      chatId: null,
      tool: 'bash',
      title: 'Run the gate',
      expiresAt: TS,
      ts: TS,
    });

    const report = await service.pump();

    expect(transport.sent).toHaveLength(1);
    expect(report).toMatchObject({ sent: 1, held: 0 });
    expect(transport.sent[0]?.message.url).toBe('/approvals');
  });

  it('records a failed delivery so the next tick does not retry it', async () => {
    const { service, transport, store, lines } = harness();
    await service.pump();
    subscribe(service);
    transport.answer(ENDPOINT_A, { kind: 'failed', status: 500 });
    append(store, 'run.finished', finishedData());

    const first = await service.pump();
    expect(transport.sent).toHaveLength(1);
    expect(first).toMatchObject({ sent: 0, skipped: 1 });
    expect(messages(lines, 'push_failed')).toContainEqual(
      expect.objectContaining({ tag: `run:${RUN_ID}`, status: 500 }),
    );

    const second = await service.pump();
    expect(second.scanned).toBe(0);
    expect(transport.sent).toHaveLength(1);
  });
});

describe('push subscriptions', () => {
  it('replaces a known endpoint in place with the same id', () => {
    const { service } = harness();
    const created = service.subscribe({ kind: 'web', endpoint: ENDPOINT_A, keys: KEYS });
    expect(created.created).toBe(true);
    const replaced = service.subscribe({
      kind: 'web',
      endpoint: ENDPOINT_A,
      keys: { p256dh: 'other', auth: 'other' },
    });
    expect(replaced.created).toBe(false);
    expect(replaced.subscription.id).toBe(created.subscription.id);
    expect(replaced.subscription.keys).toEqual({ p256dh: 'other', auth: 'other' });
    expect(service.listSubscriptions()).toHaveLength(1);
  });

  it('refuses the twenty-first distinct subscription', () => {
    const { service } = harness();
    for (let index = 0; index < MAX_PUSH_SUBSCRIPTIONS; index += 1) {
      service.subscribe({
        kind: 'web',
        endpoint: `https://push.example.com/${index}`,
        keys: KEYS,
      });
    }
    expect(service.listSubscriptions()).toHaveLength(MAX_PUSH_SUBSCRIPTIONS);
    try {
      service.subscribe({ kind: 'web', endpoint: 'https://push.example.com/overflow', keys: KEYS });
      throw new Error('expected a PushError');
    } catch (error) {
      expect(error).toBeInstanceOf(PushError);
      expect((error as PushError).details).toEqual({ reason: 'subscription_limit' });
      expect((error as PushError).status).toBe(422);
    }
  });

  it('unsubscribes a known id and reports an unknown one', () => {
    const { service } = harness();
    const created = service.subscribe({ kind: 'web', endpoint: ENDPOINT_A, keys: KEYS });
    expect(service.unsubscribe(created.subscription.id)).toBe(true);
    expect(service.listSubscriptions()).toEqual([]);
    expect(service.unsubscribe(created.subscription.id)).toBe(false);
  });

  it('returns the contract shape of a minted subscription', () => {
    const { service } = harness();
    const created = service.subscribe({ kind: 'web', endpoint: ENDPOINT_A, keys: KEYS });
    expect(() => parsePushSubscription(created.subscription)).not.toThrow();
    expect(created.subscription.id.startsWith('sub_')).toBe(true);
  });
});

describe('push delivery without the gate', () => {
  it('sends every message it is given, ignoring preferences and quiet hours', async () => {
    const { service, transport, lines } = harness();
    service.updatePreferences({ events: [], quietHours: '00:00-23:59' });
    subscribe(service, ENDPOINT_A);
    service.subscribe({
      kind: 'fcm',
      endpoint: 'https://fcm.example.com/token',
      keys: { token: 'token' },
    });
    const message: PushMessage = {
      type: 'routine.fired',
      title: 'Take the pill',
      body: 'Reminder.',
      url: '/jobs',
      tag: 'routine:rtn_01J:2026-11-10T07:00:00.000Z',
      routineId: 'rtn_01J',
    };

    const first = await service.deliver(message);
    const second = await service.deliver(message);

    expect(first).toEqual({ attempts: 2, sent: 1, pruned: 0, failed: 0, skipped: 1 });
    expect(second).toEqual(first);
    expect(transport.sent).toHaveLength(2);
    expect(messages(lines, 'push_skipped')).toContainEqual(
      expect.objectContaining({ reason: 'unsupported_kind' }),
    );
  });

  it('is unconfigured without a vapid key and never starts a timer', async () => {
    const { service, lines } = harness({ injectedTransports: null });
    expect(service.configured()).toBe(false);
    expect(messages(lines, 'push_unconfigured')).toHaveLength(1);
    expect(() => {
      service.start();
      service.start();
      service.stop();
      service.stop();
    }).not.toThrow();
    expect(await service.pump()).toEqual({
      scanned: 0,
      sent: 0,
      held: 0,
      pruned: 0,
      skipped: 0,
    });
    expect(
      await service.deliver({
        type: 'run.failed',
        title: 'Run failed',
        body: 'gate_failed: red',
        url: `/runs/${RUN_ID}`,
        tag: `run:${RUN_ID}`,
      }),
    ).toEqual({ attempts: 0, sent: 0, pruned: 0, failed: 0, skipped: 0 });
  });

  it('deduplicates preference events on write', () => {
    const { service } = harness();
    const stored: NotificationPreferences = service.updatePreferences({
      events: ['run.failed', 'run.failed', 'approval.created', 'run.failed'],
      quietHours: null,
    });
    expect(stored.events).toEqual(['run.failed', 'approval.created']);
    expect(service.preferences()).toEqual(stored);
  });
});
