import { describe, expect, it } from 'vitest';
import type { ApprovalRequestSignal, Normalise, NormalisedEvent } from './normalise.js';
import { createNormaliser } from './normalise.js';
import type { RawAgentEvent } from './types.js';

const SESSION = 'ses_fixture01';
const MESSAGE = 'msg_fixture01';
const RUN_ID = 'run_fixture01';
const CHAT_ID = 'chat_fixture01';
const BRANCH = 'cb/run_fixture01-demo';
const NOW = '2026-10-24T18:04:02Z';

interface Harness {
  readonly normalise: Normalise;
  readonly approvals: ApprovalRequestSignal[];
  readonly seqs: number[];
}

function runHarness(): Harness {
  const approvals: ApprovalRequestSignal[] = [];
  const seqs: number[] = [];
  const normalise = createNormaliser({
    scope: { kind: 'run', runId: RUN_ID, branch: BRANCH },
    nextSeq: () => {
      seqs.push(seqs.length + 1);
      return seqs.length;
    },
    now: () => NOW,
    resolveApproval: async (request) => {
      approvals.push(request);
      return 'apv_fixture01';
    },
  });
  return { normalise, approvals, seqs };
}

function chatHarness(): Harness {
  const approvals: ApprovalRequestSignal[] = [];
  const seqs: number[] = [];
  const normalise = createNormaliser({
    scope: { kind: 'chat', chatId: CHAT_ID },
    nextSeq: () => {
      seqs.push(seqs.length + 1);
      return seqs.length;
    },
    now: () => NOW,
    resolveApproval: async (request) => {
      approvals.push(request);
      return 'apv_fixture02';
    },
  });
  return { normalise, approvals, seqs };
}

const busy: RawAgentEvent = { type: 'session.updated', sessionId: SESSION, status: 'busy' };
const idle: RawAgentEvent = { type: 'session.updated', sessionId: SESSION, status: 'idle' };
const text = (delta: string): RawAgentEvent => ({
  type: 'message.part.text',
  sessionId: SESSION,
  messageId: MESSAGE,
  delta,
});
const tool: RawAgentEvent = {
  type: 'message.part.tool',
  sessionId: SESSION,
  messageId: MESSAGE,
  tool: 'bash',
  status: 'ok',
};
const permission: RawAgentEvent = {
  type: 'permission.updated',
  sessionId: SESSION,
  permissionId: 'per_fixture01',
  tool: 'bash',
  title: 'Run the gate',
  input: { command: 'npm run gate' },
};
const failure: RawAgentEvent = {
  type: 'session.error',
  sessionId: SESSION,
  message: 'the model refused',
};
const usage: RawAgentEvent = {
  type: 'session.usage',
  sessionId: SESSION,
  model: 'anthropic/claude-sonnet-4',
  tokensIn: 12,
  tokensOut: 34,
  costUsd: 0.0012,
};

function eventNames(events: readonly NormalisedEvent[]): string[] {
  return events.map((event) => event.event);
}

describe('normalise (run scope)', () => {
  it('emits exactly one run.started for the lifetime of the normaliser', async () => {
    const harness = runHarness();
    const first = await harness.normalise(busy);
    const second = await harness.normalise(busy);

    expect(first.outcome).toBe('continue');
    expect(first.events).toEqual([
      { event: 'run.started', data: { runId: RUN_ID, branch: BRANCH, seq: 1, ts: NOW } },
    ]);
    expect(second.events).toEqual([]);
  });

  it('reports idle without an event in a run scope', async () => {
    const harness = runHarness();
    const result = await harness.normalise(idle);
    expect(result).toMatchObject({ events: [], outcome: 'idle', failure: null, usage: null });
  });

  it('maps a text part to run.output with the delta verbatim', async () => {
    const harness = runHarness();
    const result = await harness.normalise(text('a\nb\n'));
    expect(result.outcome).toBe('continue');
    expect(result.events).toEqual([
      { event: 'run.output', data: { runId: RUN_ID, seq: 1, ts: NOW, delta: 'a\nb\n' } },
    ]);
  });

  it('maps a tool part to run.tool and never forwards the detail key', async () => {
    const harness = runHarness();
    const result = await harness.normalise(tool);
    expect(result.events).toEqual([
      { event: 'run.tool', data: { runId: RUN_ID, seq: 1, ts: NOW, tool: 'bash', status: 'ok' } },
    ]);
    expect(Object.keys(result.events[0]?.data ?? {})).not.toContain('detail');
  });

  it('maps a permission request to run.permission and resolves it once', async () => {
    const harness = runHarness();
    const result = await harness.normalise(permission);
    expect(harness.approvals).toHaveLength(1);
    expect(harness.approvals[0]).toEqual({
      permissionId: 'per_fixture01',
      tool: 'bash',
      title: 'Run the gate',
      input: { command: 'npm run gate' },
    });
    expect(result.events).toEqual([
      {
        event: 'run.permission',
        data: {
          runId: RUN_ID,
          seq: 1,
          ts: NOW,
          approvalId: 'apv_fixture01',
          tool: 'bash',
          title: 'Run the gate',
        },
      },
    ]);
  });

  it('never puts the tool input into an emitted event', async () => {
    const harness = runHarness();
    const result = await harness.normalise(permission);
    expect(JSON.stringify(result.events)).not.toContain('npm run gate');
  });

  it('reports a model error without emitting an event', async () => {
    const harness = runHarness();
    const result = await harness.normalise(failure);
    expect(result).toEqual({
      events: [],
      outcome: 'error',
      failure: { code: 'model_error', message: 'the model refused' },
      usage: null,
    });
  });

  it('reports usage without emitting an event', async () => {
    const harness = runHarness();
    const result = await harness.normalise(usage);
    expect(result).toEqual({
      events: [],
      outcome: 'continue',
      failure: null,
      usage: {
        model: 'anthropic/claude-sonnet-4',
        tokensIn: 12,
        tokensOut: 34,
        costUsd: 0.0012,
      },
    });
  });

  it('takes seq only from nextSeq and only for an emitted event', async () => {
    const harness = runHarness();
    await harness.normalise(usage);
    expect(harness.seqs).toEqual([]);
    await harness.normalise(text('one'));
    await harness.normalise(idle);
    await harness.normalise(text('two'));
    expect(harness.normalise).toBeTypeOf('function');
    expect(harness.seqs).toEqual([1, 2]);
  });

  it('takes ts only from now()', async () => {
    const stamps = ['2026-10-24T18:04:02Z', '2026-10-24T18:04:03Z'];
    let index = 0;
    const normalise = createNormaliser({
      scope: { kind: 'run', runId: RUN_ID, branch: BRANCH },
      nextSeq: () => 1,
      now: () => stamps[index++] ?? NOW,
      resolveApproval: async () => 'apv_fixture01',
    });
    const first = await normalise(text('one'));
    const second = await normalise(text('two'));
    expect(first.events[0]?.data.ts).toBe('2026-10-24T18:04:02Z');
    expect(second.events[0]?.data.ts).toBe('2026-10-24T18:04:03Z');
  });

  it('emits a single run.started even when a sequence repeats after a reconnect', async () => {
    const harness = runHarness();
    await harness.normalise(busy);
    await harness.normalise(text('one'));
    const replay = await harness.normalise(busy);
    expect(replay.events).toEqual([]);
  });
});

describe('normalise (chat scope)', () => {
  it('never emits a chat start', async () => {
    const harness = chatHarness();
    const result = await harness.normalise(busy);
    expect(result.events).toEqual([]);
    expect(result.outcome).toBe('continue');
  });

  it('maps idle to chat.idle', async () => {
    const harness = chatHarness();
    const result = await harness.normalise(idle);
    expect(result.outcome).toBe('idle');
    expect(result.events).toEqual([
      { event: 'chat.idle', data: { chatId: CHAT_ID, seq: 1, ts: NOW } },
    ]);
  });

  it('maps a text part to chat.delta', async () => {
    const harness = chatHarness();
    const result = await harness.normalise(text('hello'));
    expect(result.events).toEqual([
      { event: 'chat.delta', data: { chatId: CHAT_ID, seq: 1, ts: NOW, delta: 'hello' } },
    ]);
  });

  it('maps a tool part to chat.tool without detail', async () => {
    const harness = chatHarness();
    const result = await harness.normalise(tool);
    expect(eventNames(result.events)).toEqual(['chat.tool']);
    expect(result.events[0]?.data).toEqual({
      chatId: CHAT_ID,
      seq: 1,
      ts: NOW,
      tool: 'bash',
      status: 'ok',
    });
  });

  it('maps a permission request to chat.permission', async () => {
    const harness = chatHarness();
    const result = await harness.normalise(permission);
    expect(harness.approvals).toHaveLength(1);
    expect(result.events).toEqual([
      {
        event: 'chat.permission',
        data: {
          chatId: CHAT_ID,
          seq: 1,
          ts: NOW,
          approvalId: 'apv_fixture02',
          tool: 'bash',
          title: 'Run the gate',
        },
      },
    ]);
  });

  it('reports a model error in a chat scope too', async () => {
    const harness = chatHarness();
    const result = await harness.normalise(failure);
    expect(result.outcome).toBe('error');
    expect(result.failure?.code).toBe('model_error');
    expect(result.events).toEqual([]);
  });

  it('reports usage in a chat scope without an event', async () => {
    const harness = chatHarness();
    const result = await harness.normalise(usage);
    expect(result.usage?.tokensIn).toBe(12);
    expect(result.events).toEqual([]);
  });
});
