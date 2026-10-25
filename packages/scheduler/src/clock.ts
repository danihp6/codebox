export const SCHEDULER_TICK_SECONDS_DEFAULT = 15;
export const SCHEDULER_TICK_SECONDS_MIN = 15;
export const SCHEDULER_TICK_SECONDS_MAX = 30;

/** Milliseconds until the next epoch-aligned tick; 1 <= result <= tickSeconds * 1000. */
export function nextTickDelay(nowMs: number, tickSeconds: number): number {
  if (!Number.isInteger(tickSeconds) || tickSeconds < 1) {
    throw new RangeError(`tickSeconds must be an integer of at least 1, got ${tickSeconds}.`);
  }
  const tickMs = tickSeconds * 1000;
  const remainder = ((nowMs % tickMs) + tickMs) % tickMs;
  return remainder === 0 ? tickMs : tickMs - remainder;
}

/** Accepts an integer in [MIN, MAX]; anything else is out of contract. */
export function isTickSeconds(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= SCHEDULER_TICK_SECONDS_MIN &&
    value <= SCHEDULER_TICK_SECONDS_MAX
  );
}
