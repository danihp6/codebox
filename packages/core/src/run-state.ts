import type { RunState } from '@codebox/contracts';

export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = Object.freeze({
  queued: Object.freeze(['preparing', 'failed', 'cancelled'] as const),
  preparing: Object.freeze(['running', 'failed', 'cancelled'] as const),
  running: Object.freeze(['gating', 'failed', 'cancelled'] as const),
  gating: Object.freeze(['pr_open', 'failed', 'cancelled'] as const),
  pr_open: Object.freeze(['merging', 'failed'] as const),
  merging: Object.freeze(['succeeded', 'pr_open', 'failed'] as const),
  succeeded: Object.freeze([] as const),
  failed: Object.freeze([] as const),
  cancelled: Object.freeze([] as const),
});

export const TERMINAL_STATES: readonly RunState[] = Object.freeze([
  'succeeded',
  'failed',
  'cancelled',
] as const);

export const CANCELLABLE_STATES: readonly RunState[] = Object.freeze([
  'queued',
  'preparing',
  'running',
  'gating',
] as const);

export type TransitionRejectionCode = 'illegal_transition' | 'terminal_state' | 'same_state';

export type TransitionOutcome =
  | { readonly allowed: true; readonly from: RunState; readonly to: RunState }
  | {
      readonly allowed: false;
      readonly from: RunState;
      readonly to: RunState;
      readonly code: TransitionRejectionCode;
      readonly message: string;
    };

function reject(from: RunState, to: RunState, code: TransitionRejectionCode): TransitionOutcome {
  return {
    allowed: false,
    from,
    to,
    code,
    message: `Illegal transition ${from} → ${to}.`,
  };
}

export function transitionRun(from: RunState, to: RunState): TransitionOutcome {
  if (from === to) return reject(from, to, 'same_state');
  if (isTerminal(from)) return reject(from, to, 'terminal_state');
  const allowed: readonly RunState[] | undefined = RUN_TRANSITIONS[from];
  if (allowed === undefined || !allowed.includes(to)) {
    return reject(from, to, 'illegal_transition');
  }
  return { allowed: true, from, to };
}

export function canTransition(from: RunState, to: RunState): boolean {
  return transitionRun(from, to).allowed;
}

export function canCancel(state: RunState): boolean {
  return CANCELLABLE_STATES.includes(state);
}

export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.includes(state);
}
