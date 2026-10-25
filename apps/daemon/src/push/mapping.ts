import type { NotificationPreferences, SseEventName } from '@codebox/contracts';

export const NOTIFICATION_TYPES = [
  'run.merged',
  'run.finished',
  'run.failed',
  'run.cancelled',
  'approval.created',
  'routine.fired',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DEFAULT_NOTIFICATION_EVENTS: readonly SseEventName[] = Object.freeze([
  'run.finished',
  'run.failed',
  'approval.created',
]);

export interface PushMessage {
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tag: string;
  readonly runId?: string;
  readonly chatId?: string;
  readonly routineId?: string;
}

const TITLE_MAX = 120;
const BODY_MAX = 240;
const ELLIPSIS = '…';

/**
 * A merged run and its `run.finished` share the `run:<runId>` tag, so subscribing to either or
 * both still yields one push for one run.
 */
const PREFERENCE_NAMES: Readonly<Record<NotificationType, readonly SseEventName[]>> = Object.freeze(
  {
    'run.merged': Object.freeze(['run.merged', 'run.finished'] as const),
    'run.finished': Object.freeze(['run.finished'] as const),
    'run.failed': Object.freeze(['run.failed'] as const),
    'run.cancelled': Object.freeze(['run.cancelled'] as const),
    'approval.created': Object.freeze(['approval.created'] as const),
    'routine.fired': Object.freeze(['routine.fired'] as const),
  },
);

/** Notifications are not a log mirror: only these six events carry a delivery key. */
export function deliveryKeyOf(record: {
  readonly type: SseEventName;
  readonly data: Readonly<Record<string, unknown>>;
}): string | null {
  switch (record.type) {
    case 'run.merged':
    case 'run.finished':
    case 'run.failed':
    case 'run.cancelled': {
      const runId = stringOf(record.data['runId']);
      return runId === null ? null : `run:${runId}`;
    }
    case 'approval.created': {
      const approvalId = stringOf(record.data['approvalId']);
      return approvalId === null ? null : `approval:${approvalId}`;
    }
    case 'routine.fired': {
      const routineId = stringOf(record.data['routineId']);
      const scheduledFor = stringOf(record.data['scheduledFor']);
      return routineId === null || scheduledFor === null
        ? null
        : `routine:${routineId}:${scheduledFor}`;
    }
    default:
      return null;
  }
}

export function preferenceNamesOf(type: NotificationType): readonly SseEventName[] {
  return PREFERENCE_NAMES[type];
}

export function isEnabled(preferences: NotificationPreferences, type: NotificationType): boolean {
  return PREFERENCE_NAMES[type].some((name) => preferences.events.includes(name));
}

export function isCritical(type: NotificationType): boolean {
  return type === 'approval.created';
}

export function messageFor(input: {
  readonly type: NotificationType;
  readonly data: Readonly<Record<string, unknown>>;
  readonly routineTitle?: string | null;
}): PushMessage {
  const { type, data } = input;
  const tag = deliveryKeyOf({ type, data });

  switch (type) {
    case 'run.merged': {
      const runId = stringOf(data['runId']);
      const number = numberAt(data['pr'], 'number');
      return finish({
        type,
        title: 'Run merged',
        body: `Pull request #${number ?? 0} was merged.`,
        url: `/runs/${runId ?? ''}`,
        tag: tag ?? type,
        ...(runId === null ? {} : { runId }),
      });
    }
    case 'run.finished': {
      const runId = stringOf(data['runId']);
      return finish({
        type,
        title: 'Run succeeded',
        body: `Run ${runId ?? ''} finished.`,
        url: `/runs/${runId ?? ''}`,
        tag: tag ?? type,
        ...(runId === null ? {} : { runId }),
      });
    }
    case 'run.failed': {
      const runId = stringOf(data['runId']);
      const code = stringOf(data['code']) ?? 'failed';
      const reason = stringOf(data['message']) ?? 'the run failed';
      return finish({
        type,
        title: 'Run failed',
        body: `${code}: ${reason}`,
        url: `/runs/${runId ?? ''}`,
        tag: tag ?? type,
        ...(runId === null ? {} : { runId }),
      });
    }
    case 'run.cancelled': {
      const runId = stringOf(data['runId']);
      const reason = stringOf(data['reason']);
      return finish({
        type,
        title: 'Run cancelled',
        body:
          reason === null
            ? `Run ${runId ?? ''} was cancelled.`
            : `Run ${runId ?? ''} was cancelled. reason: ${reason}`,
        url: `/runs/${runId ?? ''}`,
        tag: tag ?? type,
        ...(runId === null ? {} : { runId }),
      });
    }
    case 'approval.created': {
      const title = stringOf(data['title']) ?? 'Approval required';
      const runId = stringOf(data['runId']);
      const chatId = stringOf(data['chatId']);
      return finish({
        type,
        title,
        body: 'The agent is waiting for your approval.',
        url: '/approvals',
        tag: tag ?? type,
        ...(runId === null ? {} : { runId }),
        ...(chatId === null ? {} : { chatId }),
      });
    }
    case 'routine.fired': {
      const routineId = stringOf(data['routineId']);
      const title = input.routineTitle ?? 'Routine';
      return finish({
        type,
        title,
        body: data['kind'] === 'reminder' ? 'Reminder.' : 'A scheduled routine fired.',
        url: '/jobs',
        tag: tag ?? type,
        ...(routineId === null ? {} : { routineId }),
      });
    }
  }
}

function finish(message: PushMessage): PushMessage {
  return {
    ...message,
    title: fit(message.title, TITLE_MAX),
    body: fit(message.body, BODY_MAX),
  };
}

function fit(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}${ELLIPSIS}`;
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function numberAt(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}
