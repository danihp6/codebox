import { GUARDRAIL_IDS } from '@codebox/contracts';
import type { GuardrailId } from '@codebox/contracts';
import type { GuardrailFact, MergeBlocker } from '@codebox/core';
import type { RunDiff } from '@codebox/contracts';
import type { GateExecutionResult } from '../gate/run-gate.js';

export interface PrBodyInput {
  readonly title: string;
  readonly runId: string;
  readonly jobId: string | null;
  readonly agent: string;
  readonly model: string | null;
  readonly agentMessage: string;
  readonly gate: GateExecutionResult;
  readonly diff: RunDiff;
  readonly guardrails: readonly GuardrailFact[];
  readonly blockers: readonly MergeBlocker[];
  /** The gate command is not part of `GateExecutionResult`; the caller stored it on the run. */
  readonly gateCommand?: string;
}

export const PR_BODY_MESSAGE_MAX_CHARS = 2_000;
export const PR_BODY_GATE_TAIL_LINES = 20;
export const PR_BODY_FENCE = '```';

function clean(value: string): string {
  return value.trim();
}

function trimmedMessage(message: string): string {
  const cleaned = clean(message);
  return cleaned.length > PR_BODY_MESSAGE_MAX_CHARS
    ? cleaned.slice(0, PR_BODY_MESSAGE_MAX_CHARS).trimEnd()
    : cleaned;
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function gateSection(input: PrBodyInput): readonly string[] {
  const outcome = `exit ${input.gate.exitCode} in ${formatDuration(input.gate.durationMs)}`;
  const heading =
    input.gateCommand === undefined ? outcome : `\`${input.gateCommand}\` — ${outcome}`;
  const tail = input.gate.tail.slice(-PR_BODY_GATE_TAIL_LINES);
  return [
    '### Gate',
    '',
    heading,
    '',
    '<details>',
    '<summary>Last 20 lines</summary>',
    '',
    `${PR_BODY_FENCE}text`,
    ...(tail.length === 0 ? ['(no output)'] : tail),
    PR_BODY_FENCE,
    '',
    '</details>',
  ];
}

function guardrailLine(
  id: GuardrailId,
  fact: GuardrailFact | undefined,
  blockers: readonly MergeBlocker[],
): string {
  if (fact === undefined) return `- [ ] ${id}`;
  if (fact.state === 'pass') return `- [x] ${id}`;
  const blocker =
    fact.reason === undefined ? undefined : blockers.find((entry) => entry.code === fact.reason);
  const reason = blocker?.message ?? fact.reason;
  return reason === undefined ? `- [ ] ${id}` : `- [ ] ${id} — ${reason}`;
}

export function buildPrBody(input: PrBodyInput): string {
  const message = trimmedMessage(input.agentMessage);
  const guardrails = new Map<string, GuardrailFact>(
    input.guardrails.map((fact) => [fact.id, fact]),
  );
  const lines: string[] = [
    `## ${clean(input.title)}`,
    '',
    `Run: ${input.runId} · Job: ${input.jobId ?? '—'} · Agent: ${input.agent} · Model: ${input.model ?? '—'}`,
    '',
    '### What changed',
    '',
    message === '' ? '_The agent finished without a message._' : message,
    '',
    ...gateSection(input),
    '',
    '### Diff',
    '',
    `${input.diff.files} files · +${input.diff.added} −${input.diff.removed}`,
    '',
    '### Guardrails',
    '',
    ...GUARDRAIL_IDS.map((id) => guardrailLine(id, guardrails.get(id), input.blockers)),
  ];
  return `${lines.join('\n')}\n`;
}
