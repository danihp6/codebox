import type { SseEventName, SseStreamEvent } from '@codebox/contracts';
import type { RunEventItem, RunEventPage } from '../../core/api/api-client';

export const TIMELINE_DETAIL_MAX = 160;

export interface RunTimelineItem {
  readonly key: string;
  readonly seq: number | null;
  readonly type: SseEventName;
  readonly ts: string;
  readonly detail: string;
}

export function timelineKey(item: {
  readonly id?: number;
  readonly seq: number | null;
  readonly type: SseEventName;
  readonly data: Readonly<Record<string, unknown>>;
}): string | null {
  if (typeof item.seq === 'number') return `seq:${item.seq}`;
  const approvalId = item.data['approvalId'];
  if (typeof approvalId === 'string') return `approval:${approvalId}`;
  if (typeof item.id === 'number') return `id:${item.id}`;
  return null;
}

export function toTimelineItem(item: RunEventItem): RunTimelineItem {
  return {
    key: timelineKey(item) ?? `id:${item.id}`,
    seq: item.seq,
    type: item.type,
    ts: item.ts,
    detail: detailFor(item.type, item.data),
  };
}

export function fromStreamEvent(event: SseStreamEvent): RunTimelineItem | null {
  if (event.event === 'gap') return null;
  const data = event.data as Readonly<Record<string, unknown>>;
  const rawSeq = data['seq'];
  const seq = typeof rawSeq === 'number' ? rawSeq : null;
  const key = timelineKey({ seq, type: event.event, data });
  if (key === null) return null;
  return {
    key,
    seq,
    type: event.event,
    ts: event.data.ts,
    detail: detailFor(event.event, data),
  };
}

export function appendTimeline(
  current: readonly RunTimelineItem[],
  next: RunTimelineItem,
): readonly RunTimelineItem[] {
  if (current.some((item) => item.key === next.key)) return current;
  return [...current, next];
}

export function mergePage(
  current: readonly RunTimelineItem[],
  page: RunEventPage,
): readonly RunTimelineItem[] {
  let merged = current;
  for (const item of page.data) {
    merged = appendTimeline(merged, toTimelineItem(item));
  }
  return merged;
}

function detailFor(type: SseEventName, data: Readonly<Record<string, unknown>>): string {
  switch (type) {
    case 'run.queued':
      return pick(data, 'trigger');
    case 'run.started':
      return pick(data, 'branch');
    case 'run.output':
      return pick(data, 'delta');
    case 'run.tool': {
      const head = `${pick(data, 'tool')} ${pick(data, 'status')}`;
      const extra = pick(data, 'detail');
      return extra === '' ? head : `${head}: ${extra}`;
    }
    case 'run.permission':
      return `${pick(data, 'tool')}: ${pick(data, 'title')}`;
    case 'run.gate': {
      const gate = asRecord(data['gate']);
      if (gate === null) return '';
      return `${pick(gate, 'status')} (exit ${pick(gate, 'exitCode')})`;
    }
    case 'run.pr': {
      const pr = asRecord(data['pr']);
      return pr === null ? '' : pick(pr, 'url');
    }
    case 'run.merged':
      return pick(data, 'mergeCommit');
    case 'run.finished':
      return '';
    case 'run.failed':
      return `${pick(data, 'code')}: ${pick(data, 'message')}`;
    case 'run.cancelled':
      return pick(data, 'reason');
    case 'approval.created':
      return `${pick(data, 'tool')}: ${pick(data, 'title')}`;
    default:
      return '';
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Readonly<Record<string, unknown>>;
}

function pick(data: Readonly<Record<string, unknown>>, key: string): string {
  const value = data[key];
  const text = typeof value === 'string' ? value : typeof value === 'number' ? `${value}` : '';
  return oneLine(text);
}

function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= TIMELINE_DETAIL_MAX) return collapsed;
  return `${collapsed.slice(0, TIMELINE_DETAIL_MAX)}…`;
}
