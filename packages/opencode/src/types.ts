export type PermissionReply = 'once' | 'always' | 'reject';

export interface AgentHealth {
  readonly ok: boolean;
  readonly version: string;
}

export interface McpServerRef {
  readonly type: 'remote';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface CreateSessionInput {
  readonly directory: string;
  readonly title: string;
  readonly agent: string;
  readonly model: string | null;
  /** Chat sessions only: the routine tool server. A run never sets it (D41). */
  readonly mcp?: Readonly<Record<string, McpServerRef>>;
}

export interface SessionRef {
  readonly sessionId: string;
  readonly directory: string;
  readonly title: string;
}

export interface ModelRef {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
}

export interface AgentRef {
  readonly name: string;
  readonly mode: string;
}

export interface PromptOptions {
  readonly signal?: AbortSignal;
}

export type EventFilter = { readonly sessionId: string } | { readonly all: true };

export type RawAgentEvent =
  | {
      readonly type: 'session.updated';
      readonly sessionId: string;
      readonly status: 'busy' | 'idle';
    }
  | {
      readonly type: 'message.part.text';
      readonly sessionId: string;
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: 'message.part.tool';
      readonly sessionId: string;
      readonly messageId: string;
      readonly tool: string;
      readonly status: 'start' | 'ok' | 'error';
    }
  | {
      readonly type: 'permission.updated';
      readonly sessionId: string;
      readonly permissionId: string;
      readonly tool: string;
      readonly title: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'session.error'; readonly sessionId: string; readonly message: string }
  | {
      readonly type: 'session.usage';
      readonly sessionId: string;
      readonly model: string;
      readonly tokensIn: number;
      readonly tokensOut: number;
      readonly costUsd: number;
    };

export interface AgentRuntime {
  health(): Promise<AgentHealth>;
  createSession(input: CreateSessionInput): Promise<SessionRef>;
  prompt(sessionId: string, text: string, options?: PromptOptions): Promise<void>;
  subscribe(filter: EventFilter): AsyncIterable<RawAgentEvent>;
  interrupt(sessionId: string): Promise<void>;
  replyPermission(sessionId: string, requestId: string, reply: PermissionReply): Promise<void>;
  listModels(): Promise<readonly ModelRef[]>;
  listAgents(): Promise<readonly AgentRef[]>;
  closeSession(sessionId: string): Promise<void>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface AgentRuntimeOptions {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly healthPath: string;
  readonly fetch: FetchLike;
  readonly requestTimeoutMs: number;
  readonly reconnectDelayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}
