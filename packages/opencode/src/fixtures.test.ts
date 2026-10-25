import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sseEventSchema } from '../../contracts/src/events.js';
import { timestampSchema } from '../../contracts/src/primitives.js';
import { createAgentRuntime } from './client.js';
import { AgentError } from './errors.js';
import type { FakeOpenCode } from './fake.js';
import { startFakeOpenCode } from './fake.js';
import type {
  ApprovalRequestSignal,
  Normalise,
  NormalisationResult,
  NormalisedEvent,
  NormaliserScope,
} from './normalise.js';
import { createNormaliser } from './normalise.js';
import type { AgentRuntime, RawAgentEvent } from './types.js';
import { decodeEvent, encodeEvent } from './wire.js';

const FIXTURES = ['run-success', 'permission', 'interrupt', 'stream-drop', 'server-crash'] as const;
const RUN_ID = 'run_fixture01';
const BRANCH = 'cb/run_fixture01-demo';
const CHAT_ID = 'chat_fixture01';
const APPROVAL_ID = 'apv_fixture01';
const NOW = '2026-10-24T18:04:02Z';
const SESSION_DIRECTORY = '/tmp/cb-run-fixture01';

function readFixture(name: string): readonly RawAgentEvent[] {
  const path = new URL(`../fixtures/${name}.jsonl`, import.meta.url);
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  return lines.map((line, index) => {
    const frame: unknown = JSON.parse(line);
    const event = decodeEvent(frame);
    if (event === null) throw new Error(`fixture ${name} line ${index + 1} does not decode`);
    return event;
  });
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${label}`);
}

class Collector {
  readonly results: NormalisationResult[] = [];
  readonly events: NormalisedEvent[] = [];
  error: AgentError | null = null;
  private readonly iterator: AsyncIterator<RawAgentEvent>;

  constructor(
    iterable: AsyncIterable<RawAgentEvent>,
    private readonly normalise: Normalise,
  ) {
    this.iterator = iterable[Symbol.asyncIterator]();
  }

  async pull(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) await this.step();
  }

  async untilStopped(): Promise<void> {
    for (;;) {
      const stopped = await this.step();
      if (stopped) return;
    }
  }

  async close(): Promise<void> {
    await this.iterator.return?.(undefined);
  }

  get names(): string[] {
    return this.events.map((event) => event.event);
  }

  private async step(): Promise<boolean> {
    let raw: RawAgentEvent;
    try {
      const next = await this.iterator.next();
      if (next.done === true) throw new Error('the stream ended unexpectedly');
      raw = next.value;
    } catch (error) {
      if (error instanceof AgentError) {
        this.error = error;
        return true;
      }
      throw error;
    }
    const result = await this.normalise(raw);
    this.results.push(result);
    this.events.push(...result.events);
    return result.outcome !== 'continue';
  }
}

interface Replay {
  readonly server: FakeOpenCode;
  readonly runtime: AgentRuntime;
  readonly sessionId: string;
  readonly collector: Collector;
  readonly approvals: ApprovalRequestSignal[];
}

interface ScenarioOutcome {
  readonly events: readonly NormalisedEvent[];
  readonly results: readonly NormalisationResult[];
  readonly approvals: readonly ApprovalRequestSignal[];
  readonly error: AgentError | null;
  readonly collector: Collector;
}

function streamRequests(server: FakeOpenCode): number {
  return server.requests.filter((request) => request === 'GET /api/event').length;
}

async function begin(fixtureName: string, scripted?: readonly RawAgentEvent[]): Promise<Replay> {
  const server = await startFakeOpenCode({ token: null, version: '1.18.0' });
  const runtime = createAgentRuntime({
    baseUrl: server.url,
    token: null,
    healthPath: '/api/info',
    fetch: (url, init) => globalThis.fetch(url, init),
    requestTimeoutMs: 5_000,
    reconnectDelayMs: 0,
    sleep: async () => {},
  });
  const session = await runtime.createSession({
    directory: SESSION_DIRECTORY,
    title: `cb-${fixtureName}`,
    agent: 'build',
    model: null,
  });
  const approvals: ApprovalRequestSignal[] = [];
  let seq = 0;
  const normalise = createNormaliser({
    scope: { kind: 'run', runId: RUN_ID, branch: BRANCH },
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    now: () => NOW,
    resolveApproval: async (request) => {
      approvals.push(request);
      return APPROVAL_ID;
    },
  });
  server.script(session.sessionId, scripted ?? readFixture(fixtureName));
  const collector = new Collector(runtime.subscribe({ sessionId: session.sessionId }), normalise);
  return { server, runtime, sessionId: session.sessionId, collector, approvals };
}

function outcome(replay: Replay): ScenarioOutcome {
  return {
    events: replay.collector.events,
    results: replay.collector.results,
    approvals: replay.approvals,
    error: replay.collector.error,
    collector: replay.collector,
  };
}

async function replayRunSuccess(): Promise<ScenarioOutcome> {
  const replay = await begin('run-success');
  try {
    const pump = replay.collector.untilStopped();
    await waitFor(() => streamRequests(replay.server) === 1, 'the stream');
    await replay.runtime.prompt(replay.sessionId, 'ignored');
    await pump;
    return outcome(replay);
  } finally {
    await replay.collector.close();
    await replay.server.close();
  }
}

async function replayPermission(): Promise<ScenarioOutcome> {
  const replay = await begin('permission');
  try {
    const pump = replay.collector.pull(2);
    await waitFor(() => streamRequests(replay.server) === 1, 'the stream');
    await replay.runtime.prompt(replay.sessionId, 'ignored');
    await pump;
    return outcome(replay);
  } finally {
    await replay.collector.close();
    await replay.server.close();
  }
}

async function replayInterrupt(): Promise<ScenarioOutcome> {
  const replay = await begin('interrupt');
  try {
    const pump = replay.collector.untilStopped();
    await waitFor(() => streamRequests(replay.server) === 1, 'the stream');
    await replay.runtime.prompt(replay.sessionId, 'ignored');
    await pump;
    return outcome(replay);
  } finally {
    await replay.collector.close();
    await replay.server.close();
  }
}

const STREAM_DROP_SPLIT = 3;

async function replayStreamDrop(): Promise<ScenarioOutcome> {
  const fixture = readFixture('stream-drop');
  const replay = await begin('stream-drop', fixture.slice(0, STREAM_DROP_SPLIT));
  try {
    const first = replay.collector.pull(STREAM_DROP_SPLIT);
    await waitFor(() => streamRequests(replay.server) === 1, 'the first stream');
    await replay.runtime.prompt(replay.sessionId, 'ignored');
    await first;

    replay.server.dropStream(replay.sessionId);
    const second = replay.collector.pull(2);
    await waitFor(() => streamRequests(replay.server) === 2, 'the reconnect');
    replay.server.script(replay.sessionId, fixture.slice(STREAM_DROP_SPLIT));
    await replay.runtime.prompt(replay.sessionId, 'ignored');
    await second;

    replay.server.dropStream(replay.sessionId);
    await replay.collector.untilStopped();
    return outcome(replay);
  } finally {
    await replay.collector.close();
    await replay.server.close();
  }
}

async function replayServerCrash(): Promise<ScenarioOutcome> {
  const replay = await begin('server-crash');
  try {
    const pump = replay.collector.pull(2);
    await waitFor(() => streamRequests(replay.server) === 1, 'the stream');
    await replay.runtime.prompt(replay.sessionId, 'ignored');
    await pump;

    await replay.server.close();
    await replay.collector.untilStopped();
    return outcome(replay);
  } finally {
    await replay.collector.close();
    await replay.server.close();
  }
}

const SCENARIOS: Readonly<Record<string, () => Promise<ScenarioOutcome>>> = {
  'run-success': replayRunSuccess,
  permission: replayPermission,
  interrupt: replayInterrupt,
  'stream-drop': replayStreamDrop,
  'server-crash': replayServerCrash,
};

const RAW_CASES: readonly RawAgentEvent[] = [
  { type: 'session.updated', sessionId: 'ses_fixture01', status: 'busy' },
  { type: 'session.updated', sessionId: 'ses_fixture01', status: 'idle' },
  {
    type: 'message.part.text',
    sessionId: 'ses_fixture01',
    messageId: 'msg_fixture01',
    delta: 'a\n',
  },
  {
    type: 'message.part.tool',
    sessionId: 'ses_fixture01',
    messageId: 'msg_fixture01',
    tool: 'bash',
    status: 'start',
  },
  {
    type: 'permission.updated',
    sessionId: 'ses_fixture01',
    permissionId: 'per_fixture01',
    tool: 'bash',
    title: 'Run the gate',
    input: { command: 'npm run gate' },
  },
  { type: 'session.error', sessionId: 'ses_fixture01', message: 'the model refused' },
  {
    type: 'session.usage',
    sessionId: 'ses_fixture01',
    model: 'anthropic/claude-sonnet-4',
    tokensIn: 12,
    tokensOut: 34,
    costUsd: 0.0012,
  },
];

async function normalisedCases(scope: NormaliserScope): Promise<readonly NormalisedEvent[]> {
  const events: NormalisedEvent[] = [];
  let seq = 0;
  const normalise = createNormaliser({
    scope,
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    now: () => NOW,
    resolveApproval: async () => APPROVAL_ID,
  });
  for (const raw of RAW_CASES) {
    const result = await normalise(raw);
    events.push(...result.events);
  }
  return events;
}

describe('fixtures', () => {
  it('ships the five scenario files and every line decodes', () => {
    for (const name of FIXTURES) {
      const raw = readFixture(name);
      expect(raw.length).toBeGreaterThan(0);
      for (const event of raw) {
        expect(decodeEvent(JSON.parse(JSON.stringify(encodeEvent(event))))).toEqual(event);
      }
    }
  });

  it('keeps every fixture free of tokens and absolute paths', () => {
    for (const name of FIXTURES) {
      const text = readFileSync(new URL(`../fixtures/${name}.jsonl`, import.meta.url), 'utf8');
      expect(text).not.toMatch(/\/var\/|\/home\/|\/etc\/|\/srv\/|api[_-]?key|bearer|sk-|ghp_/i);
      expect(text).not.toMatch(/[A-Za-z0-9_-]{32,}/);
    }
  });

  it('fixture replay: run-success produces the documented timeline', async () => {
    const result = await SCENARIOS['run-success']();
    expect(result.collector.names).toEqual([
      'run.started',
      'run.output',
      'run.output',
      'run.tool',
      'run.output',
    ]);
    expect(result.results.at(-1)?.outcome).toBe('idle');
    const usage = result.results.find((entry) => entry.usage !== null);
    expect(usage?.usage).toEqual({
      model: 'anthropic/claude-sonnet-4',
      tokensIn: 128,
      tokensOut: 64,
      costUsd: 0.0042,
    });
    expect(result.error).toBeNull();
  });

  it('fixture replay: permission resolves one approval and emits it', async () => {
    const result = await SCENARIOS['permission']();
    expect(result.collector.names).toEqual(['run.started', 'run.permission']);
    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]).toEqual({
      permissionId: 'per_fixture01',
      tool: 'bash',
      title: 'Run the repository gate',
      input: { command: 'npm run gate' },
    });
    expect(result.events[1]?.data).toMatchObject({
      approvalId: APPROVAL_ID,
      tool: 'bash',
      title: 'Run the repository gate',
    });
    expect(JSON.stringify(result.events)).not.toContain('npm run gate');
  });

  it('fixture replay: interrupt ends idle after one output', async () => {
    const result = await SCENARIOS['interrupt']();
    expect(result.collector.names).toEqual(['run.started', 'run.output']);
    expect(result.results.at(-1)?.outcome).toBe('idle');
    expect(result.error).toBeNull();
  });

  it('fixture replay: stream-drop reconnects once without duplicating output', async () => {
    const result = await SCENARIOS['stream-drop']();
    expect(result.collector.names).toEqual([
      'run.started',
      'run.output',
      'run.output',
      'run.output',
    ]);
    const deltas = result.collector.events
      .filter((event) => event.event === 'run.output')
      .map((event) => (event.data as { delta: string }).delta)
      .sort();
    expect(deltas).toEqual(['First chunk.\n', 'Second chunk.\n', 'Third chunk.\n']);
    expect(result.error?.code).toBe('stream_lost');
  });

  it('fixture replay: server-crash reports agent_unavailable', async () => {
    const result = await SCENARIOS['server-crash']();
    expect(result.collector.names).toEqual(['run.started', 'run.output']);
    expect(result.error).toBeInstanceOf(AgentError);
    expect(result.error?.code).toBe('agent_unavailable');
  });

  it('every normalised event validates against its contract schema', async () => {
    const produced: NormalisedEvent[] = [];
    for (const scenario of Object.values(SCENARIOS)) {
      const result = await scenario();
      produced.push(...result.events);
    }
    produced.push(...(await normalisedCases({ kind: 'run', runId: RUN_ID, branch: BRANCH })));
    produced.push(...(await normalisedCases({ kind: 'chat', chatId: CHAT_ID })));

    expect(produced.length).toBeGreaterThanOrEqual(20);
    for (const event of produced) {
      expect(sseEventSchema.safeParse(event).success).toBe(true);
      expect(timestampSchema.safeParse(event.data.ts).success).toBe(true);
    }
  });
});
