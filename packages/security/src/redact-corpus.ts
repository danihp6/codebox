export interface RedactionFixture {
  readonly name: string;
  /** The secret literals that must not survive `redact()`, in any depth. */
  readonly secrets: readonly string[];
  readonly input: unknown;
}

function circularRecord(): Record<string, unknown> {
  const record: Record<string, unknown> = { name: 'loop', token: 'cb-fixture-token-07' };
  record['self'] = record;
  return record;
}

function circularArray(): unknown[] {
  const list: unknown[] = [{ token: 'cb-fixture-cycle-29', label: 'first' }];
  list.push(list);
  return list;
}

function nullPrototypeRecord(): unknown {
  const record = Object.create(null) as Record<string, unknown>;
  record['secret'] = 'cb-fixture-nullproto-30';
  record['safe'] = 'kept';
  return record;
}

/**
 * One fixture per shape the redactor has to survive. A key-based redactor is only as good as
 * the list of keys it knows and the values it refuses to copy; the corpus pins both.
 */
export const REDACTION_CORPUS: readonly RedactionFixture[] = Object.freeze([
  {
    name: 'nested-object',
    secrets: ['cb-fixture-token-01'],
    input: { outer: { inner: { token: 'cb-fixture-token-01' } } },
  },
  {
    name: 'array-of-objects',
    secrets: ['cb-fixture-access-02', 'cb-fixture-secret-02'],
    input: {
      items: [
        { name: 'a', access_token: 'cb-fixture-access-02' },
        { secret: 'cb-fixture-secret-02' },
      ],
    },
  },
  {
    name: 'numeric-key-record',
    secrets: ['cb-fixture-refresh-03'],
    input: { '0': { refreshToken: 'cb-fixture-refresh-03' }, '1': { label: 'second' } },
  },
  {
    name: 'error-value',
    secrets: ['cb-fixture-client-04'],
    input: { err: new Error('boom'), client_secret: 'cb-fixture-client-04' },
  },
  {
    name: 'date-value',
    secrets: ['cb-fixture-password-05'],
    input: { at: new Date('2026-10-25T09:00:00.000Z'), password: 'cb-fixture-password-05' },
  },
  {
    name: 'binary-value',
    secrets: ['cb-fixture-apikey-06'],
    input: { bytes: new Uint8Array([1, 2, 3]), apiKey: 'cb-fixture-apikey-06' },
  },
  {
    name: 'circular-reference',
    secrets: ['cb-fixture-token-07'],
    input: circularRecord(),
  },
  {
    name: 'bigint-value',
    secrets: ['cb-fixture-bigint-08'],
    input: { token: 9007199254740993n, password: 'cb-fixture-bigint-08' },
  },
  {
    name: 'undefined-value',
    secrets: ['cb-fixture-token-09'],
    input: { token: 'cb-fixture-token-09', missing: undefined, list: [undefined, 'kept'] },
  },
  {
    name: 'request-headers',
    secrets: ['cb-fixture-auth-10', 'cb-fixture-cookie-10'],
    input: {
      headers: { authorization: 'Bearer cb-fixture-auth-10', cookie: 'session=cb-fixture-cookie-10' },
    },
  },
  {
    name: 'response-headers',
    secrets: ['cb-fixture-setcookie-11'],
    input: { status: 200, headers: { 'set-cookie': 'sid=cb-fixture-setcookie-11; HttpOnly' } },
  },
  {
    name: 'pem-key',
    secrets: ['cb-fixture-pem-12'],
    input: {
      privateKey: '-----BEGIN PRIVATE KEY-----\ncb-fixture-pem-12\n-----END PRIVATE KEY-----',
    },
  },
  {
    name: 'env-record',
    secrets: ['cb-fixture-pemvar-13', 'cb-fixture-anthropic-13'],
    input: {
      private_key_pem: 'cb-fixture-pemvar-13',
      ANTHROPIC_API_KEY: 'cb-fixture-anthropic-13',
    },
  },
  {
    name: 'provider-status',
    secrets: ['cb-fixture-provider-14'],
    input: { providers: [{ configured: true, fingerprint: '0001', apiKey: 'cb-fixture-provider-14' }] },
  },
  {
    name: 'device-token-pair',
    secrets: ['cb-fixture-device-access-15', 'cb-fixture-device-refresh-15'],
    input: {
      accessToken: 'cb-fixture-device-access-15',
      refreshToken: 'cb-fixture-device-refresh-15',
      expiresIn: 900,
    },
  },
  {
    name: 'nested-arrays',
    secrets: ['cb-fixture-matrix-16'],
    input: { matrix: [[{ secret: 'cb-fixture-matrix-16' }]] },
  },
  {
    name: 'deep-nesting',
    secrets: ['cb-fixture-deep-17'],
    input: { a: { b: { c: { d: { token: 'cb-fixture-deep-17' } } } } },
  },
  {
    name: 'null-values',
    secrets: ['cb-fixture-null-18'],
    input: { token: 'cb-fixture-null-18', empty: null, nested: { password: null } },
  },
  {
    name: 'mixed-scalars',
    secrets: ['cb-fixture-mixed-19'],
    input: { count: 3, ok: false, ratio: 0.5, secret: 'cb-fixture-mixed-19' },
  },
  {
    name: 'usage-numbers',
    secrets: ['cb-fixture-usage-20'],
    input: { tokensIn: 1_200, tokensOut: 300, password: 'cb-fixture-usage-20' },
  },
  {
    name: 'chat-message',
    secrets: ['cb-fixture-chat-21'],
    input: { text: 'hello there', role: 'assistant', secret: 'cb-fixture-chat-21' },
  },
  {
    name: 'approval-input',
    secrets: ['cb-fixture-approval-22'],
    input: { tool: 'bash', input: { command: 'echo ok', password: 'cb-fixture-approval-22' } },
  },
  {
    name: 'job-record',
    secrets: ['cb-fixture-job-23'],
    input: { id: 'job_fixture0001', title: 'nightly', apiKey: 'cb-fixture-job-23' },
  },
  {
    name: 'multiple-secret-keys',
    secrets: [
      'cb-fixture-multi-token-24',
      'cb-fixture-multi-password-24',
      'cb-fixture-multi-apikey-24',
    ],
    input: {
      token: 'cb-fixture-multi-token-24',
      password: 'cb-fixture-multi-password-24',
      apiKey: 'cb-fixture-multi-apikey-24',
    },
  },
  {
    name: 'secret-array',
    secrets: ['cb-fixture-list-a-25', 'cb-fixture-list-b-25'],
    input: { token: ['cb-fixture-list-a-25', 'cb-fixture-list-b-25'] },
  },
  {
    name: 'header-array',
    secrets: ['cb-fixture-header-26', 'cb-fixture-cookie-26'],
    input: {
      headers: [{ authorization: 'cb-fixture-header-26' }, { cookie: 'cb-fixture-cookie-26' }],
    },
  },
  {
    name: 'date-in-array',
    secrets: ['cb-fixture-event-27'],
    input: { events: [{ at: new Date('2026-10-24T12:00:00.000Z'), secret: 'cb-fixture-event-27' }] },
  },
  {
    name: 'error-nested',
    secrets: ['cb-fixture-error-28'],
    input: { error: new TypeError('bad input'), authorization: 'cb-fixture-error-28' },
  },
  {
    name: 'cycle-in-array',
    secrets: ['cb-fixture-cycle-29'],
    input: circularArray(),
  },
  {
    name: 'null-prototype-record',
    secrets: ['cb-fixture-nullproto-30'],
    input: nullPrototypeRecord(),
  },
]);
