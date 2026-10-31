import {
  E2E_DEFAULT_BRANCH,
  E2E_GATE,
  E2E_SLUG,
  startEnvironment,
} from '../harness/environment.mjs';
import { FIXTURE_REF } from '../harness/git-fixture.mjs';

export const SLUG = E2E_SLUG;
export const DEFAULT_BRANCH = E2E_DEFAULT_BRANCH;
export const GATE = E2E_GATE;
export const BACKLOG_REF = FIXTURE_REF;
export const BROWSER_DEVICE = 'e2e browser';

/**
 * One environment per test run, closed even when the assertions throw: `--repeat-each` runs
 * this whole flow again, and a second repository in the same database is a 409.
 *
 * @template T
 * @param {(environment: Awaited<ReturnType<typeof startEnvironment>>) => Promise<T>} run
 * @returns {Promise<T>}
 */
export async function withEnvironment(run) {
  const environment = await startEnvironment();
  try {
    return await run(environment);
  } finally {
    await environment.close();
  }
}
