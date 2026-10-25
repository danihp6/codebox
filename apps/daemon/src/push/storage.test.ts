import { afterEach, describe, expect, it } from 'vitest';
import type { NotificationPreferences, PushSubscription } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createLogger } from '../logger.js';
import {
  MAX_PUSH_SUBSCRIPTIONS,
  NOTIFICATION_PREFERENCES_KEY,
  PUSH_SUBSCRIPTIONS_KEY,
  createPushStorage,
} from './storage.js';

const TS = '2026-10-25T10:00:00.000Z';

const DEFAULTS: NotificationPreferences = {
  events: ['run.finished', 'run.failed', 'approval.created'],
  quietHours: null,
};

function subscription(id: string, endpoint = `https://push.example.com/${id}`): PushSubscription {
  return { id, kind: 'web', endpoint, keys: { p256dh: 'p', auth: 'a' } };
}

const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

interface Harness {
  readonly store: Store;
  readonly lines: Record<string, unknown>[];
  readonly storage: ReturnType<typeof createPushStorage>;
}

function harness(): Harness {
  const store = openInMemoryStore();
  stores.push(store);
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { store, lines, storage: createPushStorage(store, DEFAULTS, () => new Date(TS), logger) };
}

describe('push storage', () => {
  it('serves the defaults while both settings rows are absent', () => {
    const { storage } = harness();
    expect(storage.preferences()).toEqual(DEFAULTS);
    expect(storage.subscriptions()).toEqual([]);
  });

  it('round-trips the preferences through the settings row', () => {
    const { store, storage } = harness();
    const written: NotificationPreferences = { events: ['run.failed'], quietHours: '22:00-08:00' };
    expect(storage.writePreferences(written)).toEqual(written);
    expect(storage.preferences()).toEqual(written);
    expect(store.settings.get(NOTIFICATION_PREFERENCES_KEY)).toEqual(written);
  });

  it('round-trips the subscriptions through the settings row', () => {
    const { store, storage } = harness();
    const rows = [subscription('sub_01JABCDEFG'), subscription('sub_01JABCDEFH')];
    storage.writeSubscriptions(rows);
    expect(storage.subscriptions()).toEqual(rows);
    expect(store.settings.get(PUSH_SUBSCRIPTIONS_KEY)).toEqual(rows);
  });

  it('replaces a malformed preferences row by the default and logs the key once', () => {
    const { store, lines, storage } = harness();
    store.settings.set(NOTIFICATION_PREFERENCES_KEY, { events: 'nope', quietHours: null }, TS);
    expect(storage.preferences()).toEqual(DEFAULTS);
    expect(storage.preferences()).toEqual(DEFAULTS);
    const invalid = lines.filter((line) => line['msg'] === 'push_storage_invalid');
    expect(invalid).toHaveLength(1);
    // The logger redacts any field named `key`, so the frozen field ships masked: the setting
    // name is never allowed to carry a value that looks like a credential.
    expect(invalid[0]).toMatchObject({ level: 'warn', key: '[redacted]' });
    expect(JSON.stringify(invalid)).not.toContain('nope');
  });

  it('drops a malformed subscription entry and keeps the valid ones', () => {
    const { store, lines, storage } = harness();
    store.settings.set(
      PUSH_SUBSCRIPTIONS_KEY,
      [subscription('sub_01JABCDEFG'), { id: 'not-a-subscription' }],
      TS,
    );
    expect(storage.subscriptions()).toEqual([subscription('sub_01JABCDEFG')]);
    expect(lines.filter((line) => line['msg'] === 'push_storage_invalid')).toHaveLength(1);
  });

  it('degrades a non-array subscriptions row to the empty default', () => {
    const { store, lines, storage } = harness();
    store.settings.set(PUSH_SUBSCRIPTIONS_KEY, { id: 'sub_01JABCDEFG' }, TS);
    expect(storage.subscriptions()).toEqual([]);
    expect(lines.filter((line) => line['msg'] === 'push_storage_invalid')).toHaveLength(1);
  });

  it('removes a known subscription and reports an unknown id', () => {
    const { store, storage } = harness();
    storage.writeSubscriptions([subscription('sub_01JABCDEFG'), subscription('sub_01JABCDEFH')]);
    expect(storage.removeSubscription('sub_01JABCDEFG')).toBe(true);
    expect(storage.subscriptions()).toEqual([subscription('sub_01JABCDEFH')]);
    expect(store.settings.get(PUSH_SUBSCRIPTIONS_KEY)).toEqual([subscription('sub_01JABCDEFH')]);
    expect(storage.removeSubscription('sub_01JABCDEFG')).toBe(false);
  });

  it('exposes the twenty-subscription cap the route and the service share', () => {
    expect(MAX_PUSH_SUBSCRIPTIONS).toBe(20);
  });
});
