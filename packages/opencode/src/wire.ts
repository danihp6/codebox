import type { AgentHealth, AgentRef, ModelRef, RawAgentEvent, SessionRef } from './types.js';

type JsonRecord = Readonly<Record<string, unknown>>;

function asRecord(input: unknown): JsonRecord | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  return input as JsonRecord;
}

function hasExactKeys(record: JsonRecord, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function asString(record: JsonRecord, key: string, allowEmpty = false): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  if (!allowEmpty && value.length === 0) return null;
  return value;
}

function asCount(record: JsonRecord, key: string): number | null {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function decodeHealth(input: unknown): AgentHealth | null {
  const record = asRecord(input);
  if (record === null || !hasExactKeys(record, ['version'])) return null;
  const version = asString(record, 'version', true);
  if (version === null) return null;
  return { ok: true, version };
}

export function decodeSession(input: unknown): SessionRef | null {
  const record = asRecord(input);
  if (record === null || !hasExactKeys(record, ['id', 'title', 'directory'])) return null;
  const sessionId = asString(record, 'id');
  const title = asString(record, 'title');
  const directory = asString(record, 'directory');
  if (sessionId === null || title === null || directory === null) return null;
  return { sessionId, title, directory };
}

export function decodeModels(input: unknown): readonly ModelRef[] | null {
  const record = asRecord(input);
  if (record === null || !hasExactKeys(record, ['data'])) return null;
  const data = record['data'];
  if (!Array.isArray(data)) return null;
  const models: ModelRef[] = [];
  for (const entry of data) {
    const item = asRecord(entry);
    if (item === null || !hasExactKeys(item, ['id', 'providerID', 'name'])) return null;
    const id = asString(item, 'id');
    const providerId = asString(item, 'providerID');
    const name = asString(item, 'name');
    if (id === null || providerId === null || name === null) return null;
    models.push({ id, providerId, name });
  }
  return models;
}

export function decodeAgents(input: unknown): readonly AgentRef[] | null {
  const record = asRecord(input);
  if (record === null || !hasExactKeys(record, ['data'])) return null;
  const data = record['data'];
  if (!Array.isArray(data)) return null;
  const agents: AgentRef[] = [];
  for (const entry of data) {
    const item = asRecord(entry);
    if (item === null || !hasExactKeys(item, ['name', 'mode'])) return null;
    const name = asString(item, 'name');
    const mode = asString(item, 'mode');
    if (name === null || mode === null) return null;
    agents.push({ name, mode });
  }
  return agents;
}

const TOOL_STATUSES: readonly string[] = ['start', 'ok', 'error'];
const SESSION_STATUSES: readonly string[] = ['busy', 'idle'];

export function decodeEvent(input: unknown): RawAgentEvent | null {
  const frame = asRecord(input);
  if (frame === null || !hasExactKeys(frame, ['type', 'properties'])) return null;
  const type = asString(frame, 'type');
  const properties = asRecord(frame['properties']);
  if (type === null || properties === null) return null;

  switch (type) {
    case 'session.updated': {
      if (!hasExactKeys(properties, ['sessionId', 'status'])) return null;
      const sessionId = asString(properties, 'sessionId');
      const status = asString(properties, 'status');
      if (sessionId === null || status === null || !SESSION_STATUSES.includes(status)) return null;
      return { type, sessionId, status: status === 'busy' ? 'busy' : 'idle' };
    }
    case 'message.part.text': {
      if (!hasExactKeys(properties, ['sessionId', 'messageId', 'delta'])) return null;
      const sessionId = asString(properties, 'sessionId');
      const messageId = asString(properties, 'messageId');
      const delta = asString(properties, 'delta', true);
      if (sessionId === null || messageId === null || delta === null) return null;
      return { type, sessionId, messageId, delta };
    }
    case 'message.part.tool': {
      if (!hasExactKeys(properties, ['sessionId', 'messageId', 'tool', 'status'])) return null;
      const sessionId = asString(properties, 'sessionId');
      const messageId = asString(properties, 'messageId');
      const tool = asString(properties, 'tool');
      const status = asString(properties, 'status');
      if (sessionId === null || messageId === null || tool === null) return null;
      if (status === null || !TOOL_STATUSES.includes(status)) return null;
      const toolStatus = status === 'start' ? 'start' : status === 'ok' ? 'ok' : 'error';
      return { type, sessionId, messageId, tool, status: toolStatus };
    }
    case 'permission.updated': {
      if (!hasExactKeys(properties, ['sessionId', 'permissionId', 'tool', 'title', 'input'])) {
        return null;
      }
      const sessionId = asString(properties, 'sessionId');
      const permissionId = asString(properties, 'permissionId');
      const tool = asString(properties, 'tool');
      const title = asString(properties, 'title');
      const permissionInput = asRecord(properties['input']);
      if (sessionId === null || permissionId === null || tool === null || title === null) {
        return null;
      }
      if (permissionInput === null) return null;
      return { type, sessionId, permissionId, tool, title, input: permissionInput };
    }
    case 'session.error': {
      if (!hasExactKeys(properties, ['sessionId', 'message'])) return null;
      const sessionId = asString(properties, 'sessionId');
      const message = asString(properties, 'message');
      if (sessionId === null || message === null) return null;
      return { type, sessionId, message };
    }
    case 'session.usage': {
      if (!hasExactKeys(properties, ['sessionId', 'model', 'tokensIn', 'tokensOut', 'costUsd'])) {
        return null;
      }
      const sessionId = asString(properties, 'sessionId');
      const model = asString(properties, 'model');
      const tokensIn = asCount(properties, 'tokensIn');
      const tokensOut = asCount(properties, 'tokensOut');
      const costUsd = asCount(properties, 'costUsd');
      if (sessionId === null || model === null) return null;
      if (tokensIn === null || tokensOut === null || costUsd === null) return null;
      return { type, sessionId, model, tokensIn, tokensOut, costUsd };
    }
    default:
      return null;
  }
}

export function encodeEvent(event: RawAgentEvent): Readonly<Record<string, unknown>> {
  switch (event.type) {
    case 'session.updated':
      return {
        type: event.type,
        properties: { sessionId: event.sessionId, status: event.status },
      };
    case 'message.part.text':
      return {
        type: event.type,
        properties: {
          sessionId: event.sessionId,
          messageId: event.messageId,
          delta: event.delta,
        },
      };
    case 'message.part.tool':
      return {
        type: event.type,
        properties: {
          sessionId: event.sessionId,
          messageId: event.messageId,
          tool: event.tool,
          status: event.status,
        },
      };
    case 'permission.updated':
      return {
        type: event.type,
        properties: {
          sessionId: event.sessionId,
          permissionId: event.permissionId,
          tool: event.tool,
          title: event.title,
          input: event.input,
        },
      };
    case 'session.error':
      return {
        type: event.type,
        properties: { sessionId: event.sessionId, message: event.message },
      };
    case 'session.usage':
      return {
        type: event.type,
        properties: {
          sessionId: event.sessionId,
          model: event.model,
          tokensIn: event.tokensIn,
          tokensOut: event.tokensOut,
          costUsd: event.costUsd,
        },
      };
  }
}
