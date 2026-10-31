/**
 * The e2e harness has no wall clock and no entropy of its own: the fixture commit date is
 * `FIXED_NOW` and every harness-side name or number that could drift comes from
 * `seededRandom(FIXED_SEED)`. Nothing under `e2e/` reads `Date.now()` or `Math.random()`.
 */

/** The one date the fixture is allowed to know. Matches the fake GitHub's own base time. */
export const FIXED_NOW = '2026-01-01T00:00:00.000Z';

/** The one seed: 0xc0de. */
export const FIXED_SEED = 0xc0de;

/**
 * mulberry32. Same seed, same sequence, in every Node process: `[0, 1)`.
 *
 * @param {number} [seed]
 * @returns {() => number}
 */
export function seededRandom(seed = FIXED_SEED) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKEN_ALPHABET = '0123456789abcdef';
const TOKEN_LENGTH = 8;

/** A short deterministic token drawn from `FIXED_SEED`, used to name every e2e temp root. */
export function seededToken() {
  const random = seededRandom();
  let token = '';
  for (let index = 0; index < TOKEN_LENGTH; index += 1) {
    token += TOKEN_ALPHABET[Math.floor(random() * TOKEN_ALPHABET.length)];
  }
  return token;
}

/**
 * The `now` the workspace manager is built with: the same fixed date, never the clock.
 *
 * @returns {Date}
 */
export function fixedDate() {
  return new Date(FIXED_NOW);
}
