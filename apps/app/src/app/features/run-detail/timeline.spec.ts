import type { SseEventName } from '@codebox/contracts';
import { describe, expect, it } from 'vitest';
import type { RunEventItem, RunEventPage } from '../../core/api/api-client';
import {
  TIMELINE_DETAIL_MAX,
  appendTimeline,
  fromStreamEvent,
  mergePage,
  timelineKey,
  toTimelineItem,
} from './timeline';

const TS = '2026-10-24T18:04:02Z';

function eventItem(
  type: SseEventName,
  data: Readonly<Record<string, unknown>>,
  seq: number | null = 1,
  id = 10,
): RunEventItem {
  return { id, seq, type, data, ts: TS };
}

function page(items: readonly RunEventItem[], nextCursor: string | null = null): RunEventPage {
  return { data: items, nextCursor };
}

describe('timelineKey', () => {
  it('prefers the per-run sequence over every other identity', () => {
    expect(timelineKey({ id: 7, seq: 4, type: 'run.output', data: { approvalId: 'apv_1' } })).toBe(
      'seq:4',
    );
  });

  it('keys a frameless approval event by its approval id', () => {
    expect(
      timelineKey({ id: 7, seq: null, type: 'approval.created', data: { approvalId: 'apv_1' } }),
    ).toBe('approval:apv_1');
  });

  it('falls back to the global id, then to null', () => {
    expect(timelineKey({ id: 7, seq: null, type: 'telemetry', data: {} })).toBe('id:7');
    expect(timelineKey({ seq: null, type: 'telemetry', data: {} })).toBeNull();
    expect(
      timelineKey({ seq: null, type: 'approval.created', data: { approvalId: 42 } }),
    ).toBeNull();
  });
});

describe('toTimelineItem', () => {
  it('renders one line per event type of the contract table', () => {
    const cases: ReadonlyArray<readonly [SseEventName, Readonly<Record<string, unknown>>, string]> =
      [
        ['run.queued', { trigger: 'manual' }, 'manual'],
        ['run.started', { branch: 'cb/run-1' }, 'cb/run-1'],
        ['run.output', { delta: 'hello\nworld' }, 'hello world'],
        ['run.tool', { tool: 'bash', status: 'ok' }, 'bash ok'],
        ['run.tool', { tool: 'bash', status: 'error', detail: 'exit 1' }, 'bash error: exit 1'],
        ['run.permission', { tool: 'bash', title: 'Run a command' }, 'bash: Run a command'],
        [
          'run.gate',
          { gate: { status: 'passed', exitCode: 0, durationMs: 184000 } },
          'passed (exit 0)',
        ],
        ['run.pr', { pr: { number: 7, url: 'https://github.com/o/r/pull/7' } }, 'https://github.com/o/r/pull/7'],
        ['run.merged', { mergeCommit: 'abc1234' }, 'abc1234'],
        ['run.finished', { state: 'succeeded' }, ''],
        ['run.failed', { code: 'gate_failed', message: 'Gate is red' }, 'gate_failed: Gate is red'],
        ['run.cancelled', { reason: 'operator' }, 'operator'],
        ['run.cancelled', {}, ''],
        ['approval.created', { tool: 'bash', title: 'Run a command' }, 'bash: Run a command'],
        ['chat.delta', { delta: 'x' }, ''],
      ];

    for (const [type, data, expected] of cases) {
      expect(toTimelineItem(eventItem(type, data)).detail).toBe(expected);
    }
  });

  it('collapses whitespace and truncates with a single ellipsis', () => {
    const long = `${'a'.repeat(100)}  ${'b'.repeat(200)}`;
    const detail = toTimelineItem(eventItem('run.output', { delta: long })).detail;

    expect(detail).not.toMatch(/\s{2,}/);
    expect(detail.length).toBe(TIMELINE_DETAIL_MAX + 1);
    expect(detail.endsWith('…')).toBe(true);
    expect(detail.indexOf('…')).toBe(TIMELINE_DETAIL_MAX);
  });

  it('carries the run identity and the event timestamp unchanged', () => {
    const item = toTimelineItem(eventItem('run.output', { delta: 'x' }, 9, 44));

    expect(item).toMatchObject({ key: 'seq:9', seq: 9, type: 'run.output', ts: TS });
  });
});

describe('appendTimeline', () => {
  const first = toTimelineItem(eventItem('run.output', {}, 1));

  it('appends an unseen key', () => {
    const next = toTimelineItem(eventItem('run.output', {}, 2));
    expect(appendTimeline([first], next).map((item) => item.key)).toEqual(['seq:1', 'seq:2']);
  });

  it('returns the same array when the key is present', () => {
    const current = [first];
    expect(appendTimeline(current, toTimelineItem(eventItem('run.output', {}, 1)))).toBe(current);
  });
});

describe('mergePage', () => {
  it('appends the page in data order and skips what is already there', () => {
    const current = [toTimelineItem(eventItem('run.output', {}, 1))];
    const merged = mergePage(
      current,
      page([
        eventItem('run.output', {}, 1),
        eventItem('run.output', {}, 2),
        eventItem('run.started', {}, 3),
      ]),
    );

    expect(merged.map((item) => item.key)).toEqual(['seq:1', 'seq:2', 'seq:3']);
  });

  it('returns the same array when every key is known', () => {
    const current = [toTimelineItem(eventItem('run.output', {}, 1))];
    expect(mergePage(current, page([eventItem('run.output', {}, 1)]))).toBe(current);
  });
});

describe('fromStreamEvent', () => {
  it('keys a run event by its per-run sequence', () => {
    const item = fromStreamEvent({
      event: 'run.output',
      data: { runId: 'run_x', seq: 17, ts: TS, delta: 'built' },
    });

    expect(item).toMatchObject({ key: 'seq:17', seq: 17, type: 'run.output', detail: 'built' });
  });

  it('keys an approval event by its approval id', () => {
    const item = fromStreamEvent({
      event: 'approval.created',
      data: {
        approvalId: 'apv_01JABCDEFGHJKMNPQRSV',
        runId: 'run_x',
        chatId: null,
        tool: 'bash',
        title: 'Run a command',
        expiresAt: TS,
        ts: TS,
      },
    });

    expect(item).toMatchObject({ key: 'approval:apv_01JABCDEFGHJKMNPQRSV', seq: null });
  });

  it('drops an event with neither a sequence nor an approval id', () => {
    expect(
      fromStreamEvent({
        event: 'job.changed',
        data: { jobId: 'job_01JABCDEFGHJKMNPQRSV', change: 'updated', ts: TS },
      }),
    ).toBeNull();
  });

  it('drops a gap frame', () => {
    expect(
      fromStreamEvent({ event: 'gap', data: { afterId: 4, latestId: 9, ts: TS } }),
    ).toBeNull();
  });
});
