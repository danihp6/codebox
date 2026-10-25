import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from './client.js';
import { AgentError } from './errors.js';
import type { FakeOpenCode, FakeOpenCodeOptions } from './fake.js';
import { startFakeOpenCode } from './fake.js';
import type { AgentRuntime } from './types.js';

const HEALTH = '/api/info';

async function fakeServer(options?: Partial<FakeOpenCodeOptions>): Promise<FakeOpenCode> {
  return startFakeOpenCode({ token: null, version: '1.18.0', ...options });
}

function runtimeFor(
  server: FakeOpenCode,
  overrides?: {
    readonly token?: string | null;
    readonly requestTimeoutMs?: number;
    readonly healthPath?: string;
  },
): AgentRuntime {
  return createAgentRuntime({
    baseUrl: server.url,
    token: overrides?.token ?? null,
    healthPath: overrides?.healthPath ?? HEALTH,
    fetch: (url, init) => globalThis.fetch(url, init),
    requestTimeoutMs: overrides?.requestTimeoutMs ?? 5_000,
    reconnectDelayMs: 0,
    sleep: async () => {},
  });
}

async function newSession(server: FakeOpenCode, title = 'cb-run-fixture01'): Promise<string> {
  const session = await server.createSession({
    directory: '/tmp/cb-run-fixture01',
    title,
    agent: 'build',
    model: null,
  });
  return session.sessionId;
}

describe('createAgentRuntime base URL guard', () => {
  it('accepts every loopback spelling', () => {
    for (const baseUrl of ['http://127.0.0.1:4096', 'http://localhost:4096', 'http://[::1]:4096']) {
      expect(() =>
        createAgentRuntime({
          baseUrl,
          token: null,
          healthPath: HEALTH,
          fetch: (url, init) => globalThis.fetch(url, init),
          requestTimeoutMs: 1_000,
          reconnectDelayMs: 0,
          sleep: async () => {},
        }),
      ).not.toThrow();
    }
  });

  it('refuses a non-loopback, a path-carrying or a portless base URL', () => {
    for (const baseUrl of [
      'https://127.0.0.1:4096',
      'http://10.0.0.1:4096',
      'http://example.com:4096',
      'http://127.0.0.1',
      'http://127.0.0.1:4096/api',
      'http://user:pass@127.0.0.1:4096',
      'not-a-url',
    ]) {
      let caught: unknown;
      try {
        createAgentRuntime({
          baseUrl,
          token: null,
          healthPath: HEALTH,
          fetch: (url, init) => globalThis.fetch(url, init),
          requestTimeoutMs: 1_000,
          reconnectDelayMs: 0,
          sleep: async () => {},
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AgentError);
      expect((caught as AgentError).code).toBe('protocol');
    }
  });
});

describe('AgentRuntime health', () => {
  it('reports the version served by the health path', async () => {
    const server = await fakeServer();
    try {
      expect(await runtimeFor(server).health()).toEqual({ ok: true, version: '1.18.0' });
      expect(server.requests).toContain('GET /api/info');
    } finally {
      await server.close();
    }
  });

  it('never throws when the server is gone', async () => {
    const server = await fakeServer();
    const runtime = runtimeFor(server);
    await server.close();
    expect(await runtime.health()).toEqual({ ok: false, version: '' });
  });

  it('reports not ok on a 5xx', async () => {
    const server = await fakeServer();
    try {
      const runtime = runtimeFor(server);
      server.failNext(503);
      expect(await runtime.health()).toEqual({ ok: false, version: '' });
    } finally {
      await server.close();
    }
  });

  it('reports not ok on an unparseable body', async () => {
    const runtime = createAgentRuntime({
      baseUrl: 'http://127.0.0.1:4096',
      token: null,
      healthPath: HEALTH,
      fetch: async () => new Response('not json', { status: 200 }),
      requestTimeoutMs: 1_000,
      reconnectDelayMs: 0,
      sleep: async () => {},
    });
    expect(await runtime.health()).toEqual({ ok: false, version: '' });
  });
});

describe('AgentRuntime session lifecycle', () => {
  it('creates a session with the pinned body', async () => {
    const server = await fakeServer();
    try {
      const runtime = runtimeFor(server);
      const session = await runtime.createSession({
        directory: '/tmp/cb-run-fixture01',
        title: 'cb-run-fixture01',
        agent: 'build',
        model: 'anthropic/claude-sonnet-4',
      });
      expect(session.sessionId).toBe('ses_fake1');
      expect(session.title).toBe('cb-run-fixture01');
      expect(session.directory).toBe('/tmp/cb-run-fixture01');
      expect(server.requests).toContain('POST /api/session');
    } finally {
      await server.close();
    }
  });

  it('posts the prompt and closes the session', async () => {
    const server = await fakeServer();
    try {
      const runtime = runtimeFor(server);
      const sessionId = await newSession(server);
      await runtime.prompt(sessionId, 'do the work');
      await runtime.closeSession(sessionId);
      expect(server.requests).toContain(`POST /api/session/${sessionId}/prompt`);
      expect(server.requests).toContain(`DELETE /api/session/${sessionId}`);
    } finally {
      await server.close();
    }
  });

  it('interrupts a session', async () => {
    const server = await fakeServer();
    try {
      const runtime = runtimeFor(server);
      const sessionId = await newSession(server);
      await runtime.interrupt(sessionId);
      expect(server.requests).toContain(`POST /api/session/${sessionId}/interrupt`);
    } finally {
      await server.close();
    }
  });

  it('answers a permission request with the pinned reply', async () => {
    const server = await fakeServer();
    try {
      const runtime = runtimeFor(server);
      const sessionId = await newSession(server);
      await runtime.replyPermission(sessionId, 'per_fixture01', 'reject');
      expect(server.requests).toContain(`POST /api/session/${sessionId}/permissions/per_fixture01`);
    } finally {
      await server.close();
    }
  });

  it('lists models with providerId mapped', async () => {
    const server = await fakeServer();
    try {
      expect(await runtimeFor(server).listModels()).toEqual([
        { id: 'claude-sonnet-4', providerId: 'anthropic', name: 'Claude Sonnet 4' },
      ]);
    } finally {
      await server.close();
    }
  });

  it('lists agents', async () => {
    const server = await fakeServer();
    try {
      expect(await runtimeFor(server).listAgents()).toEqual([
        { name: 'build', mode: 'primary' },
        { name: 'plan', mode: 'primary' },
      ]);
    } finally {
      await server.close();
    }
  });
});

describe('AgentRuntime errors', () => {
  it('sends the bearer token when one is configured', async () => {
    const server = await fakeServer({ token: 'fixture-token' });
    try {
      const runtime = runtimeFor(server, { token: 'fixture-token' });
      expect(await runtime.listAgents()).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it('maps a 401 to unauthorized', async () => {
    const server = await fakeServer({ token: 'fixture-token' });
    try {
      await expect(runtimeFor(server).listAgents()).rejects.toMatchObject({
        name: 'AgentError',
        code: 'unauthorized',
        status: 401,
        retryable: false,
      });
    } finally {
      await server.close();
    }
  });

  it('maps a 5xx to a retryable agent_unavailable', async () => {
    const server = await fakeServer();
    try {
      const runtime = runtimeFor(server);
      server.failNext(503);
      await expect(runtime.listModels()).rejects.toMatchObject({
        code: 'agent_unavailable',
        status: 503,
        retryable: true,
      });
    } finally {
      await server.close();
    }
  });

  it('maps any other non-2xx to protocol', async () => {
    const server = await fakeServer();
    try {
      const runtime = runtimeFor(server);
      server.failNext(404);
      await expect(runtime.listModels()).rejects.toMatchObject({
        code: 'protocol',
        status: 404,
        retryable: false,
      });
    } finally {
      await server.close();
    }
  });

  it('maps an unparseable body to protocol', async () => {
    const runtime = createAgentRuntime({
      baseUrl: 'http://127.0.0.1:4096',
      token: null,
      healthPath: HEALTH,
      fetch: async () => new Response('nope', { status: 200 }),
      requestTimeoutMs: 1_000,
      reconnectDelayMs: 0,
      sleep: async () => {},
    });
    await expect(runtime.listModels()).rejects.toMatchObject({ code: 'protocol', status: 200 });
  });

  it('maps a request timeout to agent_unavailable', async () => {
    const server = await fakeServer();
    try {
      const runtime = runtimeFor(server, { requestTimeoutMs: 50 });
      const sessionId = await newSession(server);
      server.hangPrompt(sessionId);
      await expect(runtime.prompt(sessionId, 'hang')).rejects.toMatchObject({
        code: 'agent_unavailable',
        retryable: true,
      });
    } finally {
      await server.close();
    }
  });

  it('rejects with cancelled when the caller aborts', async () => {
    const server = await fakeServer();
    try {
      const runtime = runtimeFor(server);
      const sessionId = await newSession(server);
      const controller = new AbortController();
      controller.abort();
      await expect(
        runtime.prompt(sessionId, 'aborted', { signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'cancelled', retryable: false });
    } finally {
      await server.close();
    }
  });

  it('never leaks the URL, the token or a response body in the message', async () => {
    const server = await fakeServer({ token: 'fixture-token' });
    try {
      const runtime = runtimeFor(server);
      let caught: unknown;
      try {
        await runtime.listModels();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AgentError);
      const message = (caught as AgentError).message;
      expect(message).not.toContain('http');
      expect(message).not.toContain('fixture-token');
      expect(message).not.toContain(server.url);
    } finally {
      await server.close();
    }
  });
});
