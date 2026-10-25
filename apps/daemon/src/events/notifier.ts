import type { DaemonContext } from '../modules.js';

export interface EventNotifier {
  notify(): void;
  wait(ms: number): Promise<void>;
}

// One notifier per daemon context, the same pattern as the authenticated device in
// `auth/middleware.ts`: a chat append wakes every open stream of that daemon and no other.
const NOTIFIERS = new WeakMap<object, EventNotifier>();

export function eventNotifier(context: DaemonContext): EventNotifier {
  const existing = NOTIFIERS.get(context);
  if (existing !== undefined) return existing;
  const created = createEventNotifier();
  NOTIFIERS.set(context, created);
  return created;
}

function createEventNotifier(): EventNotifier {
  const waiters = new Set<() => void>();
  return {
    notify(): void {
      for (const settle of [...waiters]) settle();
    },
    wait(ms: number): Promise<void> {
      return new Promise<void>((resolve) => {
        const settle = (): void => {
          clearTimeout(timer);
          waiters.delete(settle);
          resolve();
        };
        const timer = setTimeout(settle, Math.max(0, Math.trunc(ms)));
        timer.unref();
        waiters.add(settle);
      });
    },
  };
}
