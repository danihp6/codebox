import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';
import { FIXED_NOW, FIXED_SEED, seededRandom } from '../harness/clock.mjs';
import { E2E_ROOT_PREFIX, startEnvironment } from '../harness/environment.mjs';
import { PUSHED_FILE_BODY, runApiFlow } from '../harness/flow.mjs';

/** The one sequence a green run records: gate, PR, merge and push, in this order. */
const EXPECTED_EVENT_TYPES = [
  'run.queued',
  'run.started',
  'run.tool',
  'run.output',
  'run.tool',
  'run.gate',
  'run.pr',
  'run.merged',
  'run.finished',
];

const ID_PATTERN = /\b(?:run|wrk|job|sess|ses|dev|repo|apv)_[0-9A-Z]+/g;
const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;

/** The two iterations may differ only in the ids and timestamps production mints. */
function normaliseTypes(types) {
  return types.map((type) => type.replace(ID_PATTERN, '<id>').replace(TIMESTAMP_PATTERN, '<ts>'));
}

function e2eRoots() {
  return readdirSync(tmpdir()).filter((name) => name.startsWith(E2E_ROOT_PREFIX));
}

test('the fixed clock and seed drive the harness', () => {
  assert.equal(FIXED_NOW, '2026-01-01T00:00:00.000Z');
  assert.equal(FIXED_SEED, 0xc0de);
  const once = seededRandom(FIXED_SEED);
  const twice = seededRandom(FIXED_SEED);
  const first = [once(), once(), once()];
  assert.deepEqual(first, [twice(), twice(), twice()]);
  assert.deepEqual(first, [0.27511731814593077, 0.2046858360990882, 0.7116725160740316]);
  for (const value of first) assert.ok(value >= 0 && value < 1);
  const other = seededRandom(FIXED_SEED + 1);
  assert.notEqual(other(), first[0]);
  assert.ok(E2E_ROOT_PREFIX.startsWith('cb-e2e-'));
});

test('the API happy path succeeds twice with the same event sequence', async () => {
  const results = [];
  assert.deepEqual(e2eRoots(), [], 'a previous e2e temp root was left behind');

  for (const iteration of [1, 2]) {
    const environment = await startEnvironment();
    try {
      assert.ok(
        basename(dirname(environment.stateDir)).startsWith(E2E_ROOT_PREFIX),
        'the temp root is not named from the fixed seed',
      );
      const result = await runApiFlow(environment);
      results.push({ ...result, stateDir: environment.stateDir, baseUrl: environment.baseUrl });
      process.stdout.write(
        `e2e flow ${iteration}/2: succeeded, gate passed, ${result.eventTypes.length} events, branch ${result.branch}\n`,
      );
    } finally {
      await environment.close();
    }
    assert.deepEqual(e2eRoots(), [], `iteration ${iteration} left its temp root behind`);
  }

  const [first, second] = results;
  assert.ok(first !== undefined && second !== undefined);
  assert.notEqual(first.stateDir, second.stateDir, 'the second iteration reused a temp root');
  assert.notEqual(first.baseUrl, second.baseUrl, 'the second daemon reused a port');
  assert.deepEqual(normaliseTypes(first.eventTypes), EXPECTED_EVENT_TYPES);
  assert.deepEqual(normaliseTypes(second.eventTypes), EXPECTED_EVENT_TYPES);
  assert.deepEqual(normaliseTypes(second.eventTypes), normaliseTypes(first.eventTypes));

  for (const result of results) {
    assert.equal(result.pushedFileBody, PUSHED_FILE_BODY);
    assert.match(result.pushedBranchSha, /^[0-9a-f]{40}$/);
    assert.ok(result.branch.startsWith('cb/'));
    assert.notEqual(result.runId, '');
    assert.notEqual(result.workId, '');
    assert.notEqual(result.repoId, '');
  }
  process.stdout.write(
    `e2e flow: both iterations pushed ${PUSHED_FILE_BODY.trim()} to the seed remote\n`,
  );
});
