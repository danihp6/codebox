import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAgentRuntime } from './client.js';
import type { AgentRuntime, RawAgentEvent, SessionRef } from './types.js';
import { encodeEvent } from './wire.js';

export interface FakeOpenCodeOptions {
  readonly token: string | null;
  readonly version: string;
}

export interface FakeOpenCode extends AgentRuntime {
  readonly url: string;
  readonly requests: readonly string[];
  script(sessionId: string, events: readonly RawAgentEvent[]): void;
  failNext(status: number): void;
  dropStream(sessionId: string): void;
  hangPrompt(sessionId: string): void;
  close(): Promise<void>;
}

interface StreamEntry {
  readonly res: ServerResponse;
  readonly sessionId: string | null;
}

interface FakeSession {
  readonly id: string;
  readonly title: string;
  readonly directory: string;
}

const MODELS = Object.freeze([
  { id: 'claude-sonnet-4', providerId: 'anthropic', name: 'Claude Sonnet 4' },
]);
const AGENTS = Object.freeze([
  { name: 'build', mode: 'primary' },
  { name: 'plan', mode: 'primary' },
]);

function decodeBody(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function startFakeOpenCode(options: FakeOpenCodeOptions): Promise<FakeOpenCode> {
  const requests: string[] = [];
  const sessions = new Map<string, FakeSession>();
  const queues = new Map<string, RawAgentEvent[]>();
  const streams = new Set<StreamEntry>();
  const hanging = new Set<string>();
  const held = new Set<ServerResponse>();
  let failWith: number | null = null;
  let counter = 0;
  let closed = false;

  function writeToStreams(sessionId: string, event: RawAgentEvent): void {
    const frame = `data: ${JSON.stringify(encodeEvent(event))}\n\n`;
    for (const entry of streams) {
      if (entry.sessionId !== null && entry.sessionId !== sessionId) continue;
      entry.res.write(frame);
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    requests.push(`${method} ${path}`);

    if (options.token !== null && req.headers.authorization !== `Bearer ${options.token}`) {
      res.statusCode = 401;
      res.end();
      return;
    }

    if (failWith !== null) {
      res.statusCode = failWith;
      failWith = null;
      res.end();
      return;
    }

    if (method === 'GET' && path === '/api/info') {
      writeJson(res, 200, { version: options.version });
      return;
    }

    if (method === 'GET' && path === '/api/model') {
      writeJson(res, 200, {
        data: MODELS.map((model) => ({
          id: model.id,
          providerID: model.providerId,
          name: model.name,
        })),
      });
      return;
    }

    if (method === 'GET' && path === '/api/agent') {
      writeJson(res, 200, {
        data: AGENTS.map((agent) => ({ name: agent.name, mode: agent.mode })),
      });
      return;
    }

    if (method === 'POST' && path === '/api/session') {
      const body = decodeBody(await readBody(req));
      const title = typeof body?.['title'] === 'string' ? body['title'] : 'cb-session';
      const directory = typeof body?.['directory'] === 'string' ? body['directory'] : '/tmp';
      counter += 1;
      const session: FakeSession = { id: `ses_fake${counter}`, title, directory };
      sessions.set(session.id, session);
      writeJson(res, 200, { id: session.id, title: session.title, directory: session.directory });
      return;
    }

    if (method === 'GET' && path === '/api/event') {
      const sessionId = url.searchParams.get('sessionID');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.flushHeaders();
      const entry: StreamEntry = { res, sessionId };
      streams.add(entry);
      res.on('close', () => {
        streams.delete(entry);
      });
      return;
    }

    const prompt = /^\/api\/session\/([^/]+)\/prompt$/.exec(path);
    if (method === 'POST' && prompt !== null) {
      const sessionId = decodeURIComponent(prompt[1] ?? '');
      await readBody(req);
      if (!sessions.has(sessionId)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      if (hanging.delete(sessionId)) {
        held.add(res);
        return;
      }
      res.statusCode = 202;
      res.end();
      const pending = queues.get(sessionId) ?? [];
      queues.delete(sessionId);
      for (const event of pending) writeToStreams(sessionId, event);
      return;
    }

    const interrupt = /^\/api\/session\/([^/]+)\/interrupt$/.exec(path);
    if (method === 'POST' && interrupt !== null) {
      await readBody(req);
      res.statusCode = 204;
      res.end();
      return;
    }

    const permission = /^\/api\/session\/([^/]+)\/permissions\/([^/]+)$/.exec(path);
    if (method === 'POST' && permission !== null) {
      await readBody(req);
      res.statusCode = 204;
      res.end();
      return;
    }

    const session = /^\/api\/session\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && session !== null) {
      sessions.delete(decodeURIComponent(session[1] ?? ''));
      res.statusCode = 204;
      res.end();
      return;
    }

    res.statusCode = 404;
    res.end();
  }

  const server = createServer((req, res) => {
    route(req, res).catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  const runtime = createAgentRuntime({
    baseUrl: url,
    token: options.token,
    healthPath: '/api/info',
    fetch: (input, init) => globalThis.fetch(input, init),
    requestTimeoutMs: 5_000,
    reconnectDelayMs: 0,
    sleep: async () => {},
  });

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    for (const entry of streams) entry.res.destroy();
    streams.clear();
    for (const res of held) res.destroy();
    held.clear();
    const done = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    await done;
  }

  const fake: FakeOpenCode = {
    url,
    get requests(): readonly string[] {
      return requests;
    },
    health: () => runtime.health(),
    createSession: (input): Promise<SessionRef> => runtime.createSession(input),
    prompt: (sessionId, text, promptOptions) => runtime.prompt(sessionId, text, promptOptions),
    subscribe: (filter) => runtime.subscribe(filter),
    interrupt: (sessionId) => runtime.interrupt(sessionId),
    replyPermission: (sessionId, requestId, reply) =>
      runtime.replyPermission(sessionId, requestId, reply),
    listModels: () => runtime.listModels(),
    listAgents: () => runtime.listAgents(),
    closeSession: (sessionId) => runtime.closeSession(sessionId),
    script: (sessionId, events) => {
      queues.set(sessionId, [...(queues.get(sessionId) ?? []), ...events]);
    },
    failNext: (status) => {
      failWith = status;
    },
    dropStream: (sessionId) => {
      for (const entry of [...streams]) {
        if (entry.sessionId !== null && entry.sessionId !== sessionId) continue;
        streams.delete(entry);
        entry.res.end();
      }
    },
    hangPrompt: (sessionId) => {
      hanging.add(sessionId);
    },
    close,
  };

  return fake;
}
