import { describe, expect, it } from 'vitest';
import { eventFrame, gapFrame, heartbeatFrame, retryFrame } from './frames.js';

describe('SSE frames', () => {
  it('writes the advisory retry first', () => {
    expect(retryFrame(3000)).toBe('retry: 3000\n\n');
  });

  it('writes a heartbeat as a comment', () => {
    expect(heartbeatFrame()).toBe(': ping\n\n');
  });

  it('writes one event frame with the global id, the name and one JSON line', () => {
    const frame = eventFrame({
      id: 1842,
      event: 'run.output',
      data: { runId: 'run_01J', seq: 17, delta: '…', ts: '2026-10-24T18:04:02Z' },
    });
    expect(frame).toBe(
      'id: 1842\nevent: run.output\ndata: {"runId":"run_01J","seq":17,"delta":"…","ts":"2026-10-24T18:04:02Z"}\n\n',
    );
  });

  it('keeps the payload on one line even when the data carries a newline', () => {
    const frame = eventFrame({ id: 1, event: 'chat.delta', data: { delta: 'two\nlines' } });
    expect(frame.match(/\n/g)).toHaveLength(4);
    expect(frame.split('\n\n')[0]?.split('\n')).toHaveLength(3);
    expect(frame).toContain('"two\\nlines"');
  });

  it('writes a gap frame without an id', () => {
    const frame = gapFrame({ afterId: 1, latestId: 5, ts: '2026-10-25T10:00:00.000Z' });
    expect(frame).toBe(
      'event: gap\ndata: {"afterId":1,"latestId":5,"ts":"2026-10-25T10:00:00.000Z"}\n\n',
    );
    expect(frame.startsWith('id:')).toBe(false);
  });
});
