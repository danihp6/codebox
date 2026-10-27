import { describe, expect, it } from 'vitest';
import * as api from './index.js';

describe('package entry point', () => {
  it('re-exports the constructors and the constants', () => {
    expect(api.createAgentRuntime).toBeTypeOf('function');
    expect(api.createNormaliser).toBeTypeOf('function');
    expect(api.createSupervisor).toBeTypeOf('function');
    expect(api.startFakeOpenCode).toBeTypeOf('function');
    expect(api.buildRunEnvelope).toBeTypeOf('function');
    expect(api.RUN_ENVELOPE_VERSION).toBe(1);
    expect(api.RUN_ENVELOPE_TEMPLATE).toBeTypeOf('string');
    expect(api.buildChatHandoff).toBeTypeOf('function');
    expect(api.CHAT_HANDOFF_VERSION).toBe(1);
    expect(api.CHAT_HANDOFF_TURNS).toBe(10);
  });

  it('re-exports the wire helpers', () => {
    expect(api.decodeHealth).toBeTypeOf('function');
    expect(api.decodeSession).toBeTypeOf('function');
    expect(api.decodeModels).toBeTypeOf('function');
    expect(api.decodeAgents).toBeTypeOf('function');
    expect(api.decodeEvent).toBeTypeOf('function');
    expect(api.encodeEvent).toBeTypeOf('function');
  });

  it('re-exports the error helpers', () => {
    expect(api.AgentError).toBeTypeOf('function');
    expect(api.isRetryable).toBeTypeOf('function');
    expect(api.toContractErrorCode).toBeTypeOf('function');
  });

  it('exports each runtime name exactly once', () => {
    const names = Object.keys(api).sort();
    expect(names).toEqual([...new Set(names)].sort());
    expect(names).toContain('createAgentRuntime');
    expect(names).toContain('startFakeOpenCode');
  });
});

describe('AgentError', () => {
  it('carries the code, the status and the retry flag', () => {
    const error = new api.AgentError('agent_unavailable', 'down', 503, true);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AgentError');
    expect(error.code).toBe('agent_unavailable');
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('down');
  });

  it('accepts a null status', () => {
    expect(new api.AgentError('protocol', 'bad', null, false).status).toBeNull();
  });
});

describe('isRetryable', () => {
  it('is true only for agent_unavailable and stream_lost', () => {
    expect(api.isRetryable(new api.AgentError('agent_unavailable', 'x', null, true))).toBe(true);
    expect(api.isRetryable(new api.AgentError('stream_lost', 'x', null, true))).toBe(true);
    for (const code of [
      'model_error',
      'approval_expired',
      'unauthorized',
      'protocol',
      'cancelled',
    ] as const) {
      expect(api.isRetryable(new api.AgentError(code, 'x', null, false))).toBe(false);
    }
  });
});

describe('toContractErrorCode', () => {
  it('maps agent_unavailable to itself and everything else to provider_unavailable', () => {
    expect(api.toContractErrorCode('agent_unavailable')).toBe('agent_unavailable');
    for (const code of [
      'stream_lost',
      'model_error',
      'approval_expired',
      'unauthorized',
      'protocol',
      'cancelled',
    ] as const) {
      expect(api.toContractErrorCode(code)).toBe('provider_unavailable');
    }
  });
});
