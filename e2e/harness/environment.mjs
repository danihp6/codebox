import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '@codebox/contracts';
import { startDaemon } from '@codebox/daemon';
import { seededToken } from './clock.mjs';
import { createSeedRepo, seedCloneCache } from './git-fixture.mjs';
import { createApiClient, expectStatus, readJson } from './http.mjs';
import { startE2eGitHub } from '../fakes/github.mjs';
import { startE2eOpenCode } from '../fakes/opencode.mjs';

export const E2E_SLUG = 'acme/widgets';
export const E2E_OWNER = 'acme';
export const E2E_REPO = 'widgets';
export const E2E_DEFAULT_BRANCH = 'main';
export const E2E_GITHUB_TOKEN = 'e2e-token';
export const E2E_GATE = 'test -f e2e-change.txt';
export const E2E_HARNESS_DEVICE = 'e2e harness';

/** The literal prefix of every temp root this harness creates; the seed decides it. */
export const E2E_ROOT_PREFIX = `cb-e2e-${seededToken()}-`;

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(REPO_ROOT, 'apps', 'app', 'dist', 'browser');
const POLL_INTERVAL_MS = 100;
const RUN_TIMEOUT_MS = 60_000;
const TERMINAL_RUN_STATES = Object.freeze(['succeeded', 'failed', 'cancelled']);

function frozenEnv(paths, opencodeUrl, githubUrl) {
  return {
    CB_ENV: 'test',
    CB_SESSION_SECRET: 'e2e-session-secret-0123456789abcdef',
    CB_BIND: '127.0.0.1:0',
    CB_LOG_LEVEL: 'warn',
    CB_STATE_DIR: paths.stateDir,
    CB_TMP_DIR: paths.tmpDir,
    CB_REPO_ROOT: paths.repoRoot,
    CB_WORKSPACE_ROOT: paths.workspaceRoot,
    CB_INSTALL_DIR: paths.installDir,
    CB_OPENCODE_URL: opencodeUrl,
    CB_OPENCODE_HEALTH_PATH: '/api/info',
    CB_GITHUB_API_URL: githubUrl,
    CB_GITHUB_TOKEN: E2E_GITHUB_TOKEN,
    CB_GATE_DEFAULT: E2E_GATE,
    CB_GATE_SHELL: '/bin/bash',
    CB_AUTOMERGE: 'on',
    CB_MERGE_METHOD: 'squash',
    CB_PROBATION_RUNS: '0',
    CB_MAX_CONCURRENCY: '1',
    CB_DIFF_MAX_FILES: '40',
    CB_DIFF_MAX_LINES: '2000',
  };
}

/** Only the non-`CB_` half of the caller's environment is inherited, so a stray key cannot win. */
function inheritedEnv() {
  const inherited = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CB_') || value === undefined) continue;
    inherited[key] = value;
  }
  return inherited;
}

/** A P-256 key pair in the JWK form `POST /v1/pair` takes; the private half never leaves. */
async function devicePublicKey() {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await globalThis.crypto.subtle.exportKey('jwk', pair.publicKey);
  return JSON.stringify(jwk);
}

/**
 * `POST /v1/pair/code` from loopback and `POST /v1/pair` with a fresh P-256 device key. The
 * browser pairs its own device through the UI with a second code; the two never share a token.
 */
async function pairDevice(client, code, name) {
  const response = await client.request('/v1/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      deviceName: name,
      platform: 'cli',
      devicePublicKey: await devicePublicKey(),
    }),
  });
  await expectStatus(response, 200, 'POST /v1/pair');
  const body = await readJson(response);
  if (typeof body !== 'object' || body === null || typeof body['accessToken'] !== 'string') {
    throw new Error('POST /v1/pair returned no access token');
  }
  return body['accessToken'];
}

/** Stops the daemon and the fakes and removes the temp root, in that order, exactly once. */
function closer(steps) {
  let closed = false;
  return async function close() {
    if (closed) return;
    closed = true;
    for (const step of steps) {
      try {
        await step();
      } catch {
        // Every step is best effort: one failing stop must not leave the rest behind.
      }
    }
  };
}

function describeRun(run) {
  if (typeof run !== 'object' || run === null) return 'no run';
  const gate = run['gate'];
  const blockers = Array.isArray(run['blockers'])
    ? run['blockers'].map((blocker) => blocker?.['code']).join(',')
    : '';
  const gateStatus = typeof gate === 'object' && gate !== null ? gate['status'] : 'none';
  return `state=${run['state']} gate=${gateStatus} blockers=[${blockers}]`;
}

/**
 * One throwaway control plane: temp root, seed remote, clone cache, loopback GitHub and
 * OpenCode fakes, and a daemon on an ephemeral loopback port. Never `codebox.service`, never
 * port 4096, never `/var/lib/codebox`, never a real credential.
 *
 * @param {{ env?: Record<string, string> }} [options]
 * @returns {Promise<{
 *   baseUrl: string;
 *   stateDir: string;
 *   github: { url: string; requests: readonly unknown[]; close: () => Promise<void> };
 *   opencode: { url: string; requests: readonly string[]; close: () => Promise<void> };
 *   seedRemote: string;
 *   token: string;
 *   mintCode: (name?: string) => Promise<string>;
 *   latestRepoId: () => Promise<string>;
 *   waitForSucceeded: () => Promise<{ runId: string; branch: string; state: string }>;
 *   close: () => Promise<void>;
 * }>}
 */
export async function startEnvironment(options = {}) {
  const root = mkdtempSync(join(tmpdir(), E2E_ROOT_PREFIX));
  const paths = {
    stateDir: join(root, 'state'),
    tmpDir: join(root, 'tmp'),
    repoRoot: join(root, 'repos'),
    workspaceRoot: join(root, 'workspaces'),
    installDir: join(root, 'install'),
  };
  for (const directory of Object.values(paths)) mkdirSync(directory, { recursive: true });

  const seed = await createSeedRepo({
    root,
    slug: E2E_SLUG,
    defaultBranch: E2E_DEFAULT_BRANCH,
  });
  const github = await startE2eGitHub({
    token: E2E_GITHUB_TOKEN,
    owner: E2E_OWNER,
    repo: E2E_REPO,
    defaultBranch: E2E_DEFAULT_BRANCH,
    baseSha: seed.commit,
  });
  const opencode = await startE2eOpenCode({});
  await seedCloneCache({
    repoRoot: paths.repoRoot,
    slug: E2E_SLUG,
    remote: seed.remote,
    pushUrl: `https://x-access-token:${E2E_GITHUB_TOKEN}@github.com/${E2E_SLUG}.git`,
  });

  const daemonEnv = { ...inheritedEnv(), ...frozenEnv(paths, opencode.url, github.url) };
  for (const [key, value] of Object.entries(options.env ?? {})) daemonEnv[key] = value;
  parseConfig(daemonEnv);

  let handle;
  try {
    handle = await startDaemon({ env: daemonEnv, appDir: APP_DIR });
  } catch (error) {
    await opencode.close();
    await github.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }

  const baseUrl = `http://127.0.0.1:${handle.port}`;
  let token = null;
  let lastRun = null;
  const client = createApiClient({ baseUrl, token: () => token });

  async function mintCode(name = E2E_HARNESS_DEVICE) {
    const response = await client.request('/v1/pair/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await expectStatus(response, 201, 'POST /v1/pair/code');
    const body = await readJson(response);
    if (typeof body !== 'object' || body === null || typeof body['code'] !== 'string') {
      throw new Error('POST /v1/pair/code returned no code');
    }
    return body['code'];
  }

  async function latestRepoId() {
    const body = await client.json('/v1/repos');
    const data = typeof body === 'object' && body !== null ? body['data'] : null;
    const first = Array.isArray(data) ? data[0] : undefined;
    if (typeof first !== 'object' || first === null || typeof first['id'] !== 'string') {
      throw new Error('GET /v1/repos returned no repository');
    }
    return first['id'];
  }

  async function waitForSucceeded() {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    for (;;) {
      const body = await client.json('/v1/runs?limit=1', {}, deadline);
      const data = typeof body === 'object' && body !== null ? body['data'] : null;
      const run = Array.isArray(data) ? data[0] : undefined;
      if (typeof run === 'object' && run !== null) {
        lastRun = run;
        if (TERMINAL_RUN_STATES.includes(run['state'])) {
          if (run['state'] !== 'succeeded') {
            throw new Error(`run ${run['id']} ended ${describeRun(run)}`);
          }
          return { runId: run['id'], branch: run['branch'], state: run['state'] };
        }
      }
      if (Date.now() + POLL_INTERVAL_MS > deadline) {
        throw new Error(
          `the run did not reach a terminal state within 60 s: ${describeRun(lastRun)}`,
        );
      }
      await new Promise((done) => {
        setTimeout(done, POLL_INTERVAL_MS);
      });
    }
  }

  try {
    token = await pairDevice(client, await mintCode(), E2E_HARNESS_DEVICE);
  } catch (error) {
    await handle.stop('e2e pairing failed');
    await opencode.close();
    await github.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }

  return {
    baseUrl,
    stateDir: paths.stateDir,
    github,
    opencode,
    seedRemote: seed.remote,
    token,
    mintCode,
    latestRepoId,
    waitForSucceeded,
    close: closer([
      () => handle.stop('e2e finished'),
      () => opencode.close(),
      () => github.close(),
      () => rmSync(root, { recursive: true, force: true }),
    ]),
  };
}

export { POLL_INTERVAL_MS, RUN_TIMEOUT_MS };
