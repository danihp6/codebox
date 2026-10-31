import { createServer } from 'node:http';
import { startFakeGitHub } from '@codebox/git-provider';

const FORWARDED_HEADERS = Object.freeze([
  'accept',
  'authorization',
  'content-type',
  'user-agent',
  'x-github-api-version',
]);
const JSON_TYPE = /(?:^|\/)json\b/i;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `base.sha` is the one fact the shipped fake cannot express: it answers `fakeSha(0)` for every
 * pull request, which would make `evaluateAutoMerge` park every run with `base_moved`. The
 * rewrite touches exactly that field and nothing else.
 *
 * @param {unknown} value
 * @param {string} baseSha
 * @returns {unknown}
 */
export function rewriteBaseSha(value, baseSha) {
  if (Array.isArray(value)) return value.map((entry) => rewriteBaseSha(entry, baseSha));
  if (!isRecord(value)) return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'base' && isRecord(entry) && typeof entry['sha'] === 'string') {
      output[key] = { ...entry, sha: baseSha };
      continue;
    }
    output[key] = rewriteBaseSha(entry, baseSha);
  }
  return output;
}

function forwardedHeaders(request) {
  const headers = {};
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers[name];
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    request.once('error', rejectBody);
    request.once('end', () => {
      resolveBody(Buffer.concat(chunks));
    });
  });
}

/**
 * The shipped `startFakeGitHub` behind a loopback proxy that reports the real seed commit as
 * every pull request's `base.sha`. Everything else — status, headers, body, the upstream
 * request log — is the fake's own.
 *
 * @param {{ token: string; owner: string; repo: string; defaultBranch: string; baseSha: string }} input
 * @returns {Promise<{
 *   url: string;
 *   requests: readonly import('@codebox/git-provider').FakeGitHubRequest[];
 *   close: () => Promise<void>;
 * }>}
 */
export async function startE2eGitHub(input) {
  const upstream = await startFakeGitHub({
    token: input.token,
    owner: input.owner,
    repo: input.repo,
    defaultBranch: input.defaultBranch,
  });
  let closed = false;

  const proxy = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const target = new URL(request.url ?? '/', upstream.url);
      const forwarded = {
        method: request.method ?? 'GET',
        headers: forwardedHeaders(request),
      };
      if (body.length > 0) forwarded.body = body;
      const answer = await fetch(target, forwarded);
      const contentType = answer.headers.get('content-type');
      const raw = Buffer.from(await answer.arrayBuffer());
      let payload = raw;
      if (answer.status >= 200 && answer.status < 300 && contentType !== null) {
        if (JSON_TYPE.test(contentType)) {
          const parsed = JSON.parse(raw.toString('utf8'));
          payload = Buffer.from(JSON.stringify(rewriteBaseSha(parsed, input.baseSha)));
        }
      }
      response.writeHead(answer.status, {
        'content-type': contentType ?? 'application/json',
        'content-length': payload.length,
      });
      response.end(payload.length > 0 ? payload : undefined);
    })().catch(() => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'the e2e github proxy failed' }));
        return;
      }
      response.end();
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    proxy.once('error', rejectListen);
    proxy.listen(0, '127.0.0.1', () => {
      proxy.removeListener('error', rejectListen);
      resolveListen();
    });
  });
  const address = proxy.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the e2e GitHub proxy failed to bind a loopback port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    get requests() {
      return upstream.requests;
    },
    async close() {
      if (closed) return;
      closed = true;
      const done = new Promise((resolveClose) => {
        proxy.close(() => resolveClose());
      });
      proxy.closeAllConnections();
      await done;
      await upstream.close();
    },
  };
}
