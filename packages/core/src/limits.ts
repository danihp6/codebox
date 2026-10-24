export type CostGuardCode = 'cost_cap_reached' | 'job_cost_exceeded';

export type CostGuardResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: CostGuardCode; readonly message: string };

export interface CostGuardInput {
  readonly spentTodayUsd: number;
  readonly dailyCapUsd: number;
  readonly runCostUsd: number;
  readonly jobMaxCostUsd: number | null;
}

export function checkCost(input: CostGuardInput): CostGuardResult {
  if (input.dailyCapUsd > 0 && input.spentTodayUsd + input.runCostUsd >= input.dailyCapUsd) {
    return {
      allowed: false,
      code: 'cost_cap_reached',
      message: `The daily cost cap of ${input.dailyCapUsd} USD is reached.`,
    };
  }
  if (input.jobMaxCostUsd !== null && input.runCostUsd >= input.jobMaxCostUsd) {
    return {
      allowed: false,
      code: 'job_cost_exceeded',
      message: `The job cost cap of ${input.jobMaxCostUsd} USD is reached.`,
    };
  }
  return { allowed: true };
}

export interface TimeoutCheck {
  readonly expired: boolean;
  readonly elapsedMs: number;
}

export function checkRunTimeout(input: {
  readonly startedAt: string;
  readonly now: string;
  readonly timeoutSeconds: number;
}): TimeoutCheck {
  const elapsedMs = Date.parse(input.now) - Date.parse(input.startedAt);
  return { expired: elapsedMs >= 0 && elapsedMs >= input.timeoutSeconds * 1000, elapsedMs };
}
