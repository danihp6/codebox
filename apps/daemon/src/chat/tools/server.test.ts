import { afterEach, describe, expect, it } from 'vitest';
import { ROUTINE_TOOL_NAMES, parseRoutine } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { nextFireAt } from '../../jobs/service.js';
import { createLogger } from '../../logger.js';
import { createRoutineToolServer } from './index.js';
import type { RoutineToolMount, RoutineToolServer } from './index.js';

const REPO_ID = 'repo_tools001';
const CHAT_ID = 'chat_tools001';
const NOW = '2026-10-25T10:00:00.000Z';
const PROMPT_TITLE = 'Morning summary';
const PROMPT_TEXT = 'Summarise the repository in five bullets.';
const CRON = '0 7 * * *';
const TIMEZONE = 'Europe/Madrid';

const stores: Store[] = [];
const servers: RoutineToolServer[] = [];
let entropy = 0;

function nextEntropy(size: number): Buffer {
  entropy += 1;
  return Buffer.alloc(size, entropy);
}

interface RpcResponse {
  readonly jsonrpc: string;
  readonly id: string | number | null;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
}

interface Harness {
  readonly store: Store;
  readonly server: RoutineToolServer;
  readonly mount: RoutineToolMount;
  readonly logs: Record<string, unknown>[];
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.close();
});

function seed(store: Store): void {
  store.repos.create({
    id: REPO_ID,
    slug: 'acme/widgets',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'auto',
    protectedPaths: [],
    enabled: true,
    createdAt: NOW,
  });
  store.chats.createSession(
    {
      id: CHAT_ID,
      repoId: REPO_ID,
      title: 'Repo chat',
      status: 'idle',
      createdAt: NOW,
      updatedAt: NOW,
      lastMessage: null,
    },
    { opencodeSessionId: null, worktree: null },
  );
}

async function harness(): Promise<Harness> {
  const store = openInMemoryStore();
  stores.push(store);
  seed(store);
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => logs.push(JSON.parse(line) as Record<string, unknown>),
  });
  const server = createRoutineToolServer({
    store,
    now: () => new Date(NOW),
    logger,
    random: (size) => nextEntropy(size),
  });
  servers.push(server);
  const mount = await server.start({ chatId: CHAT_ID, repoId: REPO_ID });
  return { store, server, mount, logs };
}

interface PostOptions {
  readonly token?: string | null;
  readonly contentType?: string | null;
  readonly path?: string;
  readonly method?: string;
}

async function post(
  mount: RoutineToolMount,
  body: unknown,
  options: PostOptions = {},
): Promise<Response> {
  const url = new URL(mount.url);
  url.pathname = options.path ?? url.pathname;
  const headers: Record<string, string> = {};
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType;
  if (contentType !== null) headers['content-type'] = contentType;
  const token = options.token === undefined ? mount.token : options.token;
  if (token !== null) headers['authorization'] = `Bearer ${token}`;
  const method = options.method ?? 'POST';
  return fetch(url, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

function rpc(id: number, method: string, params?: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

async function rpcCall(harnessUnderTest: Harness, body: unknown): Promise<RpcResponse> {
  const response = await post(harnessUnderTest.mount, body);
  expect(response.status).toBe(200);
  return (await response.json()) as RpcResponse;
}

function resultOf(payload: RpcResponse): Record<string, unknown> {
  if (payload.result === undefined) throw new Error('the response carried no result');
  return payload.result;
}

async function callTool(
  harnessUnderTest: Harness,
  name: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  const payload = await rpcCall(harnessUnderTest, rpc(1, 'tools/call', { name, arguments: args }));
  return resultOf(payload);
}

function routineOf(result: Record<string, unknown>): Record<string, unknown> {
  const structured = result['structuredContent'];
  if (typeof structured !== 'object' || structured === null) {
    throw new Error('the tool result carried no structured content');
  }
  const routine = (structured as Record<string, unknown>)['routine'];
  if (typeof routine !== 'object' || routine === null) {
    throw new Error('the tool result carried no routine');
  }
  return routine as Record<string, unknown>;
}

function textOf(result: Record<string, unknown>): string {
  const content = result['content'];
  if (!Array.isArray(content) || content.length === 0) return '';
  const first = content[0];
  if (typeof first !== 'object' || first === null) return '';
  const text = (first as Record<string, unknown>)['text'];
  return typeof text === 'string' ? text : '';
}

function promptInput(): Record<string, unknown> {
  return {
    kind: 'prompt',
    title: PROMPT_TITLE,
    cron: CRON,
    timezone: TIMEZONE,
    prompt: PROMPT_TEXT,
  };
}

function reminderInput(): Record<string, unknown> {
  return { kind: 'reminder', title: 'Take the pill', cron: CRON, timezone: TIMEZONE };
}

describe('routine tool server transport', () => {
  it('refuses a missing or wrong token with 401 and writes no row', async () => {
    const h = await harness();
    const body = rpc(1, 'tools/call', { name: ROUTINE_TOOL_NAMES[0], arguments: promptInput() });

    expect((await post(h.mount, body, { token: null })).status).toBe(401);
    expect((await post(h.mount, body, { token: 'not-the-token' })).status).toBe(401);
    expect(h.store.routines.list({ limit: 10, cursor: null }).data).toHaveLength(0);
  });

  it('maps a wrong path, method and content type to 404, 405 and 415', async () => {
    const h = await harness();
    expect((await post(h.mount, rpc(1, 'initialize'), { path: '/other' })).status).toBe(404);
    expect((await post(h.mount, rpc(1, 'initialize'), { method: 'GET' })).status).toBe(405);
    expect((await post(h.mount, rpc(1, 'initialize'), { contentType: 'text/plain' })).status).toBe(
      415,
    );
  });

  it('answers initialize with the pinned protocol version and server info', async () => {
    const h = await harness();
    const payload = await rpcCall(h, rpc(1, 'initialize', {}));
    expect(resultOf(payload)).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'codebox-routine-tools', version: '1.0.0' },
    });
  });

  it('answers the initialized notification with 202 and an empty body', async () => {
    const h = await harness();
    const response = await post(h.mount, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('lists exactly the three routine tools with object input schemas', async () => {
    const h = await harness();
    const result = resultOf(await rpcCall(h, rpc(1, 'tools/list')));
    const tools = result['tools'];
    expect(Array.isArray(tools)).toBe(true);
    const list = tools as Record<string, unknown>[];
    expect(list.map((tool) => tool['name'])).toEqual([...ROUTINE_TOOL_NAMES]);
    for (const tool of list) {
      const schema = tool['inputSchema'] as Record<string, unknown>;
      expect(schema['type']).toBe('object');
      expect(schema['additionalProperties']).toBe(false);
    }
  });

  it('reports malformed JSON, a batch and an unknown method as JSON-RPC errors', async () => {
    const h = await harness();

    const malformed = await rpcCall(h, '{ not json');
    expect(malformed.error?.code).toBe(-32700);

    const batch = await rpcCall(h, [rpc(1, 'initialize')]);
    expect(batch.error?.code).toBe(-32600);

    const notJsonRpc = await rpcCall(h, { id: 1, method: 'initialize' });
    expect(notJsonRpc.error?.code).toBe(-32600);

    const unknown = await rpcCall(h, rpc(7, 'tools/dance'));
    expect(unknown.error?.code).toBe(-32601);
    expect(unknown.id).toBe(7);
  });

  it('refuses a body over 64 KiB with 413', async () => {
    const h = await harness();
    const body = rpc(1, 'initialize', { pad: 'x'.repeat(70_000) });
    const response = await post(h.mount, body);
    expect(response.status).toBe(413);
  });

  it('revokes every token of a chat on release', async () => {
    const h = await harness();
    h.server.release(CHAT_ID);
    const response = await post(h.mount, rpc(1, 'tools/list'));
    expect(response.status).toBe(401);
  });
});

describe('routine tools', () => {
  it('creates a prompt routine bound to the token chat and repository', async () => {
    const h = await harness();
    const result = await callTool(h, ROUTINE_TOOL_NAMES[0], promptInput());
    expect(result['isError']).toBe(false);
    const routine = routineOf(result);

    expect(routine['id']).toMatch(/^rtn_[0-9A-Za-z]{6,40}$/);
    expect(routine['kind']).toBe('prompt');
    expect(routine['repoId']).toBe(REPO_ID);
    expect(routine['chatSessionId']).toBe(CHAT_ID);
    expect(routine['prompt']).toBe(PROMPT_TEXT);
    expect(routine['enabled']).toBe(true);
    expect(routine['notify']).toBe(true);
    expect(routine['createdAt']).toBe('2026-10-25T10:00:00Z');
    expect(() => parseRoutine(routine)).not.toThrow();
    expect(JSON.parse(textOf(result))).toEqual(result['structuredContent']);

    const schedule = nextFireAt({ cron: CRON, timezone: TIMEZONE }, new Date(NOW));
    if (!schedule.ok) throw new Error(schedule.message);
    expect(routine['nextFireAt']).toBe(schedule.nextFireAt);

    const stored = h.store.routines.get(String(routine['id']));
    expect(stored).not.toBeNull();
    if (stored === null || stored.kind !== 'prompt')
      throw new Error('the prompt routine is missing');
    expect(stored.repoId).toBe(REPO_ID);
    expect(stored.chatSessionId).toBe(CHAT_ID);
    expect(stored.nextFireAt).toBe(schedule.nextFireAt);
  });

  it('creates a reminder without repository, prompt or chat columns', async () => {
    const h = await harness();
    const result = await callTool(h, ROUTINE_TOOL_NAMES[0], reminderInput());
    expect(result['isError']).toBe(false);
    const routine = routineOf(result);
    expect(routine['kind']).toBe('reminder');
    expect(routine).not.toHaveProperty('repoId');
    expect(routine).not.toHaveProperty('prompt');
    expect(routine).not.toHaveProperty('chatSessionId');

    const row = h.store.db
      .prepare('SELECT repo_id, prompt, chat_session_id FROM routines WHERE id = ?')
      .get(String(routine['id']));
    expect(row?.['repo_id']).toBeNull();
    expect(row?.['prompt']).toBeNull();
    expect(row?.['chat_session_id']).toBeNull();
  });

  it('rejects a missing timezone with invalid_input and writes no row', async () => {
    const h = await harness();
    const result = await callTool(h, ROUTINE_TOOL_NAMES[0], {
      kind: 'prompt',
      title: PROMPT_TITLE,
      cron: CRON,
      prompt: PROMPT_TEXT,
    });
    expect(result['isError']).toBe(true);
    expect(textOf(result)).toBe('invalid_input');
    expect(h.store.routines.list({ limit: 10, cursor: null }).data).toHaveLength(0);
  });

  it('lists the routines it created', async () => {
    const h = await harness();
    await callTool(h, ROUTINE_TOOL_NAMES[0], promptInput());
    await callTool(h, ROUTINE_TOOL_NAMES[0], reminderInput());

    const result = await callTool(h, ROUTINE_TOOL_NAMES[1], {});
    expect(result['isError']).toBe(false);
    const structured = result['structuredContent'] as { routines: Record<string, unknown>[] };
    expect(structured.routines.map((routine) => routine['kind'])).toEqual(['reminder', 'prompt']);

    const reminders = await callTool(h, ROUTINE_TOOL_NAMES[1], { kind: 'reminder' });
    const only = reminders['structuredContent'] as { routines: Record<string, unknown>[] };
    expect(only.routines).toHaveLength(1);
    expect(only.routines[0]?.['kind']).toBe('reminder');
  });

  it('pauses and resumes a routine', async () => {
    const h = await harness();
    const created = routineOf(await callTool(h, ROUTINE_TOOL_NAMES[0], promptInput()));
    const id = String(created['id']);
    const schedule = nextFireAt({ cron: CRON, timezone: TIMEZONE }, new Date(NOW));
    if (!schedule.ok) throw new Error(schedule.message);

    const paused = await callTool(h, ROUTINE_TOOL_NAMES[2], { routineId: id, enabled: false });
    expect(paused['isError']).toBe(false);
    const pausedRoutine = routineOf(paused);
    expect(pausedRoutine['enabled']).toBe(false);
    expect(pausedRoutine['nextFireAt']).toBeNull();
    expect(h.store.routines.get(id)?.enabled).toBe(false);

    const resumed = await callTool(h, ROUTINE_TOOL_NAMES[2], { routineId: id, enabled: true });
    expect(resumed['isError']).toBe(false);
    const resumedRoutine = routineOf(resumed);
    expect(resumedRoutine['enabled']).toBe(true);
    expect(resumedRoutine['nextFireAt']).toBe(schedule.nextFireAt);
  });

  it('reports an unknown tool and a missing routine as tool failures', async () => {
    const h = await harness();
    const unknown = await callTool(h, 'routine.evil', {});
    expect(unknown['isError']).toBe(true);
    expect(textOf(unknown)).toBe('unknown_tool');

    const missing = await callTool(h, ROUTINE_TOOL_NAMES[2], {
      routineId: 'rtn_missing001',
      enabled: false,
    });
    expect(missing['isError']).toBe(true);
    expect(textOf(missing)).toBe('not_found');
  });

  it('never logs the token, the authorization header or the tool input', async () => {
    const h = await harness();
    await callTool(h, ROUTINE_TOOL_NAMES[0], promptInput());
    const logged = JSON.stringify(h.logs);
    expect(logged).toContain('routine_tool_call');
    expect(logged).toContain('routine_tools_listening');
    expect(logged).not.toContain(h.mount.token);
    expect(logged).not.toContain('authorization');
    expect(logged).not.toContain(PROMPT_TEXT);
    expect(logged).not.toContain(PROMPT_TITLE);
  });
});
