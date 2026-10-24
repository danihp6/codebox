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
