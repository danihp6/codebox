import { describe, expect, it } from 'vitest';
import {
  ApiResponseError,
  DEFAULT_TIMEOUT_MS,
  TransportError,
  apiErrorFrom,
  createHttpTransport,
  decodeErrorEnvelope,
  exitCodeForStatus,
  isSuccessStatus,
  normaliseBaseUrl,
} from './transport.js';

const BASE_URL = 'http://127.0.0.1:8787';
const ENVELOPE = {
  error: {
    code: 'not_found',
    message: 'Not found',
    details: { path: '/v1/jobs/job_ABC123' },
    requestId: 'req_ABC123',
  },
};

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

function transportWith(answer: (url: string, init: RequestInit) => Promise<Response> | Response): {
  readonly sent: Recorded[];
  readonly transport: ReturnType<typeof createHttpTransport>;
} {
  const sent: Recorded[] = [];
  const transport = createHttpTransport({
    baseUrl: BASE_URL,
    fetch: async (url, init) => {
      sent.push({ url, init });
      return await answer(url, init);
    },
  });
  return { sent, transport };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transport', () => {
  it('defaults the timeout and strips one trailing slash from the base URL', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
    expect(normaliseBaseUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
    expect(normaliseBaseUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(normaliseBaseUrl('http://127.0.0.1:8787//')).toBe('http://127.0.0.1:8787/');
  });

  it('maps the status classes to exit codes', () => {
    expect(exitCodeForStatus(401)).toBe(4);
    expect(exitCodeForStatus(403)).toBe(4);
    expect(exitCodeForStatus(404)).toBe(5);
    expect(exitCodeForStatus(500)).toBe(5);
    expect(isSuccessStatus(204)).toBe(true);
    expect(isSuccessStatus(201)).toBe(true);
    expect(isSuccessStatus(302)).toBe(false);
  });

  it('sends the documented headers for an authenticated write', async () => {
    const { sent, transport } = transportWith(() => jsonResponse({ ok: true }, 202));

    const response = await transport.send({
      method: 'POST',
      path: '/v1/jobs/job_ABC123/run',
      body: { retry: false },
      token: 'cb-secret-value',
      idempotencyKey: 'key-1',
    });

    expect(response).toEqual({ status: 202, body: { ok: true } });
    const recorded = sent[0];
    expect(recorded?.url).toBe(`${BASE_URL}/v1/jobs/job_ABC123/run`);
    expect(recorded?.init.method).toBe('POST');
    expect(recorded?.init.headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: 'Bearer cb-secret-value',
      'idempotency-key': 'key-1',
    });
    expect(recorded?.init.body).toBe(JSON.stringify({ retry: false }));
  });

  it('omits the content-type without a body and the authorization without a token', async () => {
    const { sent, transport } = transportWith(() => jsonResponse({ ok: true }));

    await transport.send({ method: 'GET', path: '/v1/health', token: null });

    expect(sent[0]?.init.headers).toEqual({ accept: 'application/json' });
    expect(sent[0]?.init.body).toBeUndefined();
  });

  it('encodes the query and skips undefined values', async () => {
    const { sent, transport } = transportWith(() => jsonResponse({ ok: true }));

    await transport.send({
      method: 'GET',
      path: '/v1/runs/run_ABC123/events',
      query: { after: 0, limit: 200, cursor: undefined, enabled: true },
    });

    const url = new URL(sent[0]?.url ?? '');
    expect(url.pathname).toBe('/v1/runs/run_ABC123/events');
    expect([...url.searchParams]).toEqual([
      ['after', '0'],
      ['limit', '200'],
      ['enabled', 'true'],
    ]);
  });

  it('returns a non-2xx answer with its envelope instead of throwing', async () => {
    const { transport } = transportWith(() => jsonResponse(ENVELOPE, 404));

    const response = await transport.send({ method: 'GET', path: '/v1/jobs/job_ABC123' });

    expect(response.status).toBe(404);
    expect(decodeErrorEnvelope(response.body)).toEqual(ENVELOPE);
    const error = apiErrorFrom(response);
    expect(error).toBeInstanceOf(ApiResponseError);
    expect(error.status).toBe(404);
    expect(error.envelope?.error.code).toBe('not_found');
    expect(exitCodeForStatus(error.status)).toBe(5);
  });

  it('returns a null body for an empty answer', async () => {
    const { transport } = transportWith(() => new Response(null, { status: 204 }));

    await expect(
      transport.send({ method: 'DELETE', path: '/v1/devices/dev_ABC123' }),
    ).resolves.toEqual({ status: 204, body: null });
  });

  it('reports a network failure as unreachable', async () => {
    const { transport } = transportWith(() => Promise.reject(new TypeError('fetch failed')));

    const error = await transport
      .send({ method: 'GET', path: '/v1/health' })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).kind).toBe('unreachable');
  });

  it('reports a slow daemon as a timeout', async () => {
    const transport = createHttpTransport({
      baseUrl: BASE_URL,
      timeoutMs: 5,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    });

    const error = await transport
      .send({ method: 'GET', path: '/v1/health' })
      .catch((thrown: unknown) => thrown);

    expect((error as TransportError).kind).toBe('timeout');
  });

  it('reports a body that is not JSON as bad_response', async () => {
    const { transport } = transportWith(() => new Response('<html>nope</html>', { status: 200 }));

    const error = await transport
      .send({ method: 'GET', path: '/v1/health' })
      .catch((thrown: unknown) => thrown);

    expect((error as TransportError).kind).toBe('bad_response');
  });

  it('refuses a path outside /v1/ without calling fetch', async () => {
    const { sent, transport } = transportWith(() => jsonResponse({ ok: true }));

    const error = await transport
      .send({ method: 'GET', path: '/health' })
      .catch((thrown: unknown) => thrown);

    expect((error as TransportError).kind).toBe('bad_response');
    expect(sent).toHaveLength(0);
  });

  it('ignores a body that is not an error envelope', () => {
    expect(decodeErrorEnvelope({ error: { code: 'nope' } })).toBeNull();
    expect(decodeErrorEnvelope(null)).toBeNull();
  });

  it('never carries a header value in its own message', () => {
    const error = new TransportError('unreachable', 'the daemon did not answer');
    expect(error.name).toBe('TransportError');
    expect(error.message).not.toContain('bearer');
    expect((error as Error).cause).toBeUndefined();
  });
});
