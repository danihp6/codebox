import { describe, expect, it } from 'vitest';
import type { RawAgentEvent } from './types.js';
import {
  decodeAgents,
  decodeEvent,
  decodeHealth,
  decodeModels,
  decodeSession,
  encodeEvent,
} from './wire.js';

const SESSION = 'ses_fixture01';
const MESSAGE = 'msg_fixture01';

const RAW_EVENTS: readonly RawAgentEvent[] = [
  { type: 'session.updated', sessionId: SESSION, status: 'busy' },
  { type: 'session.updated', sessionId: SESSION, status: 'idle' },
  { type: 'message.part.text', sessionId: SESSION, messageId: MESSAGE, delta: 'chunk\n' },
  { type: 'message.part.text', sessionId: SESSION, messageId: MESSAGE, delta: '' },
  {
    type: 'message.part.tool',
    sessionId: SESSION,
    messageId: MESSAGE,
    tool: 'bash',
    status: 'start',
  },
  {
    type: 'permission.updated',
    sessionId: SESSION,
    permissionId: 'per_fixture01',
    tool: 'bash',
    title: 'Run the gate',
    input: { command: 'npm run gate' },
  },
  { type: 'session.error', sessionId: SESSION, message: 'the model refused' },
  {
    type: 'session.usage',
    sessionId: SESSION,
    model: 'anthropic/claude-sonnet-4',
    tokensIn: 12,
    tokensOut: 34,
    costUsd: 0.0012,
  },
];

describe('decodeHealth', () => {
  it('accepts the pinned health body', () => {
    expect(decodeHealth({ version: '1.18.0' })).toEqual({ ok: true, version: '1.18.0' });
  });

  it('rejects unknown keys', () => {
    expect(decodeHealth({ version: '1.18.0', uptime: 4 })).toBeNull();
  });

  it('rejects a non-string version and non-objects', () => {
    expect(decodeHealth({ version: 3 })).toBeNull();
    expect(decodeHealth(null)).toBeNull();
    expect(decodeHealth('1.18.0')).toBeNull();
  });
});

describe('decodeSession', () => {
  it('maps the wire session onto SessionRef', () => {
    expect(decodeSession({ id: SESSION, title: 'cb-run-1', directory: '/tmp/cb-run-1' })).toEqual({
      sessionId: SESSION,
      title: 'cb-run-1',
      directory: '/tmp/cb-run-1',
    });
  });

  it('rejects a session without a directory', () => {
    expect(decodeSession({ id: SESSION, title: 'cb-run-1' })).toBeNull();
  });

  it('rejects an empty id', () => {
    expect(decodeSession({ id: '', title: 't', directory: '/tmp' })).toBeNull();
  });
});

describe('decodeModels', () => {
  it('maps providerID onto providerId', () => {
    expect(
      decodeModels({ data: [{ id: 'claude', providerID: 'anthropic', name: 'Claude' }] }),
    ).toEqual([{ id: 'claude', providerId: 'anthropic', name: 'Claude' }]);
  });

  it('rejects a data field that is not an array', () => {
    expect(decodeModels({ data: {} })).toBeNull();
  });

  it('rejects an entry with a foreign key', () => {
    expect(
      decodeModels({ data: [{ id: 'claude', providerID: 'anthropic', name: 'Claude', cost: 1 }] }),
    ).toBeNull();
  });
});

describe('decodeAgents', () => {
  it('maps the agent list', () => {
    expect(decodeAgents({ data: [{ name: 'build', mode: 'primary' }] })).toEqual([
      { name: 'build', mode: 'primary' },
    ]);
  });

  it('rejects a missing mode', () => {
    expect(decodeAgents({ data: [{ name: 'build' }] })).toBeNull();
  });
});

describe('decodeEvent', () => {
  it('decodes every variant the wrapper understands', () => {
    for (const event of RAW_EVENTS) {
      expect(decodeEvent(encodeEvent(event))).toEqual(event);
    }
  });

  it('returns null for an unknown type', () => {
    expect(decodeEvent({ type: 'message.part.images', properties: {} })).toBeNull();
  });

  it('returns null for a malformed frame', () => {
    expect(decodeEvent({ type: 'session.updated' })).toBeNull();
    expect(decodeEvent({ type: 'session.updated', properties: 'busy' })).toBeNull();
    expect(decodeEvent({ type: 'session.updated', properties: { sessionId: SESSION } })).toBeNull();
    expect(decodeEvent(42)).toBeNull();
    expect(decodeEvent([])).toBeNull();
  });

  it('rejects a status outside the pinned enum', () => {
    expect(
      decodeEvent({
        type: 'session.updated',
        properties: { sessionId: SESSION, status: 'thinking' },
      }),
    ).toBeNull();
  });

  it('rejects a usage frame with a negative token count', () => {
    expect(
      decodeEvent({
        type: 'session.usage',
        properties: {
          sessionId: SESSION,
          model: 'm',
          tokensIn: -1,
          tokensOut: 1,
          costUsd: 0,
        },
      }),
    ).toBeNull();
  });

  it('rejects a tool status outside the pinned enum', () => {
    expect(
      decodeEvent({
        type: 'message.part.tool',
        properties: { sessionId: SESSION, messageId: MESSAGE, tool: 'bash', status: 'pending' },
      }),
    ).toBeNull();
  });
});

describe('encodeEvent', () => {
  it('writes exactly the type and properties keys', () => {
    const frame = encodeEvent({ type: 'session.updated', sessionId: SESSION, status: 'busy' });
    expect(Object.keys(frame)).toEqual(['type', 'properties']);
  });

  it('round-trips every variant through decodeEvent', () => {
    for (const event of RAW_EVENTS) {
      const frame = encodeEvent(event);
      expect(frame['type']).toBe(event.type);
      expect(decodeEvent(frame)).toEqual(event);
    }
  });
});
