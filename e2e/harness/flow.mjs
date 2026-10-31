import { spawnSync } from 'node:child_process';
import {
  E2E_DEFAULT_BRANCH,
  E2E_GATE,
  E2E_SLUG,
  POLL_INTERVAL_MS,
  RUN_TIMEOUT_MS,
} from './environment.mjs';
import { createApiClient, expectStatus, readJson } from './http.mjs';

export const PUSHED_FILE_BODY = 'written by the e2e agent\n';

const BACKLOG_REF = 'Task-01';
const CHANGE_FILE = 'e2e-change.txt';
const GIT_TIMEOUT_MS = 60_000;

let attempts = 0;

function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    env: {
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env['HOME'] ?? '/tmp',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    },
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function field(body, key, label) {
  if (typeof body === 'object' && body !== null && typeof body[key] === 'string') return body[key];
  throw new Error(`${label} carried no string ${key}`);
}

function describe(run) {
  const gate = typeof run['gate'] === 'object' && run['gate'] !== null ? run['gate'] : {};
  const blockers = Array.isArray(run['blockers'])
    ? run['blockers'].map((blocker) => blocker?.['code']).join(',')
    : '';
  return `state=${run['state']} gate=${gate['status']} exit=${gate['exitCode']} blockers=[${blockers}]`;
}

/**
 * The API half of the happy path: one repo, one work, one run, gate, PR, merge, push.
 *
 * @param {Awaited<ReturnType<typeof import('./environment.mjs').startEnvironment>>} env
 * @returns {Promise<{
 *   repoId: string;
 *   workId: string;
 *   runId: string;
 *   branch: string;
 *   eventTypes: string[];
 *   pushedBranchSha: string;
 *   pushedFileBody: string;
 * }>}
 */
export async function runApiFlow(env) {
  attempts += 1;
  const client = createApiClient({ baseUrl: env.baseUrl, token: () => env.token });
  const deadline = Date.now() + RUN_TIMEOUT_MS;

  const repoBody = await client.request(
    '/v1/repos',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: E2E_SLUG,
        defaultBranch: E2E_DEFAULT_BRANCH,
        gate: E2E_GATE,
      }),
    },
    deadline,
  );
  await expectStatus(repoBody, 201, 'POST /v1/repos');
  const repoId = field(await readJson(repoBody), 'id', 'POST /v1/repos');

  const workBody = await client.request(
    '/v1/works',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId, backlogRef: BACKLOG_REF }),
    },
    deadline,
  );
  await expectStatus(workBody, 201, 'POST /v1/works');
  const workId = field(await readJson(workBody), 'id', 'POST /v1/works');

  const runBody = await client.request(
    `/v1/works/${workId}/runs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `e2e-${attempts}` },
      body: JSON.stringify({}),
    },
    deadline,
  );
  await expectStatus(runBody, 202, `POST /v1/works/${workId}/runs`);
  const started = await readJson(runBody);
  const runId = field(started, 'id', 'POST /v1/works/{id}/runs');
  let branch = field(started, 'branch', 'POST /v1/works/{id}/runs');

  let run = started;
  for (;;) {
    if (typeof run !== 'object' || run === null) {
      throw new Error(`GET /v1/runs/${runId} answered no run`);
    }
    if (run['state'] === 'succeeded') break;
    if (run['state'] === 'failed' || run['state'] === 'cancelled') {
      throw new Error(`run ${runId} ended ${describe(run)}`);
    }
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      throw new Error(`run ${runId} did not succeed within 60 s: ${describe(run)}`);
    }
    await new Promise((done) => {
      setTimeout(done, POLL_INTERVAL_MS);
    });
    const detail = await client.request(`/v1/runs/${runId}`, {}, deadline);
    await expectStatus(detail, 200, `GET /v1/runs/${runId}`);
    run = await readJson(detail);
    branch = field(run, 'branch', `GET /v1/runs/${runId}`);
  }

  if (run['gate']?.['status'] !== 'passed' || run['gate']?.['exitCode'] !== 0) {
    throw new Error(`run ${runId} succeeded with ${describe(run)}`);
  }
  if (!Array.isArray(run['blockers']) || run['blockers'].length > 0) {
    throw new Error(`run ${runId} succeeded with ${describe(run)}`);
  }

  const eventsResponse = await client.request(`/v1/runs/${runId}/events`, {}, deadline);
  await expectStatus(eventsResponse, 200, `GET /v1/runs/${runId}/events`);
  const events = await readJson(eventsResponse);
  const data = typeof events === 'object' && events !== null ? events['data'] : null;
  const eventTypes = (Array.isArray(data) ? data : []).map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('an event carried no type');
    return field(entry, 'type', 'an event');
  });
  if (eventTypes.length === 0) throw new Error(`run ${runId} recorded no events`);

  const ref = `refs/heads/${branch}`;
  const exists = git(env.seedRemote, ['--git-dir', env.seedRemote, 'show-ref', '--verify', ref]);
  if (exists.status !== 0) {
    throw new Error(`the seed remote has no ${branch}: ${exists.stderr}`);
  }
  const pushed = git(env.seedRemote, ['--git-dir', env.seedRemote, 'rev-parse', ref]);
  if (pushed.status !== 0) throw new Error(`git rev-parse ${ref} failed: ${pushed.stderr}`);
  const shown = git(env.seedRemote, [
    '--git-dir',
    env.seedRemote,
    'show',
    `${branch}:${CHANGE_FILE}`,
  ]);
  if (shown.status !== 0) throw new Error(`the seed remote has no ${CHANGE_FILE}: ${shown.stderr}`);
  if (shown.stdout !== PUSHED_FILE_BODY) {
    throw new Error(`the pushed file body is ${JSON.stringify(shown.stdout)}`);
  }

  return {
    repoId,
    workId,
    runId,
    branch,
    eventTypes,
    pushedBranchSha: pushed.stdout.trim(),
    pushedFileBody: shown.stdout,
  };
}
