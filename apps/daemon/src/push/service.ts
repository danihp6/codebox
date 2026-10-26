import { randomBytes } from 'node:crypto';
import type { NotificationPreferences, PushSubscription } from '@codebox/contracts';
import type { EventRecord } from '@codebox/store';
import type { DaemonContext } from '../modules.js';
import { PushError } from './errors.js';
import { newSubscriptionId } from './ids.js';
import {
  DEFAULT_NOTIFICATION_EVENTS,
  NOTIFICATION_TYPES,
  deliveryKeyOf,
  isCritical,
  isEnabled,
  messageFor,
} from './mapping.js';
import type { NotificationType, PushMessage } from './mapping.js';
import { inQuietHours } from './quiet-hours.js';
import { MAX_PUSH_SUBSCRIPTIONS, createPushStorage } from './storage.js';
import type { PushStorage } from './storage.js';
import { createWebPushTransport } from './transport.js';
import type { PushKind, PushSendOutcome, PushTransport } from './transport.js';
import { createVapidSigner } from './vapid.js';

export const PUSH_PUMP_MS = 2000;

const DEFAULT_BATCH_SIZE = 200;
const DEDUPE_TAGS = 500;

export interface CreatePushServiceOptions {
  readonly context: DaemonContext;
  readonly transports?: Partial<Record<PushKind, PushTransport>>;
  readonly now?: () => Date;
  readonly random?: (size: number) => Buffer;
  readonly pumpIntervalMs?: number;
  readonly batchSize?: number;
}

export interface PushPumpReport {
  readonly scanned: number;
  readonly sent: number;
  readonly held: number;
  readonly pruned: number;
  readonly skipped: number;
}

export interface PushDeliveryReport {
  readonly attempts: number;
  readonly sent: number;
  readonly pruned: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface PushService {
  configured(): boolean;
  preferences(): NotificationPreferences;
  updatePreferences(input: NotificationPreferences): NotificationPreferences;
  listSubscriptions(): readonly PushSubscription[];
  subscribe(input: {
    readonly kind: PushKind;
    readonly endpoint: string;
    readonly keys: Readonly<Record<string, string>>;
  }): { readonly subscription: PushSubscription; readonly created: boolean };
  unsubscribe(id: string): boolean;
  pump(): Promise<PushPumpReport>;
  deliver(message: PushMessage): Promise<PushDeliveryReport>;
  start(): void;
  stop(): void;
}

export function createPushService(options: CreatePushServiceOptions): PushService {
  const { context } = options;
  const logger = context.logger;
  const now = options.now ?? context.clock;
  const random = options.random ?? randomBytes;
  const pumpIntervalMs = Math.max(1, Math.trunc(options.pumpIntervalMs ?? PUSH_PUMP_MS));
  const batchSize = Math.max(1, Math.trunc(options.batchSize ?? DEFAULT_BATCH_SIZE));
  const transports = resolveTransports(options);
  const storage: PushStorage = createPushStorage(
    context.store,
    {
      events: [...DEFAULT_NOTIFICATION_EVENTS],
      quietHours: context.config.CB_QUIET_HOURS,
    },
    now,
    logger,
  );

  // Process state: a restart drops the cursor, the dedupe set and the hold list, and no push
  // is replayed. The durable record is the event log, which the app refetches.
  let cursor: number | null = null;
  const tags: string[] = [];
  const tagSet = new Set<string>();
  const held: PushMessage[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  function configured(): boolean {
    return Object.values(transports).some((transport) => transport !== undefined);
  }

  function recordTag(tag: string): void {
    if (tagSet.has(tag)) return;
    tagSet.add(tag);
    tags.push(tag);
    while (tags.length > DEDUPE_TAGS) {
      const oldest = tags.shift();
      if (oldest !== undefined) tagSet.delete(oldest);
    }
  }

  function quietNow(quietHours: string | null): boolean {
    return inQuietHours({
      now: now(),
      quietHours,
      timeZone: context.config.CB_TIMEZONE,
    });
  }

  async function attempt(
    transport: PushTransport,
    subscription: PushSubscription,
    message: PushMessage,
  ): Promise<PushSendOutcome> {
    try {
      return await transport.send({ subscription, message });
    } catch {
      return { kind: 'failed', status: 0 };
    }
  }

  async function deliverToSubscriptions(message: PushMessage): Promise<PushDeliveryReport> {
    const subscriptions = storage.subscriptions();
    let sent = 0;
    let pruned = 0;
    let failed = 0;
    let skipped = 0;
    for (const subscription of subscriptions) {
      const transport = transports[subscription.kind];
      if (transport === undefined) {
        skipped += 1;
        logger.debug({
          msg: 'push_skipped',
          reason: 'unsupported_kind',
          type: message.type,
          tag: message.tag,
        });
        continue;
      }
      const outcome = await attempt(transport, subscription, message);
      switch (outcome.kind) {
        case 'accepted':
          sent += 1;
          logger.debug({
            msg: 'push_sent',
            tag: message.tag,
            subscriptionId: subscription.id,
            status: outcome.status,
          });
          break;
        case 'expired':
          pruned += 1;
          storage.removeSubscription(subscription.id);
          logger.info({
            msg: 'push_pruned',
            subscriptionId: subscription.id,
            status: outcome.status,
          });
          break;
        case 'failed':
          failed += 1;
          logger.warn({
            msg: 'push_failed',
            tag: message.tag,
            subscriptionId: subscription.id,
            status: outcome.status,
          });
          break;
        case 'unreachable':
          failed += 1;
          logger.warn({
            msg: 'push_failed',
            tag: message.tag,
            subscriptionId: subscription.id,
            status: 0,
          });
          break;
      }
    }
    return { attempts: subscriptions.length, sent, pruned, failed, skipped };
  }

  interface RoutineNotice {
    readonly title: string;
    readonly notify: boolean;
  }

  function routineOf(data: Readonly<Record<string, unknown>>): RoutineNotice | null {
    const routineId = data['routineId'];
    if (typeof routineId !== 'string' || routineId === '') return null;
    try {
      const routine = context.store.routines.get(routineId);
      return routine === null ? null : { title: routine.title, notify: routine.notify };
    } catch {
      return null;
    }
  }

  /** The reply's text is the push body, but only while it is still the chat's last message. */
  function replySummaryOf(record: EventRecord): string | null {
    if (record.type !== 'routine.replied') return null;
    const chatId = record.data['chatId'];
    const messageId = record.data['messageId'];
    if (typeof chatId !== 'string' || typeof messageId !== 'string') return null;
    try {
      const last = context.store.chats.lastMessage(chatId);
      return last !== null && last.id === messageId ? last.text : null;
    } catch {
      return null;
    }
  }

  function notificationTypeOf(type: string): NotificationType | null {
    return (NOTIFICATION_TYPES as readonly string[]).includes(type)
      ? (type as NotificationType)
      : null;
  }

  async function pump(): Promise<PushPumpReport> {
    let scanned = 0;
    let sent = 0;
    let heldCount = 0;
    let pruned = 0;
    let skipped = 0;
    if (!configured()) return { scanned, sent, held: heldCount, pruned, skipped };
    if (cursor === null) {
      // A restart never pushes the backlog.
      cursor = context.store.events.latestId();
      return { scanned, sent, held: heldCount, pruned, skipped };
    }

    const preferences = storage.preferences();
    const records = context.store.events.readAfterId(cursor, batchSize);
    let lastId = cursor;

    for (const record of records) {
      scanned += 1;
      lastId = record.id;
      const tag = deliveryKeyOf(record);
      if (tag === null) {
        skipped += 1;
        continue;
      }
      const type = notificationTypeOf(record.type);
      if (type === null) {
        skipped += 1;
        continue;
      }
      if (record.type === 'routine.fired' && record.data['kind'] === 'prompt') {
        skipped += 1;
        logger.debug({ msg: 'push_skipped', reason: 'routine_prompt', type, tag });
        continue;
      }
      const routine = routineOf(record.data);
      if (routine !== null && !routine.notify) {
        skipped += 1;
        logger.debug({ msg: 'push_skipped', reason: 'routine_muted', type, tag });
        continue;
      }
      if (!isEnabled(preferences, type)) {
        skipped += 1;
        logger.debug({ msg: 'push_skipped', reason: 'preference', type, tag });
        continue;
      }
      if (tagSet.has(tag)) {
        skipped += 1;
        logger.debug({ msg: 'push_skipped', reason: 'dedupe', type, tag });
        continue;
      }
      const message = messageFor({
        type,
        data: record.data,
        routineTitle: routine?.title ?? null,
        summary: replySummaryOf(record),
      });
      if (!isCritical(type) && quietNow(preferences.quietHours)) {
        held.push(message);
        recordTag(tag);
        heldCount += 1;
        logger.info({ msg: 'push_held', tag, type });
        continue;
      }
      const report = await deliverToSubscriptions(message);
      sent += report.sent;
      pruned += report.pruned;
      skipped += report.skipped + report.failed;
      // Recorded after processing whatever the transport answered, so a failing endpoint is
      // not retried on every tick.
      recordTag(tag);
    }

    // The cursor advances only once every send has settled.
    cursor = lastId;

    if (held.length > 0 && !quietNow(storage.preferences().quietHours)) {
      const pending = held.splice(0, held.length);
      for (const message of pending) {
        const report = await deliverToSubscriptions(message);
        sent += report.sent;
        pruned += report.pruned;
        skipped += report.skipped + report.failed;
      }
    }

    return { scanned, sent, held: heldCount, pruned, skipped };
  }

  function start(): void {
    if (timer !== null || !configured()) return;
    timer = setInterval(() => {
      if (running) return;
      running = true;
      void pump()
        .catch((error: unknown) => {
          logger.error({ msg: 'push_pump_failed', err: error });
        })
        .finally(() => {
          running = false;
        });
    }, pumpIntervalMs);
    timer.unref();
  }

  function stop(): void {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    configured,

    preferences(): NotificationPreferences {
      return storage.preferences();
    },

    updatePreferences(input: NotificationPreferences): NotificationPreferences {
      return storage.writePreferences({
        events: [...new Set(input.events)],
        quietHours: input.quietHours,
      });
    },

    listSubscriptions(): readonly PushSubscription[] {
      return storage.subscriptions();
    },

    subscribe(input: {
      readonly kind: PushKind;
      readonly endpoint: string;
      readonly keys: Readonly<Record<string, string>>;
    }): { readonly subscription: PushSubscription; readonly created: boolean } {
      const subscriptions = storage.subscriptions();
      const index = subscriptions.findIndex(
        (subscription) => subscription.endpoint === input.endpoint,
      );
      const existing = index === -1 ? undefined : subscriptions[index];
      if (existing !== undefined) {
        const replacement: PushSubscription = {
          id: existing.id,
          kind: input.kind,
          endpoint: input.endpoint,
          keys: { ...input.keys },
        };
        const next = [...subscriptions];
        next[index] = replacement;
        storage.writeSubscriptions(next);
        return { subscription: replacement, created: false };
      }
      if (subscriptions.length >= MAX_PUSH_SUBSCRIPTIONS) {
        throw new PushError('invalid_payload', 422, { reason: 'subscription_limit' });
      }
      const subscription: PushSubscription = {
        id: newSubscriptionId(random),
        kind: input.kind,
        endpoint: input.endpoint,
        keys: { ...input.keys },
      };
      storage.writeSubscriptions([...subscriptions, subscription]);
      return { subscription, created: true };
    },

    unsubscribe(id: string): boolean {
      return storage.removeSubscription(id);
    },

    pump,

    deliver(message: PushMessage): Promise<PushDeliveryReport> {
      return deliverToSubscriptions(message);
    },

    start,

    stop,
  };
}

function resolveTransports(
  options: CreatePushServiceOptions,
): Partial<Record<PushKind, PushTransport>> {
  if (options.transports !== undefined) return options.transports;
  const { config, logger } = options.context;
  const publicKey = config.CB_VAPID_PUBLIC_KEY;
  const privateKey = config.CB_VAPID_PRIVATE_KEY;
  const subject = config.CB_VAPID_SUBJECT;
  if (publicKey === null || privateKey === null || subject === null) {
    logger.info({ msg: 'push_unconfigured' });
    return {};
  }
  try {
    const vapid = createVapidSigner({
      publicKey,
      privateKey,
      subject,
      now: options.now ?? options.context.clock,
    });
    return { web: createWebPushTransport({ vapid }) };
  } catch (error) {
    const key = error instanceof PushError ? error.details?.['key'] : undefined;
    logger.error({ msg: 'push_config_invalid', key: key ?? 'CB_VAPID_PUBLIC_KEY' });
    return {};
  }
}
