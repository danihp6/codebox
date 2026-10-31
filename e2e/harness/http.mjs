/** The one loopback HTTP client the harness uses: bearer token, JSON, and a real 429 pause. */

export const REQUEST_TIMEOUT_MS = 60_000;
export const RATE_LIMIT_RETRIES = 2;

function sleep(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
export async function readJson(response) {
  const text = await response.text();
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param {Response} response
 * @param {number} status
 * @param {string} label
 * @returns {Promise<Response>}
 */
export async function expectStatus(response, status, label) {
  if (response.status === status) return response;
  const body = await response.text();
  throw new Error(`${label} answered ${response.status}, expected ${status}: ${body}`);
}

function retryAfterMs(body) {
  if (typeof body !== 'object' || body === null) return 1000;
  const failure = body['error'];
  if (typeof failure !== 'object' || failure === null) return 1000;
  const details = failure['details'];
  if (typeof details !== 'object' || details === null) return 1000;
  const seconds = Number(details['retryAfter']);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}

/**
 * The daemon budgets 120 requests per minute per device; polls that overrun it are answered
 * with `429` and `Retry-After`, which this client honours instead of hammering the limiter.
 *
 * @param {{ baseUrl: string; token: () => string | null; timeoutMs?: number; retries?: number }} options
 */
export function createApiClient(options) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxRetries = options.retries ?? RATE_LIMIT_RETRIES;

  async function request(path, init = {}, deadline = Date.now() + timeoutMs) {
    let retries = 0;
    for (;;) {
      const token = options.token();
      const headers = { accept: 'application/json' };
      if (token !== null) headers.authorization = `Bearer ${token}`;
      const response = await fetch(`${options.baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 429) return response;
      const waitMs = retryAfterMs(await readJson(response));
      if (retries >= maxRetries || Date.now() + waitMs > deadline) {
        throw new Error(
          `${init.method ?? 'GET'} ${path} hit the per-device rate limit (retry after ${waitMs} ms); the fixture needs less polling`,
        );
      }
      retries += 1;
      await sleep(waitMs);
    }
  }

  async function json(path, init = {}, deadline) {
    const response = await request(path, init, deadline);
    await expectStatus(response, 200, `${init.method ?? 'GET'} ${path}`);
    return readJson(response);
  }

  return { request, json };
}
