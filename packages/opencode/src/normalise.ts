import type { SseEvent } from '@codebox/contracts';
import type { AgentErrorCode } from './errors.js';
import type { RawAgentEvent } from './types.js';

export type NormalisableEventName =
  | 'run.started'
  | 'run.output'
  | 'run.tool'
  | 'run.permission'
  | 'chat.delta'
  | 'chat.tool'
  | 'chat.permission'
  | 'chat.idle';

export type NormalisedEvent = Extract<SseEvent, { event: NormalisableEventName }>;

export type NormaliserScope =
  | { readonly kind: 'run'; readonly runId: string; readonly branch: string }
  | { readonly kind: 'chat'; readonly chatId: string };

export interface ApprovalRequestSignal {
  readonly permissionId: string;
  readonly tool: string;
  readonly title: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface NormaliserOptions {
  readonly scope: NormaliserScope;
  readonly nextSeq: () => number;
  readonly now: () => string;
  readonly resolveApproval: (request: ApprovalRequestSignal) => Promise<string>;
}

export type NormalisationOutcome = 'continue' | 'idle' | 'error';

export interface AgentFailure {
  readonly code: AgentErrorCode;
  readonly message: string;
}

export interface AgentUsage {
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
}

export interface NormalisationResult {
  readonly events: readonly NormalisedEvent[];
  readonly outcome: NormalisationOutcome;
  readonly failure: AgentFailure | null;
  readonly usage: AgentUsage | null;
}

export type Normalise = (raw: RawAgentEvent) => Promise<NormalisationResult>;

export function createNormaliser(options: NormaliserOptions): Normalise {
  const scope = options.scope;
  let started = false;

  function base(): { seq: number; ts: string } {
    return { seq: options.nextSeq(), ts: options.now() };
  }

  function idle(): NormalisationResult {
    if (scope.kind === 'chat') {
      return {
        events: [{ event: 'chat.idle', data: { chatId: scope.chatId, ...base() } }],
        outcome: 'idle',
        failure: null,
        usage: null,
      };
    }
    return { events: [], outcome: 'idle', failure: null, usage: null };
  }

  function continueWith(events: readonly NormalisedEvent[]): NormalisationResult {
    return { events, outcome: 'continue', failure: null, usage: null };
  }

  return async function normalise(raw: RawAgentEvent): Promise<NormalisationResult> {
    switch (raw.type) {
      case 'session.updated': {
        if (raw.status === 'idle') return idle();
        if (scope.kind === 'chat' || started) return continueWith([]);
        started = true;
        return continueWith([
          {
            event: 'run.started',
            data: { runId: scope.runId, branch: scope.branch, ...base() },
          },
        ]);
      }
      case 'message.part.text': {
        if (scope.kind === 'chat') {
          return continueWith([
            { event: 'chat.delta', data: { chatId: scope.chatId, delta: raw.delta, ...base() } },
          ]);
        }
        return continueWith([
          { event: 'run.output', data: { runId: scope.runId, delta: raw.delta, ...base() } },
        ]);
      }
      case 'message.part.tool': {
        const tool = { tool: raw.tool, status: raw.status };
        if (scope.kind === 'chat') {
          return continueWith([
            { event: 'chat.tool', data: { chatId: scope.chatId, ...tool, ...base() } },
          ]);
        }
        return continueWith([
          { event: 'run.tool', data: { runId: scope.runId, ...tool, ...base() } },
        ]);
      }
      case 'permission.updated': {
        const approvalId = await options.resolveApproval({
          permissionId: raw.permissionId,
          tool: raw.tool,
          title: raw.title,
          input: raw.input,
        });
        const permission = { approvalId, tool: raw.tool, title: raw.title };
        if (scope.kind === 'chat') {
          return continueWith([
            { event: 'chat.permission', data: { chatId: scope.chatId, ...permission, ...base() } },
          ]);
        }
        return continueWith([
          { event: 'run.permission', data: { runId: scope.runId, ...permission, ...base() } },
        ]);
      }
      case 'session.error':
        return {
          events: [],
          outcome: 'error',
          failure: { code: 'model_error', message: raw.message },
          usage: null,
        };
      case 'session.usage':
        return {
          events: [],
          outcome: 'continue',
          failure: null,
          usage: {
            model: raw.model,
            tokensIn: raw.tokensIn,
            tokensOut: raw.tokensOut,
            costUsd: raw.costUsd,
          },
        };
    }
  };
}
