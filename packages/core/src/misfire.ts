export type MisfireCode = 'not_due' | 'on_time' | 'outside_grace';

export interface MisfireDecision {
  readonly run: boolean;
  readonly code: MisfireCode;
  readonly ageSeconds: number;
}

export function resolveMisfire(input: {
  readonly scheduledFor: string;
  readonly now: string;
  readonly graceSeconds: number;
}): MisfireDecision {
  const ageSeconds = Math.floor((Date.parse(input.now) - Date.parse(input.scheduledFor)) / 1000);
  if (ageSeconds < 0) return { run: false, code: 'not_due', ageSeconds };
  if (ageSeconds < input.graceSeconds) return { run: true, code: 'on_time', ageSeconds };
  return { run: false, code: 'outside_grace', ageSeconds };
}
