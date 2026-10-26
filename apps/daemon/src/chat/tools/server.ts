import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { Store } from '@codebox/store';
import type { Logger } from '../../logger.js';
import { ROUTINE_TOOL_DEFINITIONS, callRoutineTool } from './routine-tools.js';
import type { RoutineToolFailureCode } from './routine-tools.js';

export const MCP_PATH = '/mcp';
export const MAX_MCP_BODY_BYTES = 65_536;

const TOKEN_BYTES = 32;
const PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'codebox-routine-tools';
const SERVER_VERSION = '1.0.0';
const BEARER = /^Bearer (\S+)$/i;
const JSON_TYPE = 'application/json';

export interface RoutineToolMount {
  readonly url: string;
  readonly token: string;
}

export interface RoutineToolServer {
  /** Lazily binds 127.0.0.1 on the first call; replaces the token of that chat. */
  start(input: { readonly chatId: string; readonly repoId: string }): Promise<RoutineToolMount>;
  /** Revokes every token bound to the chat. Idempotent. */
  release(chatId: string): void;
  /** Closes the listener and destroys sockets. Idempotent; never throws. */
  close(): Promise<void>;
}

export interface CreateRoutineToolServerOptions {
  readonly store: Store;
  readonly now: () => Date;
  readonly logger: Logger;
  /** Injectable for tests: 32-byte token and 20-byte routine id entropy. */
  readonly random?: (size: number) => Buffer;
}

interface TokenEntry {
  readonly chatId: string;
  readonly repoId: string;
}

interface JsonRpcRequest {
  readonly id: string | number | null;
  readonly method: string;
  readonly params: unknown;
}

interface ToolCallParams {
  readonly name: string;
  readonly args: unknown;
}

const INITIALIZE_RESULT = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  capabilities: Object.freeze({ tools: Object.freeze({ listChanged: false }) }),
  serverInfo: Object.freeze({ name: SERVER_NAME, version: SERVER_VERSION }),
});

function empty(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    ...headers,
    'content-length': '0',
  });
  res.end();
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': JSON_TYPE,
    'content-length': String(Buffer.byteLength(payload)),
  });
  res.end(payload);
}

function result(res: ServerResponse, id: string | number | null, value: unknown): void {
  json(res, 200, { jsonrpc: '2.0', id, result: value });
}

function rpcError(
  res: ServerResponse,
  id: string | number | null,
  code: number,
  message: string,
): void {
  json(res, 200, { jsonrpc: '2.0', id, error: { code, message } });
}

function isJsonContentType(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  return value.split(';')[0]?.trim().toLowerCase() === JSON_TYPE;
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = BEARER.exec(header.trim());
  return match?.[1] ?? null;
}

/** Reads at most one body, draining the rest so a refused request still closes cleanly. */
async function readLimit(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_MCP_BODY_BYTES) {
      over = true;
      continue;
    }
    chunks.push(buffer);
  }
  return over ? null : Buffer.concat(chunks).toString('utf8');
}

function requestOf(value: unknown): JsonRpcRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record['jsonrpc'] !== '2.0') return null;
  const method = record['method'];
  if (typeof method !== 'string') return null;
  const id = record['id'];
  if (id !== undefined && typeof id !== 'string' && typeof id !== 'number' && id !== null) {
    return null;
  }
  return { id: id ?? null, method, params: record['params'] };
}

function toolCallOf(params: unknown): ToolCallParams | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  const record = params as Record<string, unknown>;
  const name = record['name'];
  if (typeof name !== 'string' || name.length === 0) return null;
  return { name, args: record['arguments'] ?? {} };
}

export function createRoutineToolServer(
  options: CreateRoutineToolServerOptions,
): RoutineToolServer {
  const random = options.random ?? randomBytes;
  const tokens = new Map<string, TokenEntry>();
  const tokensByChat = new Map<string, Set<string>>();
  const sockets = new Set<Socket>();
  let listener: Server | null = null;
  let origin: string | null = null;
  let binding: Promise<string> | null = null;
  let closing: Promise<void> | null = null;
  let closed = false;

  function release(chatId: string): void {
    const bound = tokensByChat.get(chatId);
    if (bound === undefined) return;
    for (const token of bound) tokens.delete(token);
    tokensByChat.delete(chatId);
  }

  /** Constant-time per candidate: a wrong token costs the same as a wrong-but-same-length one. */
  function entryFor(presented: string): TokenEntry | null {
    const given = Buffer.from(presented, 'utf8');
    for (const [token, entry] of tokens) {
      const expected = Buffer.from(token, 'utf8');
      if (expected.length !== given.length) continue;
      if (timingSafeEqual(expected, given)) return entry;
    }
    return null;
  }

  function respond(res: ServerResponse, request: JsonRpcRequest, entry: TokenEntry): void {
    if (request.method === 'notifications/initialized') {
      empty(res, 202);
      return;
    }
    if (request.method === 'initialize') {
      result(res, request.id, INITIALIZE_RESULT);
      return;
    }
    if (request.method === 'tools/list') {
      result(res, request.id, { tools: ROUTINE_TOOL_DEFINITIONS });
      return;
    }
    if (request.method !== 'tools/call') {
      rpcError(res, request.id, -32601, 'Method not found');
      return;
    }
    const call = toolCallOf(request.params);
    if (call === null) {
      rpcError(res, request.id, -32602, 'Invalid params');
      return;
    }
    const outcome = callRoutineTool(call.name, call.args, {
      store: options.store,
      now: options.now,
      random,
      chatId: entry.chatId,
      repoId: entry.repoId,
    });
    if (!outcome.ok) failedTool(res, request.id, call.name, entry.chatId, outcome.code);
    else {
      options.logger.info({ msg: 'routine_tool_call', tool: call.name, chatId: entry.chatId });
      result(res, request.id, {
        content: [{ type: 'text', text: JSON.stringify(outcome.output) }],
        structuredContent: outcome.output,
        isError: false,
      });
    }
  }

  function failedTool(
    res: ServerResponse,
    id: string | number | null,
    tool: string,
    chatId: string,
    code: RoutineToolFailureCode,
  ): void {
    options.logger.warn({ msg: 'routine_tool_failed', tool, chatId, code });
    result(res, id, { content: [{ type: 'text', text: code }], isError: true });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== MCP_PATH) {
      empty(res, 404);
      return;
    }
    if (req.method !== 'POST') {
      empty(res, 405, { allow: 'POST' });
      return;
    }
    if (!isJsonContentType(req.headers['content-type'])) {
      empty(res, 415);
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) {
      req.resume();
      empty(res, 413);
      return;
    }
    const body = await readLimit(req);
    if (body === null) {
      empty(res, 413);
      return;
    }
    const presented = bearerToken(req);
    const entry = presented === null ? null : entryFor(presented);
    if (entry === null) {
      empty(res, 401);
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      rpcError(res, null, -32700, 'Parse error');
      return;
    }
    if (Array.isArray(payload)) {
      rpcError(res, null, -32600, 'Invalid Request');
      return;
    }
    const request = requestOf(payload);
    if (request === null) {
      rpcError(res, null, -32600, 'Invalid Request');
      return;
    }
    respond(res, request, entry);
  }

  async function bind(): Promise<string> {
    const server = createServer((req, res) => {
      route(req, res).catch(() => {
        if (res.headersSent) res.end();
        else empty(res, 500);
      });
    });
    server.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      throw new Error('the routine tool server did not bind a port');
    }
    listener = server;
    origin = `http://127.0.0.1:${address.port}`;
    options.logger.info({ msg: 'routine_tools_listening', port: address.port });
    return origin;
  }

  function listening(): Promise<string> {
    if (origin !== null) return Promise.resolve(origin);
    if (binding === null) {
      binding = bind().catch((error: unknown) => {
        binding = null;
        throw error;
      });
    }
    return binding;
  }

  async function start(input: {
    readonly chatId: string;
    readonly repoId: string;
  }): Promise<RoutineToolMount> {
    if (closed) throw new Error('the routine tool server is closed');
    const base = await listening();
    release(input.chatId);
    const token = random(TOKEN_BYTES).toString('base64url');
    tokens.set(token, { chatId: input.chatId, repoId: input.repoId });
    const bound = tokensByChat.get(input.chatId) ?? new Set<string>();
    bound.add(token);
    tokensByChat.set(input.chatId, bound);
    return { url: `${base}${MCP_PATH}`, token };
  }

  async function shutdown(): Promise<void> {
    closed = true;
    tokens.clear();
    tokensByChat.clear();
    const server = listener;
    listener = null;
    origin = null;
    binding = null;
    if (server === null) return;
    for (const socket of [...sockets]) socket.destroy();
    sockets.clear();
    try {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    } catch {
      // A listener that is already closed is not a shutdown failure.
    }
  }

  function close(): Promise<void> {
    if (closing === null) closing = shutdown();
    return closing;
  }

  return { start, release, close };
}
