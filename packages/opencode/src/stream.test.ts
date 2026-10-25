import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from './client.js';
import { AgentError } from './errors.js';
import type { FakeOpenCode } from './fake.js';
import { startFakeOpenCode } from './fake.js';
import type { AgentRuntime, RawAgentEvent } from './types.js';
import { encodeEvent } from './wire.js';

const SESSION_DIRECTORY = '/tmp/cb-run-fixture01';

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${label}`);
}

class Feed {
  private readonly iterator: AsyncIterator<RawAgentEvent>;

  constructor(iterable: AsyncIterable<RawAgentEvent>) {
    this.iterator = iterable[Symbol.asyncIterator]();
  }

  async next(): Promise<RawAgentEvent> {
    const step = await this.iterator.next();
    if (step.done === true) throw new Error('stream ended unexpectedly');
    return step.value;
  }

  async close(): Promise<void> {
    await this.iterator.return?.(undefined);
  }
}

interface StreamHarness {
  readonly server: FakeOpenCode;
  readonly runtime: AgentRuntime;
  readonly sessionId: string;
  readonly events: () => number;
}

async function harness(sleep?: () => Promise<void>): Promise<StreamHarness> {
  const server = await startFakeOpenCode({ token: null, version: '1.18.0' });
  const runtime = createAgentRuntime({
    baseUrl: server.url,
    token: null,
    healthPath: '/api/info',
    fetch: (url, init) => globalThis.fetch(url, init),
    requestTimeoutMs: 5_000,
    reconnectDelayMs: 0,
    sleep: sleep ?? (async () => {}),
  });
  const session = await runtime.createSession({
    directory: SESSION_DIRECTORY,
    title: 'cb-run-fixture01',
    agent: 'build',
    model: null,
  });
  return {
    server,
    runtime,
    sessionId: session.sessionId,
    events: () => server.requests.filter((request) => request === 'GET /api/event').length,
  };
}

function textEvent(sessionId: string, delta: string): RawAgentEvent {
  return { type: 'message.part.text', sessionId, messageId: 'msg_stream01', delta };
}

describe('stream', () => {
  it('stream yields decoded events for a session subscription', async () => {
    const { server, runtime, sessionId, events } = await harness();
    try {
      const event = textEvent(sessionId, 'hello\n');
      server.script(sessionId, [event]);
      const feed = new Feed(runtime.subscribe({ sessionId }));
      const pending = feed.next();
      await waitFor(() => events() === 1, 'the first stream');
      await runtime.prompt(sessionId, 'go');
      expect(await pending).toEqual(event);
      await feed.close();
    } finally {
      await server.close();
    }
  });

  it('stream subscribes for all sessions when the filter says so', async () => {
    const { server, runtime, sessionId } = await harness();
    try {
      const event = textEvent(sessionId, 'broadcast\n');
      server.script(sessionId, [event]);
      const feed = new Feed(runtime.subscribe({ all: true }));
      const pending = feed.next();
      await waitFor(() => server.requests.includes('GET /api/event'), 'the stream');
      await runtime.prompt(sessionId, 'go');
      expect(await pending).toEqual(event);
      await feed.close();
    } finally {
      await server.close();
    }
  });

  it('stream reconnects exactly once after a drop and keeps yielding', async () => {
    const { server, runtime, sessionId, events } = await harness();
    try {
      const first = textEvent(sessionId, 'before the drop\n');
      const second = textEvent(sessionId, 'after the reconnect\n');
      server.script(sessionId, [first]);
      const feed = new Feed(runtime.subscribe({ sessionId }));

      const opening = feed.next();
      await waitFor(() => events() === 1, 'the first stream');
      await runtime.prompt(sessionId, 'go');
      expect(await opening).toEqual(first);

      server.dropStream(sessionId);
      const reconnected = feed.next();
      await waitFor(() => events() === 2, 'the reconnect');
      server.script(sessionId, [second]);
      await runtime.prompt(sessionId, 'go again');
      expect(await reconnected).toEqual(second);

      expect(events()).toBe(2);
      await feed.close();
    } finally {
      await server.close();
    }
  });

  it('stream reports agent_unavailable when the reconnect cannot reach the server', async () => {
    const server = await startFakeOpenCode({ token: null, version: '1.18.0' });
    const runtime = createAgentRuntime({
      baseUrl: server.url,
      token: null,
      healthPath: '/api/info',
      fetch: (url, init) => globalThis.fetch(url, init),
      requestTimeoutMs: 5_000,
      reconnectDelayMs: 0,
      sleep: async () => {
        await server.close();
      },
    });
    try {
      const session = await runtime.createSession({
        directory: SESSION_DIRECTORY,
        title: 'cb-run-fixture01',
        agent: 'build',
        model: null,
      });
      const event = textEvent(session.sessionId, 'before the crash\n');
      server.script(session.sessionId, [event]);
      const feed = new Feed(runtime.subscribe({ sessionId: session.sessionId }));
      const pending = feed.next();
      await waitFor(
        () => server.requests.filter((request) => request === 'GET /api/event').length === 1,
        'the first stream',
      );
      await runtime.prompt(session.sessionId, 'go');
      expect(await pending).toEqual(event);

      server.dropStream(session.sessionId);
      await expect(feed.next()).rejects.toMatchObject({
        name: 'AgentError',
        code: 'agent_unavailable',
        retryable: true,
      });
      const streamRequests = server.requests.filter((request) => request === 'GET /api/event');
      expect(streamRequests).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('stream reports stream_lost when the reconnected stream drops again', async () => {
    const { server, runtime, sessionId, events } = await harness();
    try {
      const first = textEvent(sessionId, 'before\n');
      const second = textEvent(sessionId, 'after\n');
      server.script(sessionId, [first]);
      const feed = new Feed(runtime.subscribe({ sessionId }));

      const opening = feed.next();
      await waitFor(() => events() === 1, 'the first stream');
      await runtime.prompt(sessionId, 'go');
      expect(await opening).toEqual(first);

      server.dropStream(sessionId);
      const reconnected = feed.next();
      await waitFor(() => events() === 2, 'the reconnect');
      server.script(sessionId, [second]);
      await runtime.prompt(sessionId, 'go again');
      expect(await reconnected).toEqual(second);

      server.dropStream(sessionId);
      let caught: unknown;
      try {
        await feed.next();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AgentError);
      expect((caught as AgentError).code).toBe('stream_lost');
      expect(events()).toBe(2);
    } finally {
      await server.close();
    }
  });

  it('stream drops an unknown frame and keeps the known one', async () => {
    const event = textEvent('ses_unknown01', 'known\n');
    const body = `data: {"type":"message.part.images","properties":{}}\n\ndata: ${JSON.stringify(
      encodeEvent(event),
    )}\n\ndata: not-json\n\n`;
    let calls = 0;
    const runtime = createAgentRuntime({
      baseUrl: 'http://127.0.0.1:4096',
      token: null,
      healthPath: '/api/info',
      fetch: async () => {
        calls += 1;
        if (calls > 1) throw new Error('the test serves one connection');
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
      requestTimeoutMs: 5_000,
      reconnectDelayMs: 0,
      sleep: async () => {},
    });
    const feed = new Feed(runtime.subscribe({ sessionId: 'ses_unknown01' }));
    expect(await feed.next()).toEqual(event);
    await feed.close();
  });
});
