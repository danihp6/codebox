import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SseEventName, Scope } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { createModule as createEventsModule } from './index.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const CHAT_A = 'chat_stream01';
const CHAT_B = 'chat_stream02';
const RUN_A = 'run_stream01';
const TS = '2026-10-25T10:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-13-events-'));
  directories.push(directory);
  const appDir = join(directory, 'app');
  mkdirSync(appDir, { recursive: true });
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_LOG_LEVEL: 'error',
  });
  const store = openInMemoryStore();
  stores.push(store);
  // The stream reads rows by global id: the run or chat a fixture belongs to is not measured
  // here, so the parent rows are not seeded.
  store.db.exec('PRAGMA foreign_keys = OFF');
  const logger = createLogger({ level: 'error', sink: () => undefined });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date(TS),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir,
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  createEventsModule(context).register(app, context);
  return { app, store };
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function paired(app: DaemonApp, scopes?: readonly Scope[]): Promise<string> {
  const issued = await app.request(
    '/v1/pair/code',
    jsonInit(scopes === undefined ? { name: 'Dani iPhone' } : { name: 'Dani iPhone', scopes }),
    LOOPBACK,
  );
  expect(issued.status).toBe(201);
  const code = ((await issued.json()) as { code: string }).code;
  const exchanged = await app.request(
    '/v1/pair',
    jsonInit({
      code,
      deviceName: 'Dani iPhone',
      platform: 'cli',
      devicePublicKey: 'ed25519:test-public-key',
    }),
    LOOPBACK,
  );
  expect(exchanged.status).toBe(200);
  const body = (await exchanged.json()) as { accessToken: string };
  return body.accessToken;
}

function append(
  store: Store,
  input: {
    readonly type: SseEventName;
    readonly seq: number;
    readonly data: Record<string, unknown>;
    readonly chatId?: string;
    readonly runId?: string;
    readonly ts?: string;
  },
): void {
  store.events.append({
    runId: input.runId ?? null,
    chatId: input.chatId ?? null,
    seq: input.seq,
    type: input.type,
    data: input.data,
    ts: input.ts ?? TS,
  });
}

function chatDelta(store: Store, chatId: string, seq: number): void {
  append(store, {
    type: 'chat.delta',
    chatId,
    seq,
    data: { chatId, seq, ts: TS, delta: `delta-${seq}` },
  });
}

function runOutput(store: Store, runId: string, seq: number): void {
  append(store, { type: 'run.output', runId, seq, data: { runId, seq, ts: TS, delta: 'x' } });
}

function runFinished(store: Store, runId: string, seq: number): void {
  append(store, {
    type: 'run.finished',
    runId,
    seq,
    data: { runId, seq, ts: TS, state: 'succeeded' },
  });
}

function eventHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'last-event-id': '0' };
}

interface ReadFrames {
  readonly frames: readonly string[];
}

async function readFrames(response: Response, count: number): Promise<ReadFrames> {
  const body = response.body;
  if (body === null) throw new Error('the stream has no body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = '';
  while (frames.length < count) {
    const chunk = await reader.read();
    if (chunk.done === true) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1 && frames.length < count) {
      frames.push(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
  await reader.cancel();
  return { frames };
}

describe('GET /v1/events', () => {
  it('streams with the retry frame and the SSE headers', async () => {
    const { app, store } = harness();
    chatDelta(store, CHAT_A, 1);
    const token = await paired(app);

    const response = await app.request('/v1/events', { headers: eventHeaders(token) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('connection')).toBe('keep-alive');
    expect(response.headers.get('x-accel-buffering')).toBe('no');

    const { frames } = await readFrames(response, 2);
    expect(frames[0]).toBe('retry: 3000');
    expect(frames[1]).toContain('event: chat.delta');
    expect(frames[1]).toContain(`"chatId":"${CHAT_A}"`);
  });

  it('requires a bearer token before it opens a stream', async () => {
    const { app } = harness();
    const response = await app.request('/v1/events');
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('applies the type and chat filters', async () => {
    const { app, store } = harness();
    chatDelta(store, CHAT_A, 1);
    chatDelta(store, CHAT_B, 1);
    runOutput(store, RUN_A, 1);
    chatDelta(store, CHAT_A, 2);
    const token = await paired(app);

    const response = await app.request(`/v1/events?types=chat.delta&chatId=${CHAT_A}`, {
      headers: eventHeaders(token),
    });
    const { frames } = await readFrames(response, 3);
    expect(frames[0]).toBe('retry: 3000');
    expect(frames.slice(1).every((frame) => frame.includes('event: chat.delta'))).toBe(true);
    expect(frames.slice(1).every((frame) => frame.includes(`"chatId":"${CHAT_A}"`))).toBe(true);
    expect(frames.join('\n')).not.toContain('run.output');
    expect(frames.join('\n')).not.toContain(CHAT_B);
  });

  it('closes the stream after the terminal run event', async () => {
    const { app, store } = harness();
    runOutput(store, RUN_A, 1);
    runFinished(store, RUN_A, 2);
    chatDelta(store, CHAT_A, 1);
    const token = await paired(app);

    const response = await app.request(`/v1/events?runId=${RUN_A}`, {
      headers: eventHeaders(token),
    });
    const text = await response.text();
    expect(text.startsWith('retry: 3000\n\n')).toBe(true);
    expect(text).toContain('event: run.output');
    expect(text).toContain('event: run.finished');
    expect(text).not.toContain('chat.delta');
  });

  it('answers 429 over the per-device connection limit and frees a slot on close', async () => {
    const { app } = harness();
    const token = await paired(app);
    const opened: Response[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await app.request('/v1/events', { headers: eventHeaders(token) });
      expect(response.status).toBe(200);
      opened.push(response);
    }

    const refused = await app.request('/v1/events', { headers: eventHeaders(token) });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('60');
    const body = (await refused.json()) as { error: { code: string; details: { reason: string } } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.details.reason).toBe('sse_limit');

    for (const response of opened) await response.body?.cancel();
    const reopened = await app.request('/v1/events', { headers: eventHeaders(token) });
    expect(reopened.status).toBe(200);
    await reopened.body?.cancel();
  });

  it('rejects an unknown event type, a malformed run id and a bad Last-Event-ID', async () => {
    const { app } = harness();
    const token = await paired(app);

    const types = await app.request('/v1/events?types=nope', { headers: eventHeaders(token) });
    expect(types.status).toBe(422);
    expect(await types.json()).toMatchObject({
      error: { code: 'validation_failed', details: { path: 'events.types' } },
    });

    const runId = await app.request('/v1/events?runId=not-a-run', { headers: eventHeaders(token) });
    expect(runId.status).toBe(422);
    expect(await runId.json()).toMatchObject({
      error: { details: { path: 'events.runId' } },
    });

    const lastEventId = await app.request('/v1/events', {
      headers: { authorization: `Bearer ${token}`, 'last-event-id': 'abc' },
    });
    expect(lastEventId.status).toBe(422);
    expect(await lastEventId.json()).toMatchObject({
      error: { details: { path: 'events.lastEventId' } },
    });

    const unknownQuery = await app.request('/v1/events?after=3', { headers: eventHeaders(token) });
    expect(unknownQuery.status).toBe(422);
    expect(await unknownQuery.json()).toMatchObject({
      error: { details: { path: 'events.after' } },
    });
  });
});
