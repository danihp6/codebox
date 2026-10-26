import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_EVENTS,
  NOTIFICATION_TYPES,
  deliveryKeyOf,
  isCritical,
  isEnabled,
  messageFor,
  preferenceNamesOf,
} from './mapping.js';

const RUN_ID = 'run_01JABCDEFG';
const APPROVAL_ID = 'apv_01JABCDEFG';
const ROUTINE_ID = 'rtn_01JABCDEFG';
const CHAT_ID = 'chat_01JABCDEFG';
const MESSAGE_ID = 'msg_01JABCDEFG';
const SCHEDULED_FOR = '2026-11-10T07:00:00.000Z';
const PR = {
  number: 42,
  url: 'https://github.com/acme/widgets/pull/42',
  mergeable: true,
};

describe('notification delivery keys', () => {
  it('shares one tag per run across merged, finished, failed and cancelled', () => {
    for (const type of ['run.merged', 'run.finished', 'run.failed', 'run.cancelled'] as const) {
      expect(deliveryKeyOf({ type, data: { runId: RUN_ID } })).toBe(`run:${RUN_ID}`);
    }
  });

  it('tags an approval, a routine fire and a routine reply', () => {
    expect(deliveryKeyOf({ type: 'approval.created', data: { approvalId: APPROVAL_ID } })).toBe(
      `approval:${APPROVAL_ID}`,
    );
    expect(
      deliveryKeyOf({
        type: 'routine.fired',
        data: { routineId: ROUTINE_ID, scheduledFor: SCHEDULED_FOR },
      }),
    ).toBe(`routine:${ROUTINE_ID}:${SCHEDULED_FOR}`);
    expect(
      deliveryKeyOf({
        type: 'routine.replied',
        data: { routineId: ROUTINE_ID, chatId: CHAT_ID, messageId: MESSAGE_ID },
      }),
    ).toBe(`routine:${ROUTINE_ID}:${MESSAGE_ID}`);
  });

  it('is not eligible for anything else in the log', () => {
    const ineligible = [
      'run.queued',
      'run.started',
      'run.output',
      'run.tool',
      'run.permission',
      'run.gate',
      'run.pr',
      'chat.delta',
      'chat.message',
      'chat.tool',
      'chat.permission',
      'chat.idle',
      'job.changed',
      'approval.resolved',
      'telemetry',
      'routine.failed',
    ] as const;
    for (const type of ineligible) {
      expect(deliveryKeyOf({ type, data: { runId: RUN_ID } })).toBeNull();
    }
  });

  it('is not eligible when the identifying field is missing', () => {
    expect(deliveryKeyOf({ type: 'run.finished', data: {} })).toBeNull();
    expect(deliveryKeyOf({ type: 'approval.created', data: { approvalId: '' } })).toBeNull();
    expect(deliveryKeyOf({ type: 'routine.fired', data: { routineId: ROUTINE_ID } })).toBeNull();
    expect(
      deliveryKeyOf({ type: 'routine.replied', data: { routineId: ROUTINE_ID, chatId: CHAT_ID } }),
    ).toBeNull();
  });
});

describe('notification preferences', () => {
  it('defaults to finished, failed and approval', () => {
    expect(DEFAULT_NOTIFICATION_EVENTS).toEqual(['run.finished', 'run.failed', 'approval.created']);
    expect(NOTIFICATION_TYPES).toHaveLength(7);
  });

  it('names the preference that enables each type', () => {
    expect(preferenceNamesOf('run.merged')).toEqual(['run.merged', 'run.finished']);
    expect(preferenceNamesOf('routine.replied')).toEqual(['routine.fired', 'routine.replied']);
    for (const type of NOTIFICATION_TYPES) {
      if (type === 'run.merged' || type === 'routine.replied') continue;
      expect(preferenceNamesOf(type)).toEqual([type]);
    }
  });

  it('enables a written routine reply through either routine preference', () => {
    expect(isEnabled({ events: ['routine.fired'], quietHours: null }, 'routine.replied')).toBe(
      true,
    );
    expect(isEnabled({ events: ['routine.replied'], quietHours: null }, 'routine.replied')).toBe(
      true,
    );
    expect(isEnabled({ events: ['run.failed'], quietHours: null }, 'routine.replied')).toBe(false);
  });

  it('enables a merged run through either preference', () => {
    expect(isEnabled({ events: ['run.finished'], quietHours: null }, 'run.merged')).toBe(true);
    expect(isEnabled({ events: ['run.merged'], quietHours: null }, 'run.finished')).toBe(false);
    expect(isEnabled({ events: ['run.merged'], quietHours: null }, 'run.merged')).toBe(true);
  });

  it('only counts an approval as critical', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(isCritical(type)).toBe(type === 'approval.created');
    }
  });
});

describe('push messages', () => {
  it('describes a merged run', () => {
    const message = messageFor({
      type: 'run.merged',
      data: { runId: RUN_ID, pr: PR, mergeCommit: 'a'.repeat(40), method: 'squash' },
    });
    expect(message).toEqual({
      type: 'run.merged',
      title: 'Run merged',
      body: 'Pull request #42 was merged.',
      url: `/runs/${RUN_ID}`,
      tag: `run:${RUN_ID}`,
      runId: RUN_ID,
    });
  });

  it('describes a finished run', () => {
    const message = messageFor({
      type: 'run.finished',
      data: { runId: RUN_ID, state: 'succeeded' },
    });
    expect(message.title).toBe('Run succeeded');
    expect(message.body).toBe(`Run ${RUN_ID} finished.`);
    expect(message.url).toBe(`/runs/${RUN_ID}`);
  });

  it('carries the failure code and message', () => {
    const message = messageFor({
      type: 'run.failed',
      data: { runId: RUN_ID, state: 'failed', code: 'gate_failed', message: 'npm test failed' },
    });
    expect(message.title).toBe('Run failed');
    expect(message.body).toBe('gate_failed: npm test failed');
  });

  it('appends the cancellation reason when the event carries one', () => {
    const plain = messageFor({
      type: 'run.cancelled',
      data: { runId: RUN_ID, state: 'cancelled' },
    });
    expect(plain.body).toBe(`Run ${RUN_ID} was cancelled.`);
    const reasoned = messageFor({
      type: 'run.cancelled',
      data: { runId: RUN_ID, state: 'cancelled', reason: 'operator stopped it' },
    });
    expect(reasoned.body).toBe(`Run ${RUN_ID} was cancelled. reason: operator stopped it`);
  });

  it('points an approval at the approvals screen and omits a null link', () => {
    const message = messageFor({
      type: 'approval.created',
      data: { approvalId: APPROVAL_ID, title: 'Run the gate', runId: null, chatId: null },
    });
    expect(message).toEqual({
      type: 'approval.created',
      title: 'Run the gate',
      body: 'The agent is waiting for your approval.',
      url: '/approvals',
      tag: `approval:${APPROVAL_ID}`,
    });
    expect('runId' in message).toBe(false);
    expect('chatId' in message).toBe(false);

    const linked = messageFor({
      type: 'approval.created',
      data: { approvalId: APPROVAL_ID, title: 'Run the gate', runId: RUN_ID, chatId: 'chat_01J' },
    });
    expect(linked.runId).toBe(RUN_ID);
    expect(linked.chatId).toBe('chat_01J');
  });

  it('uses the routine title and the reminder body', () => {
    const reminder = messageFor({
      type: 'routine.fired',
      data: { routineId: ROUTINE_ID, scheduledFor: SCHEDULED_FOR, kind: 'reminder' },
      routineTitle: 'Take the pill',
    });
    expect(reminder).toEqual({
      type: 'routine.fired',
      title: 'Take the pill',
      body: 'Reminder.',
      url: '/jobs',
      tag: `routine:${ROUTINE_ID}:${SCHEDULED_FOR}`,
      routineId: ROUTINE_ID,
    });
    const prompt = messageFor({
      type: 'routine.fired',
      data: { routineId: ROUTINE_ID, scheduledFor: SCHEDULED_FOR, kind: 'prompt' },
      routineTitle: null,
    });
    expect(prompt.title).toBe('Routine');
    expect(prompt.body).toBe('A scheduled routine fired.');
  });

  it('turns a routine reply into a summary push that links to the chat', () => {
    const message = messageFor({
      type: 'routine.replied',
      data: { routineId: ROUTINE_ID, chatId: CHAT_ID, messageId: MESSAGE_ID },
      routineTitle: 'Morning summary',
      summary: 'Nine bullets about the repository.',
    });
    expect(message).toEqual({
      type: 'routine.replied',
      title: 'Morning summary',
      body: 'Nine bullets about the repository.',
      url: `/chat/${CHAT_ID}`,
      tag: `routine:${ROUTINE_ID}:${MESSAGE_ID}`,
      routineId: ROUTINE_ID,
      chatId: CHAT_ID,
    });

    const fallback = messageFor({
      type: 'routine.replied',
      data: { routineId: ROUTINE_ID, chatId: CHAT_ID, messageId: MESSAGE_ID },
      routineTitle: null,
      summary: null,
    });
    expect(fallback.title).toBe('Routine');
    expect(fallback.body).toBe('Your routine answered in chat.');
  });

  it('truncates the title to 120 and the body to 240 with one ellipsis', () => {
    const message = messageFor({
      type: 'approval.created',
      data: { approvalId: APPROVAL_ID, title: 'x'.repeat(200), runId: null, chatId: null },
    });
    expect(message.title).toHaveLength(120);
    expect(message.title.endsWith('…')).toBe(true);
    expect(message.title).toBe(`${'x'.repeat(119)}…`);

    const failed = messageFor({
      type: 'run.failed',
      data: { runId: RUN_ID, state: 'failed', code: 'gate_failed', message: 'y'.repeat(400) },
    });
    expect(failed.body).toHaveLength(240);
    expect(failed.body.endsWith('…')).toBe(true);
  });
});
