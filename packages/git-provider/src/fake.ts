import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export const FAKE_GITHUB_NOW_MS = Date.parse('2026-01-01T00:00:00.000Z');
const TOKEN_LIFETIME_MS = 3_600_000;

export interface FakeGitHubRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly body: unknown;
}

export interface FakeGitHubOptions {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
}

export interface FakeGitHub {
  readonly url: string;
  readonly requests: readonly FakeGitHubRequest[];
  readonly mintedTokens: readonly string[];
  unauthorizedNext(count: number): void;
  setChecks(
    headSha: string,
    checks: readonly {
      readonly name: string;
      readonly conclusion: string;
      readonly status: string;
    }[],
  ): void;
  setRequiredChecks(contexts: readonly string[] | null): void;
  setMergeable(number: number, mergeable: boolean): void;
  failNext(method: string, path: string, status: number): void;
  close(): Promise<void>;
}

interface FakeCheck {
  readonly name: string;
  readonly conclusion: string;
  readonly status: string;
}

interface FakePullRequest {
  readonly number: number;
  title: string;
  body: string;
  readonly head: string;
  readonly base: string;
  readonly headSha: string;
  readonly baseSha: string;
  state: 'open' | 'closed';
  merged: boolean;
  readonly draft: boolean;
  readonly labels: string[];
}

interface PendingFailure {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

function fakeSha(seed: number): string {
  return seed.toString(16).padStart(40, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bearerOf(authorization: string | null): string | null {
  if (authorization === null || !authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function parseJson(text: string): unknown {
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.setHeader('content-length', Buffer.byteLength(payload));
  response.end(payload);
}

function sendEmpty(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.end();
}

function sendStatus(response: ServerResponse, status: number): void {
  sendJson(response, status, { message: `fake github answered ${status}` });
}

export function startFakeGitHub(options: FakeGitHubOptions): Promise<FakeGitHub> {
  const owner = options.owner;
  const repo = options.repo;
  const repoBase = `/repos/${owner}/${repo}`;
  const requests: FakeGitHubRequest[] = [];
  const minted: string[] = [];
  const checksBySha = new Map<string, readonly FakeCheck[]>();
  const mergeableByNumber = new Map<number, boolean>();
  const failures: PendingFailure[] = [];
  const pullRequests: FakePullRequest[] = [];
  let requiredContexts: readonly string[] | null = null;
  let pendingUnauthorized = 0;
  let nextNumber = 1;

  const accepted = (token: string | null): boolean =>
    token !== null && (token === options.token || minted.includes(token));

  function pullRequestPayload(pullRequest: FakePullRequest): Record<string, unknown> {
    const mergeable = mergeableByNumber.get(pullRequest.number) ?? true;
    return {
      number: pullRequest.number,
      html_url: `https://github.com/${owner}/${repo}/pull/${pullRequest.number}`,
      state: pullRequest.state,
      draft: pullRequest.draft,
      merged: pullRequest.merged,
      mergeable: pullRequest.merged ? null : mergeable,
      head: { ref: pullRequest.head, sha: pullRequest.headSha },
      base: { ref: pullRequest.base, sha: pullRequest.baseSha },
      labels: pullRequest.labels.map((name) => ({ name })),
      title: pullRequest.title,
      body: pullRequest.body,
    };
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = `${url.pathname}${url.search}`;
    const authorization = request.headers.authorization ?? null;
    const body = parseJson(await readBody(request));
    requests.push({ method, path, authorization, body });

    const tokenRoute = /^\/app\/installations\/[^/]+\/access_tokens$/.exec(url.pathname);
    if (tokenRoute !== null) {
      if (method !== 'POST') return sendStatus(response, 404);
      const presented = bearerOf(authorization);
      if (presented === null || presented.split('.').length !== 3) {
        return sendJson(response, 401, { message: 'Bad credentials' });
      }
      const token = `ghs_fake_installation_${minted.length + 1}`;
      minted.push(token);
      return sendJson(response, 201, {
        token,
        expires_at: new Date(FAKE_GITHUB_NOW_MS + TOKEN_LIFETIME_MS).toISOString(),
      });
    }

    if (pendingUnauthorized > 0) {
      pendingUnauthorized -= 1;
      return sendJson(response, 401, { message: 'Bad credentials' });
    }

    if (!accepted(bearerOf(authorization))) {
      return sendJson(response, 401, { message: 'Bad credentials' });
    }

    const failure = failures.find(
      (entry) => entry.method === method && path.startsWith(entry.path),
    );
    if (failure !== undefined) {
      failures.splice(failures.indexOf(failure), 1);
      return sendStatus(response, failure.status);
    }

    if (url.pathname === repoBase) {
      if (method !== 'GET') return sendStatus(response, 404);
      return sendJson(response, 200, {
        full_name: `${owner}/${repo}`,
        default_branch: options.defaultBranch,
        private: true,
        permissions: { push: true, admin: false, maintain: false },
      });
    }
    if (!url.pathname.startsWith(`${repoBase}/`)) return sendStatus(response, 404);
    const segments = url.pathname.slice(repoBase.length + 1).split('/');
    const head = segments[0];

    if (head === 'pulls' && segments.length === 1) {
      if (method === 'GET') {
        const state = url.searchParams.get('state') ?? 'open';
        const headQuery = url.searchParams.get('head');
        const branch = headQuery === null ? null : headQuery.slice(`${owner}:`.length);
        const matched = pullRequests.filter(
          (pullRequest) =>
            pullRequest.state === state && (branch === null || pullRequest.head === branch),
        );
        const perPage = Number(url.searchParams.get('per_page') ?? '30');
        return sendJson(response, 200, matched.slice(0, perPage).map(pullRequestPayload));
      }
      if (method === 'POST') {
        if (!isRecord(body)) return sendStatus(response, 422);
        const branch = stringField(body, 'head');
        const base = stringField(body, 'base');
        const title = stringField(body, 'title');
        if (branch === null || base === null || title === null) return sendStatus(response, 422);
        const number = nextNumber;
        nextNumber += 1;
        const created: FakePullRequest = {
          number,
          title,
          body: stringField(body, 'body') ?? '',
          head: branch,
          base,
          headSha: fakeSha(number),
          baseSha: fakeSha(0),
          state: 'open',
          merged: false,
          draft: body['draft'] === true,
          labels: [],
        };
        pullRequests.push(created);
        return sendJson(response, 201, pullRequestPayload(created));
      }
      return sendStatus(response, 404);
    }

    if (head === 'pulls' && segments.length === 2) {
      const number = Number(segments[1]);
      const pullRequest = pullRequests.find((entry) => entry.number === number);
      if (pullRequest === undefined) return sendStatus(response, 404);
      if (method === 'GET') return sendJson(response, 200, pullRequestPayload(pullRequest));
      if (method === 'PATCH') {
        if (!isRecord(body)) return sendStatus(response, 422);
        const title = stringField(body, 'title');
        if (title !== null) pullRequest.title = title;
        const text = stringField(body, 'body');
        if (text !== null) pullRequest.body = text;
        if (body['state'] === 'closed') pullRequest.state = 'closed';
        return sendJson(response, 200, pullRequestPayload(pullRequest));
      }
      return sendStatus(response, 404);
    }

    if (head === 'pulls' && segments.length === 3 && segments[2] === 'merge') {
      if (method !== 'PUT') return sendStatus(response, 404);
      const number = Number(segments[1]);
      const pullRequest = pullRequests.find((entry) => entry.number === number);
      if (pullRequest === undefined) return sendStatus(response, 404);
      const mergeable = mergeableByNumber.get(number) ?? true;
      if (!mergeable) {
        return sendJson(response, 200, {
          merged: false,
          message: 'Pull Request is not mergeable',
        });
      }
      pullRequest.merged = true;
      pullRequest.state = 'closed';
      return sendJson(response, 200, {
        merged: true,
        sha: fakeSha(500 + number),
        message: 'Pull Request successfully merged',
      });
    }

    if (head === 'issues' && segments.length === 3 && segments[2] === 'labels') {
      if (method !== 'POST') return sendStatus(response, 404);
      const number = Number(segments[1]);
      const pullRequest = pullRequests.find((entry) => entry.number === number);
      if (pullRequest === undefined) return sendStatus(response, 404);
      if (!isRecord(body)) return sendStatus(response, 422);
      for (const label of stringList(body['labels'])) {
        if (!pullRequest.labels.includes(label)) pullRequest.labels.push(label);
      }
      return sendJson(
        response,
        200,
        pullRequest.labels.map((name) => ({ name })),
      );
    }

    if (head === 'commits' && segments.length === 3 && segments[2] === 'check-runs') {
      if (method !== 'GET') return sendStatus(response, 404);
      const sha = segments[1] ?? '';
      const checks = checksBySha.get(sha) ?? [];
      return sendJson(response, 200, {
        total_count: checks.length,
        check_runs: checks.map((check, index) => ({
          id: index + 1,
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          head_sha: sha,
        })),
      });
    }

    if (head === 'branches') {
      const protection = segments.indexOf('protection');
      if (protection !== -1 && segments[protection + 1] === 'required_status_checks') {
        if (method !== 'GET') return sendStatus(response, 404);
        if (requiredContexts === null) return sendStatus(response, 404);
        return sendJson(response, 200, {
          contexts: [...requiredContexts],
          checks: requiredContexts.map((context) => ({ context })),
        });
      }
      return sendStatus(response, 404);
    }

    if (head === 'git' && segments[1] === 'refs' && segments[2] === 'heads') {
      if (method !== 'DELETE') return sendStatus(response, 404);
      const branch = segments
        .slice(3)
        .map((segment) => decodeURIComponent(segment))
        .join('/');
      if (branch.length === 0) return sendStatus(response, 404);
      return sendEmpty(response, 204);
    }

    return sendStatus(response, 404);
  }

  const server: Server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) sendStatus(response, 500);
      else response.end();
    });
  });

  const listening = new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return listening.then((): FakeGitHub => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('fake github failed to bind a loopback port');
    }
    return {
      url: `http://127.0.0.1:${address.port}`,
      get requests(): readonly FakeGitHubRequest[] {
        return requests;
      },
      get mintedTokens(): readonly string[] {
        return minted;
      },
      unauthorizedNext(count: number): void {
        pendingUnauthorized = count;
      },
      setChecks(headSha, checks): void {
        checksBySha.set(
          headSha,
          checks.map((check) => ({ ...check })),
        );
      },
      setRequiredChecks(contexts): void {
        requiredContexts = contexts === null ? null : [...contexts];
      },
      setMergeable(number: number, mergeable: boolean): void {
        mergeableByNumber.set(number, mergeable);
      },
      failNext(method: string, path: string, status: number): void {
        failures.push({ method: method.toUpperCase(), path, status });
      },
      async close(): Promise<void> {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        });
      },
    };
  });
}
