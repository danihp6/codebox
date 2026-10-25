import { parseNotificationPreferences, pushSubscriptionSchema } from '@codebox/contracts';
import type { NotificationPreferences, PushSubscription } from '@codebox/contracts';
import type { Store } from '@codebox/store';
import type { Logger } from '../logger.js';

export const NOTIFICATION_PREFERENCES_KEY = 'notifications.preferences';
export const PUSH_SUBSCRIPTIONS_KEY = 'push.subscriptions';
export const MAX_PUSH_SUBSCRIPTIONS = 20;

export interface PushStorage {
  preferences(): NotificationPreferences;
  writePreferences(value: NotificationPreferences): NotificationPreferences;
  subscriptions(): readonly PushSubscription[];
  writeSubscriptions(value: readonly PushSubscription[]): void;
  removeSubscription(id: string): boolean;
}

/**
 * Two settings rows, no table and no migration. A stored value that fails its contract is
 * replaced by the default and logged once per key: a corrupt row never reaches a route.
 */
export function createPushStorage(
  store: Store,
  defaults: NotificationPreferences,
  now: () => Date,
  logger?: Logger,
): PushStorage {
  const warned = new Set<string>();

  function markInvalid(key: string): void {
    if (warned.has(key)) return;
    warned.add(key);
    logger?.warn({ msg: 'push_storage_invalid', key });
  }

  function read(key: string): unknown {
    try {
      return store.settings.get(key);
    } catch {
      markInvalid(key);
      return undefined;
    }
  }

  function preferences(): NotificationPreferences {
    const value = read(NOTIFICATION_PREFERENCES_KEY);
    if (value === undefined) return defaults;
    try {
      return parseNotificationPreferences(value);
    } catch {
      markInvalid(NOTIFICATION_PREFERENCES_KEY);
      return defaults;
    }
  }

  function subscriptions(): readonly PushSubscription[] {
    const value = read(PUSH_SUBSCRIPTIONS_KEY);
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      markInvalid(PUSH_SUBSCRIPTIONS_KEY);
      return [];
    }
    const parsed: PushSubscription[] = [];
    let malformed = false;
    for (const entry of value) {
      const result = pushSubscriptionSchema.safeParse(entry);
      if (result.success) parsed.push(result.data);
      else malformed = true;
    }
    if (malformed) markInvalid(PUSH_SUBSCRIPTIONS_KEY);
    return parsed;
  }

  function writeSubscriptions(value: readonly PushSubscription[]): void {
    store.settings.set(PUSH_SUBSCRIPTIONS_KEY, value, now().toISOString());
  }

  return {
    preferences,

    writePreferences(value: NotificationPreferences): NotificationPreferences {
      store.settings.set(NOTIFICATION_PREFERENCES_KEY, value, now().toISOString());
      return value;
    },

    subscriptions,

    writeSubscriptions,

    removeSubscription(id: string): boolean {
      const current = subscriptions();
      const next = current.filter((subscription) => subscription.id !== id);
      if (next.length === current.length) return false;
      writeSubscriptions(next);
      return true;
    },
  };
}
