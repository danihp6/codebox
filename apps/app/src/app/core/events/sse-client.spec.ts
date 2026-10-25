import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSseClient, parseSseChunk } from './sse-client';
import type { SseClient, SseFrame } from './sse-client';

interface RecordedRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

function streamResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('parseSseChunk', () => {
  it('keeps a partial frame in the remainder', () => {
    const parsed = parseSseChunk('id: 1\nevent: run.output\ndata: {"a":1}\n\nid: 2\ndata: par');
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0]).toEqual({ id: '1', event: 'run.output', data: '{"a":1}' });
    expect(parsed.rest).toBe('id: 2\ndata: par');
  });

  it('defaults the event name to message and ignores comments and retry', () => {
    const parsed = parseSseChunk(': ping\nretry: 3000\nid: 5\ndata: one\ndata: two\n\n');
    expect(parsed.frames).toEqual([{ id: '5', event: 'message', data: 'one\ntwo' }]);
    expect(parsed.rest).toBe('');
  });
});

describe('createSseClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reconnects with backoff and resumes from Last-Event-ID', async () => {
    const requests: RecordedRequest[] = [];
    const delays: number[] = [];
    const frames: SseFrame[] = [];
    let calls = 0;
    let client: SseClient | null = null;

    const fetchStub = (url: string, init: RequestInit): Promise<Response> => {
      requests.push({ url, headers: init.headers as Record<string, string> });
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          streamResponse([
            'id: 7\nevent: run.output\ndata: {"runId":"run_01JABCDEFGHJKMNPQRSV","seq":1}\n\n',
          ]),
        );
      }
      return Promise.resolve(streamResponse([]));
    };

    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
      if (delays.length === 3) client?.stop();
      await Promise.resolve();
    };

    client = createSseClient({
      url: '/v1/events',
      token: () => 'access-token',
      fetch: fetchStub,
      sleep,
      random: () => 0.5,
      onFrame: (frame) => {
        frames.push(frame);
        if (frame.id === '7') client?.markProcessed(7);
      },
      onGap: () => undefined,
      onState: () => undefined,
    });

    client.start(0);

    await vi.waitFor(() => expect(delays).toHaveLength(3), { timeout: 5000 });

    expect(delays).toEqual([1000, 2000, 4000]);
    expect(frames[0]?.id).toBe('7');
    expect(requests).toHaveLength(3);
    expect(requests[0]?.headers['last-event-id']).toBe('0');
    expect(requests[2]?.headers['last-event-id']).toBe('7');
    expect(requests[0]?.headers['authorization']).toBe('Bearer access-token');
    expect(requests[0]?.headers['accept']).toBe('text/event-stream');
  });

  it('calls onGap and reopens from the latest id', async () => {
    const requests: RecordedRequest[] = [];
    const delays: number[] = [];
    const gaps: { afterId: number; latestId: number }[] = [];
    let calls = 0;
    let client: SseClient | null = null;

    const fetchStub = (url: string, init: RequestInit): Promise<Response> => {
      requests.push({ url, headers: init.headers as Record<string, string> });
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          streamResponse([
            'id: 1\nevent: gap\ndata: {"afterId":1,"latestId":9,"ts":"2026-10-24T18:04:02Z"}\n\n',
          ]),
        );
      }
      return Promise.resolve(streamResponse([]));
    };

    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
      if (delays.length === 2) client?.stop();
      await Promise.resolve();
    };

    client = createSseClient({
      url: '/v1/events',
      token: () => null,
      fetch: fetchStub,
      sleep,
      random: () => 0.5,
      onFrame: () => undefined,
      onGap: (gap) => gaps.push(gap),
      onState: () => undefined,
    });

    client.start(0);

    await vi.waitFor(() => expect(delays).toHaveLength(2), { timeout: 5000 });

    expect(gaps).toEqual([{ afterId: 1, latestId: 9 }]);
    expect(requests[1]?.headers['last-event-id']).toBe('9');
    expect(requests[0]?.headers['authorization']).toBeUndefined();
  });
});
