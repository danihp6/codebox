import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const E2E_OPENCODE_VERSION = 'e2e-1.0.0';
export const DEFAULT_CHANGE_FILE = 'e2e-change.txt';
export const DEFAULT_CHANGE_CONTENT = 'written by the e2e agent\n';
export const E2E_MESSAGE_ID = 'msg_e2e1';

const MODELS = Object.freeze([
  { id: 'claude-sonnet-4', providerID: 'anthropic', name: 'Claude Sonnet 4' },
]);
const AGENTS = Object.freeze([
  { name: 'build', mode: 'primary' },
  { name: 'plan', mode: 'primary' },
]);

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    request.once('error', rejectBody);
    request.once('end', () => {
      resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function decodeObject(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
  } catch {
    // An unreadable body is treated as an empty one: the fake answers with its defaults.
  }
  return {};
}

function stringField(record, key, fallback) {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function writeJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

/**
 * The frames one prompt produces, in this order and with fixed ids. Each one decodes through
 * `decodeEvent` from `@codebox/opencode`; the harness never invents a second wire shape.
 *
 * @param {string} sessionId
 * @returns {readonly Record<string, unknown>[]}
 */
export function promptFrames(sessionId) {
  return [
    { type: 'session.updated', properties: { sessionId, status: 'busy' } },
    {
      type: 'message.part.tool',
      properties: {
        sessionId,
        messageId: E2E_MESSAGE_ID,
        tool: 'edit',
        status: 'start',
      },
    },
    {
      type: 'message.part.text',
      properties: {
        sessionId,
        messageId: E2E_MESSAGE_ID,
        delta: 'wrote e2e-change.txt',
      },
    },
    {
      type: 'message.part.tool',
      properties: { sessionId, messageId: E2E_MESSAGE_ID, tool: 'edit', status: 'ok' },
    },
    {
      type: 'session.usage',
      properties: {
        sessionId,
        model: 'anthropic/claude-sonnet-4',
        tokensIn: 12,
        tokensOut: 8,
        costUsd: 0.001,
      },
    },
    { type: 'session.updated', properties: { sessionId, status: 'idle' } },
  ];
}

/**
 * An OpenCode stand-in that speaks `packages/opencode/src/wire.ts` and, unlike the shipped
 * fake, edits the worktree it was told to work in: the session's `directory`.
 *
 * @param {{ changeFile?: string; content?: string }} [input]
 * @returns {Promise<{ url: string; requests: readonly string[]; close: () => Promise<void> }>}
 */
export async function startE2eOpenCode(input = {}) {
  const changeFile = input.changeFile ?? DEFAULT_CHANGE_FILE;
  const content = input.content ?? DEFAULT_CHANGE_CONTENT;
  const sessions = new Map();
  const subscribers = new Set();
  const pending = new Map();
  const requests = [];
  let counter = 0;
  let closed = false;

  function publish(sessionId, frames) {
    if (frames.length === 0) return;
    const matching = [...subscribers].filter(
      (subscriber) => subscriber.sessionId === null || subscriber.sessionId === sessionId,
    );
    if (matching.length === 0) {
      pending.set(sessionId, [...(pending.get(sessionId) ?? []), ...frames]);
      return;
    }
    for (const frame of frames) {
      const payload = `data: ${JSON.stringify(frame)}\n\n`;
      for (const subscriber of matching) {
        try {
          subscriber.response.write(payload);
        } catch {
          // The engine closed the stream between the prompt and the frame; drop the subscriber.
          subscribers.delete(subscriber);
        }
      }
    }
  }

  function flushPending(sessionId) {
    if (sessionId === null) {
      for (const [key, frames] of [...pending]) {
        pending.delete(key);
        publish(key, frames);
      }
      return;
    }
    const frames = pending.get(sessionId);
    if (frames === undefined) return;
    pending.delete(sessionId);
    publish(sessionId, frames);
  }

  function runPrompt(session) {
    try {
      mkdirSync(dirname(join(session.directory, changeFile)), { recursive: true });
      writeFileSync(join(session.directory, changeFile), content, 'utf8');
    } catch {
      // A prompt without a writable session directory is still answered: the run then fails
      // at its gate, which is exactly the signal the test should read.
    }
    publish(session.id, promptFrames(session.id));
  }

  async function route(request, response) {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    requests.push(`${method} ${path}`);

    if (method === 'GET' && path === '/api/info') {
      writeJson(response, 200, { version: E2E_OPENCODE_VERSION });
      return;
    }
    if (method === 'GET' && path === '/api/model') {
      writeJson(response, 200, { data: MODELS.map((model) => ({ ...model })) });
      return;
    }
    if (method === 'GET' && path === '/api/agent') {
      writeJson(response, 200, { data: AGENTS.map((agent) => ({ ...agent })) });
      return;
    }
    if (method === 'POST' && path === '/api/session') {
      const body = decodeObject(await readBody(request));
      const title = stringField(body, 'title', 'cb-session');
      const directory = stringField(body, 'directory', '/tmp');
      counter += 1;
      const session = { id: `ses_e2e${counter}`, title, directory };
      sessions.set(session.id, session);
      writeJson(response, 200, { id: session.id, title, directory });
      return;
    }
    if (method === 'GET' && path === '/api/event') {
      const sessionId = url.searchParams.get('sessionID');
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.flushHeaders();
      const subscriber = { response, sessionId };
      subscribers.add(subscriber);
      response.on('close', () => {
        subscribers.delete(subscriber);
      });
      flushPending(sessionId);
      return;
    }

    const prompt = /^\/api\/session\/([^/]+)\/prompt$/.exec(path);
    if (method === 'POST' && prompt !== null) {
      const sessionId = decodeURIComponent(prompt[1] ?? '');
      await readBody(request);
      const session = sessions.get(sessionId);
      if (session === undefined) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 202;
      response.end();
      setImmediate(() => {
        runPrompt(session);
      });
      return;
    }

    if (method === 'POST' && /^\/api\/session\/[^/]+\/interrupt$/.test(path)) {
      await readBody(request);
      response.statusCode = 204;
      response.end();
      return;
    }
    if (method === 'POST' && /^\/api\/session\/[^/]+\/permissions\/[^/]+$/.test(path)) {
      await readBody(request);
      response.statusCode = 204;
      response.end();
      return;
    }
    const sessionPath = /^\/api\/session\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && sessionPath !== null) {
      sessions.delete(decodeURIComponent(sessionPath[1] ?? ''));
      response.statusCode = 204;
      response.end();
      return;
    }

    response.statusCode = 404;
    response.end();
  }

  const server = createServer((request, response) => {
    route(request, response).catch(() => {
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the e2e OpenCode fake failed to bind a loopback port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    get requests() {
      return requests;
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const subscriber of subscribers) subscriber.response.destroy();
      subscribers.clear();
      const done = new Promise((resolveClose) => {
        server.close(() => resolveClose());
      });
      server.closeAllConnections();
      await done;
    },
  };
}
