import { AgentError } from './errors.js';
import type {
  AgentHealth,
  AgentRef,
  AgentRuntime,
  AgentRuntimeOptions,
  CreateSessionInput,
  EventFilter,
  ModelRef,
  PermissionReply,
  PromptOptions,
  RawAgentEvent,
  SessionRef,
} from './types.js';
import { decodeAgents, decodeEvent, decodeHealth, decodeModels, decodeSession } from './wire.js';

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '[::1]', 'localhost'];

function loopbackOrigin(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AgentError('protocol', 'agent base URL is not loopback', null, false);
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(url.hostname) || url.port === '') {
    throw new AgentError('protocol', 'agent base URL is not loopback', null, false);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new AgentError('protocol', 'agent base URL must not carry a path', null, false);
  }
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new AgentError(
      'protocol',
      'agent base URL must not carry credentials or a query',
      null,
      false,
    );
  }
  return url.origin;
}

function unavailable(message: string, status: number | null = null): AgentError {
  return new AgentError('agent_unavailable', message, status, true);
}

function parseFrame(frame: string): RawAgentEvent | null {
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue;
    data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join('\n'));
  } catch {
    return null;
  }
  return decodeEvent(parsed);
}

async function* decodeFrames(response: Response): AsyncGenerator<RawAgentEvent> {
  const body = response.body;
  if (body === null)
    throw new AgentError('protocol', 'agent event stream has no body', null, false);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done === true) {
        buffer += decoder.decode();
        break;
      }
      buffer = `${buffer}${decoder.decode(chunk.value, { stream: true })}`.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event !== null) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const tail = parseFrame(buffer);
  if (tail !== null) yield tail;
}

interface RequestSpec {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly accept?: string;
  readonly stream?: boolean;
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const origin = loopbackOrigin(options.baseUrl);
  const healthPath = options.healthPath.startsWith('/')
    ? options.healthPath
    : `/${options.healthPath}`;

  function headers(spec: {
    readonly accept?: string;
    readonly body?: unknown;
  }): Record<string, string> {
    const result: Record<string, string> = { accept: spec.accept ?? 'application/json' };
    if (options.token !== null) result['authorization'] = `Bearer ${options.token}`;
    if (spec.body !== undefined) result['content-type'] = 'application/json';
    return result;
  }

  async function send(spec: RequestSpec): Promise<Response> {
    const init: RequestInit = { method: spec.method, headers: headers(spec) };
    if (spec.body !== undefined) init.body = JSON.stringify(spec.body);
    if (spec.stream === true) {
      if (spec.signal !== undefined) init.signal = spec.signal;
    } else {
      const timeout = AbortSignal.timeout(options.requestTimeoutMs);
      init.signal = spec.signal === undefined ? timeout : AbortSignal.any([timeout, spec.signal]);
    }

    let response: Response;
    try {
      response = await options.fetch(`${origin}${spec.path}`, init);
    } catch {
      if (spec.signal?.aborted === true) {
        throw new AgentError('cancelled', 'agent request was cancelled', null, false);
      }
      throw unavailable('agent request failed');
    }

    if (response.status === 401) {
      throw new AgentError('unauthorized', 'agent request is not authorized', 401, false);
    }
    if (response.status >= 500) throw unavailable('agent server failed', response.status);
    if (!response.ok) {
      throw new AgentError('protocol', 'unexpected agent response status', response.status, false);
    }
    return response;
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new AgentError('protocol', 'unreadable agent response', response.status, false);
    }
  }

  async function json(spec: RequestSpec): Promise<unknown> {
    return readJson(await send(spec));
  }

  async function health(): Promise<AgentHealth> {
    const failure: AgentHealth = { ok: false, version: '' };
    try {
      const response = await options.fetch(`${origin}${healthPath}`, {
        method: 'GET',
        headers: headers({}),
        signal: AbortSignal.timeout(options.requestTimeoutMs),
      });
      if (!response.ok) return failure;
      return decodeHealth(await response.json()) ?? failure;
    } catch {
      return failure;
    }
  }

  async function createSession(input: CreateSessionInput): Promise<SessionRef> {
    const body = await json({
      method: 'POST',
      path: '/api/session',
      body: {
        title: input.title,
        directory: input.directory,
        agent: input.agent,
        model: input.model,
        ...(input.mcp === undefined ? {} : { mcp: input.mcp }),
      },
    });
    const decoded = decodeSession(body);
    if (decoded === null) throw new AgentError('protocol', 'unreadable agent session', null, false);
    return decoded;
  }

  async function prompt(
    sessionId: string,
    text: string,
    promptOptions?: PromptOptions,
  ): Promise<void> {
    const spec: RequestSpec = {
      method: 'POST',
      path: `/api/session/${encodeURIComponent(sessionId)}/prompt`,
      body: { text },
      ...(promptOptions?.signal === undefined ? {} : { signal: promptOptions.signal }),
    };
    await send(spec);
  }

  function subscribeStream(filter: EventFilter): AsyncIterable<RawAgentEvent> {
    return { [Symbol.asyncIterator]: () => readStream(filter) };
  }

  async function openStream(filter: EventFilter): Promise<Response> {
    const path =
      'sessionId' in filter
        ? `/api/event?sessionID=${encodeURIComponent(filter.sessionId)}`
        : '/api/event';
    return send({
      method: 'GET',
      path,
      accept: 'application/json, text/event-stream',
      stream: true,
    });
  }

  async function* readStream(filter: EventFilter): AsyncGenerator<RawAgentEvent> {
    let reconnected = false;
    for (;;) {
      let response: Response;
      try {
        response = await openStream(filter);
      } catch (error) {
        if (!reconnected && error instanceof AgentError) throw error;
        throw unavailable('agent event stream is unreachable');
      }
      try {
        for await (const event of decodeFrames(response)) yield event;
      } catch {
        // A closed, errored or unreadable stream is a dropped stream either way.
      }
      if (reconnected)
        throw new AgentError('stream_lost', 'agent event stream was lost', null, true);
      reconnected = true;
      await options.sleep(options.reconnectDelayMs);
    }
  }

  async function interrupt(sessionId: string): Promise<void> {
    await send({ method: 'POST', path: `/api/session/${encodeURIComponent(sessionId)}/interrupt` });
  }

  async function replyPermission(
    sessionId: string,
    requestId: string,
    reply: PermissionReply,
  ): Promise<void> {
    await send({
      method: 'POST',
      path: `/api/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}`,
      body: { reply },
    });
  }

  async function listModels(): Promise<readonly ModelRef[]> {
    const decoded = decodeModels(await json({ method: 'GET', path: '/api/model' }));
    if (decoded === null) throw new AgentError('protocol', 'unreadable agent models', null, false);
    return decoded;
  }

  async function listAgents(): Promise<readonly AgentRef[]> {
    const decoded = decodeAgents(await json({ method: 'GET', path: '/api/agent' }));
    if (decoded === null) throw new AgentError('protocol', 'unreadable agent agents', null, false);
    return decoded;
  }

  async function closeSession(sessionId: string): Promise<void> {
    await send({ method: 'DELETE', path: `/api/session/${encodeURIComponent(sessionId)}` });
  }

  return {
    health,
    createSession,
    prompt,
    subscribe: subscribeStream,
    interrupt,
    replyPermission,
    listModels,
    listAgents,
    closeSession,
  };
}
