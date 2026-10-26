// Run state machine: the D14 table and its typed rejections.
export {
  RUN_TRANSITIONS,
  TERMINAL_STATES,
  CANCELLABLE_STATES,
  canTransition,
  transitionRun,
  canCancel,
  isTerminal,
} from './run-state.js';
export type { TransitionRejectionCode, TransitionOutcome } from './run-state.js';

// Guardrails: the D12 auto-merge evaluation over facts.
export { evaluateAutoMerge } from './guardrails.js';
export type { GuardrailFact, MergeBlocker, MergeFacts, MergeEvaluation } from './guardrails.js';

// Cron: the D13 five-field parser, next fire and zone rules.
export { parseCron, isValidTimezone, nextFire, nextFires } from './cron.js';
export type { ParsedCron, CronFailureCode, CronParseResult } from './cron.js';

// Misfire: the D13 grace window as a decision.
export { resolveMisfire } from './misfire.js';
export type { MisfireCode, MisfireDecision } from './misfire.js';

// Protected paths: the D26 glob rules and the default list.
export {
  DEFAULT_PROTECTED_PATHS,
  globToRegExp,
  matchesGlob,
  normaliseRepoPath,
  scanProtectedPaths,
} from './protected-paths.js';
export type { ProtectedPathHit } from './protected-paths.js';

// Diff budget: the D26 file and line budget.
export { DEFAULT_DIFF_BUDGET, evaluateDiffBudget } from './diff-budget.js';
export type { DiffSize, DiffBudget, DiffBudgetResult } from './diff-budget.js';

// Permissions: the D27 matrix as data.
export {
  PERMISSION_MATRIX,
  classifyTool,
  isInsideWorktree,
  decidePermission,
} from './permissions.js';
export type {
  PermissionMode,
  PermissionTool,
  PermissionDecision,
  PermissionRequest,
} from './permissions.js';

// Limits: the D29 cost and timeout guards.
export { checkCost, checkRunTimeout } from './limits.js';
export type { CostGuardCode, CostGuardResult, CostGuardInput, TimeoutCheck } from './limits.js';

// Admission: the D15 global and per-repository caps as a pure rule.
export { canAdmitRun } from './admission.js';
export type {
  ActiveRunRef,
  AdmissionCode,
  AdmissionDecision,
  AdmissionLimits,
  AdmissionQuery,
} from './admission.js';

// Usage: the telemetry window and its in-range summary.
export {
  USAGE_RANGES,
  RANGE_MILLISECONDS,
  usageWindow,
  utcDayOf,
  daysInWindow,
  summariseUsage,
} from './usage.js';
export type { UsageRange, UsageWindow, UsageEntry, UsageSummary } from './usage.js';
