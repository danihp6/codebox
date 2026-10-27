// Types: the wire-agnostic vocabulary of the package.
export type {
  AgentHealth,
  AgentRef,
  AgentRuntime,
  AgentRuntimeOptions,
  CreateSessionInput,
  EventFilter,
  FetchLike,
  ModelRef,
  PermissionReply,
  PromptOptions,
  RawAgentEvent,
  SessionRef,
} from './types.js';

// Errors: one typed failure surface for every method.
export { AgentError, isRetryable, toContractErrorCode } from './errors.js';
export type { AgentErrorCode } from './errors.js';

// Client: the fetch-based AgentRuntime over the pinned V2 HTTP surface.
export { createAgentRuntime } from './client.js';

// Wire: the decoders and the encoder, none of which throw.
export {
  decodeAgents,
  decodeEvent,
  decodeHealth,
  decodeModels,
  decodeSession,
  encodeEvent,
} from './wire.js';

// Normalise: raw agent events into contract SSE events.
export { createNormaliser } from './normalise.js';
export type {
  AgentFailure,
  AgentUsage,
  ApprovalRequestSignal,
  NormalisableEventName,
  NormalisationOutcome,
  NormalisationResult,
  NormalisedEvent,
  Normalise,
  NormaliserOptions,
  NormaliserScope,
} from './normalise.js';

// Prompt: the versioned unattended envelope and the chat handoff, as data.
export { RUN_ENVELOPE_TEMPLATE, RUN_ENVELOPE_VERSION, buildRunEnvelope } from './prompt.js';
export type { RunEnvelopeInput } from './prompt.js';
export { CHAT_HANDOFF_TURNS, CHAT_HANDOFF_VERSION, buildChatHandoff } from './prompt.js';
export type { ChatHandoffInput, ChatHandoffReason, ChatHandoffTurn } from './prompt.js';

// Supervisor: start, probe and restart the server with injected process and clock.
export { createSupervisor } from './supervisor.js';
export type {
  ChildHandle,
  PortProbe,
  PortState,
  SpawnFn,
  Supervisor,
  SupervisorOptions,
  SupervisorState,
  SupervisorStatus,
} from './supervisor.js';

// Fake: the in-process server every test binds to.
export { startFakeOpenCode } from './fake.js';
export type { FakeOpenCode, FakeOpenCodeOptions } from './fake.js';
