import { describe, expect, it } from 'vitest';
import { ContractParseError } from './parse.js';
import { SSE_EVENT_NAMES } from './primitives.js';
import type { SseEventData, SseEventName } from './index.js';
import {
  SSE_HEARTBEAT_SECONDS,
  SSE_RETRY_MS,
  parseSseEvent,
  parseSseStreamEvent,
  sseStreamEventSchema,
} from './events.js';

const ts = '2026-10-24T18:04:02Z';
const runId = 'run_01JABCDEFG';
const chatId = 'chat_01JABCDEFG';
const approvalId = 'apv_01JABCDEFG';
const jobId = 'job_01JABCDEFG';
const repoId = 'repo_01JABCDEFG';
const routineId = 'rtn_01JABCDEFG';
const messageId = 'msg_01JABCDEFG';
const workId = 'wrk_01JABCDEFG';
const sessionId = 'sess_01JABCDEFG';
const accountId = 'acct_01JABCDEFG';
const scheduleId = 'sch_01JABCDEFG';

const pr = { number: 42, url: 'https://github.com/dani/example/pull/42', mergeable: true };
const gate = { status: 'passed', exitCode: 0, durationMs: 184000 };

const fixtures: Readonly<Record<SseEventName, { event: SseEventName; data: unknown }>> = {
  'run.queued': {
    event: 'run.queued',
    data: { runId, seq: 1, ts, repoId, jobId, trigger: 'schedule' },
  },
  'run.started': {
    event: 'run.started',
    data: { runId, seq: 2, ts, branch: 'cb/run_01J-nightly' },
  },
  'run.output': { event: 'run.output', data: { runId, seq: 17, ts, delta: 'Working tree clean.' } },
  'run.tool': {
    event: 'run.tool',
    data: { runId, seq: 18, ts, tool: 'bash', status: 'start', detail: 'npm test' },
  },
  'run.permission': {
    event: 'run.permission',
    data: { runId, seq: 19, ts, approvalId, tool: 'bash', title: 'Run npm test' },
  },
  'run.gate': { event: 'run.gate', data: { runId, seq: 20, ts, gate } },
  'run.pr': { event: 'run.pr', data: { runId, seq: 21, ts, pr } },
  'run.merged': {
    event: 'run.merged',
    data: { runId, seq: 22, ts, pr, mergeCommit: 'a1b2c3d', method: 'squash' },
  },
  'run.finished': { event: 'run.finished', data: { runId, seq: 23, ts, state: 'succeeded' } },
  'run.failed': {
    event: 'run.failed',
    data: { runId, seq: 24, ts, state: 'failed', code: 'gate_failed', message: 'gate exited 1' },
  },
  'run.cancelled': {
    event: 'run.cancelled',
    data: { runId, seq: 25, ts, state: 'cancelled', reason: 'operator' },
  },
  'chat.delta': { event: 'chat.delta', data: { chatId, seq: 1, ts, delta: 'Hola' } },
  'chat.message': {
    event: 'chat.message',
    data: {
      chatId,
      seq: 2,
      ts,
      message: {
        id: 'msg_01JABCDEFG',
        chatId,
        role: 'assistant',
        text: 'Hola, ¿qué toco?',
        createdAt: ts,
      },
    },
  },
  'chat.tool': {
    event: 'chat.tool',
    data: { chatId, seq: 3, ts, tool: 'bash', status: 'ok' },
  },
  'chat.permission': {
    event: 'chat.permission',
    data: { chatId, seq: 4, ts, approvalId, tool: 'bash', title: 'Run npm test' },
  },
  'chat.idle': { event: 'chat.idle', data: { chatId, seq: 5, ts } },
  'chat.compacted': { event: 'chat.compacted', data: { chatId, seq: 6, ts, contextEpoch: 2 } },
  'job.changed': { event: 'job.changed', data: { jobId, change: 'updated', ts } },
  'approval.created': {
    event: 'approval.created',
    data: {
      approvalId,
      runId,
      chatId: null,
      tool: 'bash',
      title: 'Run npm test',
      expiresAt: '2026-10-24T18:14:02Z',
      ts,
    },
  },
  'approval.resolved': {
    event: 'approval.resolved',
    data: { approvalId, decision: 'allow', ts },
  },
  telemetry: {
    event: 'telemetry',
    data: {
      ts,
      health: {
        status: 'ok',
        db: 'ok',
        opencode: 'ok',
        disk: { freeBytes: 73400320000, totalBytes: 107374182400, usedPercent: 31.6 },
        queue: { pending: 0, running: 1, maxConcurrency: 2 },
        version: '1.0.0',
      },
      spendTodayUsd: 1.25,
      queueDepth: 1,
    },
  },
  'routine.fired': {
    event: 'routine.fired',
    data: { routineId, kind: 'prompt', scheduledFor: '2026-10-24T07:00:00Z', ts },
  },
  'routine.replied': {
    event: 'routine.replied',
    data: { routineId, chatId, messageId, ts },
  },
  'routine.failed': {
    event: 'routine.failed',
    data: { routineId, code: 'chat_unavailable', message: 'No chat could be opened.', ts },
  },
  'work.created': {
    event: 'work.created',
    data: { workId, seq: 1, ts, repoId, backlogRef: 'Task-35', origin: 'backlog' },
  },
  'work.updated': {
    event: 'work.updated',
    data: { workId, seq: 2, ts, state: 'running', attempts: 1 },
  },
  'work.needs_decision': {
    event: 'work.needs_decision',
    data: { workId, seq: 3, ts, reason: 'the gate is ambiguous' },
  },
  'work.closed': { event: 'work.closed', data: { workId, seq: 4, ts, state: 'merged' } },
  'session.created': {
    event: 'session.created',
    data: { sessionId, seq: 1, ts, repoId, target: 'work', workId },
  },
  'session.delta': { event: 'session.delta', data: { sessionId, seq: 2, ts, delta: 'Hola' } },
  'session.tool': {
    event: 'session.tool',
    data: { sessionId, seq: 3, ts, tool: 'edit', status: 'ok' },
  },
  'session.proposal': {
    event: 'session.proposal',
    data: {
      sessionId,
      seq: 4,
      ts,
      proposal: {
        branch: 'cb/design-edit',
        sha: '9f1c2ab',
        paths: ['design/tokens/core.json'],
        createdAt: ts,
      },
    },
  },
  'session.closed': {
    event: 'session.closed',
    data: { sessionId, seq: 5, ts, status: 'archived' },
  },
  'schedule.fired': {
    event: 'schedule.fired',
    data: { scheduleId, scheduledFor: '2026-10-24T07:00:00Z', workId, runId, ts },
  },
  'schedule.skipped': {
    event: 'schedule.skipped',
    data: { scheduleId, scheduledFor: '2026-10-24T07:00:00Z', reason: 'nothing_pending', ts },
  },
  'provider.state': {
    event: 'provider.state',
    data: {
      providerId: 'opencode-go',
      accountId: accountId,
      state: 'exhausted',
      resetAt: '2026-10-24T15:00:00Z',
      ts,
    },
  },
  'backlog.changed': {
    event: 'backlog.changed',
    data: { repoId, revision: '9f1c2ab', ts },
  },
  'design.changed': {
    event: 'design.changed',
    data: { repoId, revision: '9f1c2ab', ts },
  },
};

function parseError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (thrown) {
    return thrown;
  }
  return null;
}

describe('events', () => {
  it('every event fixture parses', () => {
    expect(Object.keys(fixtures).sort()).toEqual([...SSE_EVENT_NAMES].sort());
    for (const name of SSE_EVENT_NAMES) {
      const fixture = fixtures[name];
      expect(fixture, name).toBeDefined();
      const parsed = parseSseEvent(fixture);
      expect(parsed, name).toEqual(fixture);
      expect(parsed.event, name).toBe(name);
    }
    expect(SSE_RETRY_MS).toBe(3000);
    expect(SSE_HEARTBEAT_SECONDS).toBe(15);
  });

  it('rejects an unknown event name', () => {
    const error = parseError(() => parseSseEvent({ event: 'run.promoted', data: {} }));
    expect(error).toBeInstanceOf(ContractParseError);
  });

  it('names the failing field inside data', () => {
    const missingRunId = parseError(() =>
      parseSseEvent({ event: 'run.output', data: { seq: 17, ts, delta: 'x' } }),
    );
    expect(missingRunId instanceof ContractParseError ? missingRunId.first.path : null).toBe(
      'event.data.runId',
    );

    const missingDelta = parseError(() =>
      parseSseEvent({ event: 'run.output', data: { runId, seq: 17, ts } }),
    );
    expect(missingDelta instanceof ContractParseError ? missingDelta.first.path : null).toBe(
      'event.data.delta',
    );

    const missingSeq = parseError(() =>
      parseSseEvent({ event: 'run.output', data: { runId, ts } }),
    );
    expect(missingSeq instanceof ContractParseError ? missingSeq.first.path : null).toBe(
      'event.data.seq',
    );

    const zeroSeq = parseError(() =>
      parseSseEvent({ event: 'run.output', data: { runId, seq: 0, ts, delta: 'x' } }),
    );
    expect(zeroSeq instanceof ContractParseError ? zeroSeq.first.path : null).toBe(
      'event.data.seq',
    );
  });

  it('rejects an event payload that carries an unknown field', () => {
    const error = parseError(() =>
      parseSseEvent({ event: 'run.output', data: { runId, seq: 1, ts, delta: 'x', tool: 'bash' } }),
    );
    expect(error instanceof ContractParseError ? error.first.path : null).toBe('event.data.tool');
  });

  it('carries the context epoch of a compacted chat', () => {
    const compacted = { event: 'chat.compacted', data: { chatId, seq: 6, ts, contextEpoch: 2 } };
    expect(parseSseEvent(compacted)).toEqual(compacted);
    expect(sseStreamEventSchema.safeParse(compacted).success).toBe(true);
    const missing = parseError(() =>
      parseSseEvent({ event: 'chat.compacted', data: { chatId, seq: 6, ts } }),
    );
    expect(missing instanceof ContractParseError ? missing.first.path : null).toBe(
      'event.data.contextEpoch',
    );
    const zero = parseError(() =>
      parseSseEvent({ event: 'chat.compacted', data: { chatId, seq: 6, ts, contextEpoch: 0 } }),
    );
    expect(zero instanceof ContractParseError ? zero.first.path : null).toBe(
      'event.data.contextEpoch',
    );
    const data: SseEventData['chat.compacted'] = { chatId, seq: 6, ts, contextEpoch: 3 };
    expect(data.contextEpoch).toBe(3);
  });

  it('routine events are global and carry no per-run seq', () => {
    const fired = parseSseEvent({
      event: 'routine.fired',
      data: { routineId, kind: 'reminder', scheduledFor: ts, ts },
    });
    expect(fired.event).toBe('routine.fired');
    const withSeq = parseError(() =>
      parseSseEvent({
        event: 'routine.fired',
        data: { routineId, kind: 'reminder', scheduledFor: ts, ts, seq: 1 },
      }),
    );
    expect(withSeq instanceof ContractParseError ? withSeq.first.path : null).toBe(
      'event.data.seq',
    );
    const replied: SseEventData['routine.replied'] = { routineId, chatId, messageId, ts };
    expect(replied.messageId).toBe(messageId);
    const failed: SseEventData['routine.failed'] = {
      routineId,
      code: 'chat_unavailable',
      message: 'x',
    };
    expect(failed.code).toBe('chat_unavailable');
  });

  it('accepts the gap control frame on the stream union only', () => {
    const gap = { event: 'gap', data: { afterId: 1841, latestId: 2000, ts } };
    expect(parseSseStreamEvent(gap)).toEqual(gap);
    expect(sseStreamEventSchema.safeParse(fixtures['run.output']).success).toBe(true);
    const asEvent = parseError(() => parseSseEvent(gap));
    expect(asEvent).toBeInstanceOf(ContractParseError);
  });

  it('exposes the documented data type per event name', () => {
    const data: SseEventData['run.output'] = { runId, seq: 17, ts, delta: 'x' };
    expect(data.delta).toBe('x');
    const queued: SseEventData['run.queued'] = {
      runId,
      seq: 1,
      ts,
      repoId,
      jobId: null,
      trigger: 'manual',
    };
    expect(queued.trigger).toBe('manual');
  });
});
