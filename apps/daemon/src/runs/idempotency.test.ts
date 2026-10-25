import { describe, expect, it } from 'vitest';
import type { Run } from '@codebox/contracts';
import { RunApiError } from './errors.js';
import {
  IDEMPOTENCY_MAX_ENTRIES,
  canonicalJson,
  createIdempotencyStore,
  idempotentRun,
  requestHash,
  requireIdempotencyKey,
} from './idempotency.js';

const NOW = new Date('2026-10-25T00:00:00.000Z');

function run(id: string): Run {
  return {
    id,
    repoId: 'repo_test01',
    jobId: null,
    state: 'queued',
    trigger: 'manual',
    branch: 'cb/run_x-manual-run',
    baseRef: 'main',
    pr: null,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    createdAt: NOW.toISOString(),
    finishedAt: null,
  };
}

function later(seconds: number): Date {
  return new Date(NOW.getTime() + seconds * 1000);
}

describe('canonical JSON', () => {
  it('sorts keys and drops whitespace, so field order never changes the hash', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(requestHash({ prompt: 'x', repoId: 'repo_test01' })).toBe(
      requestHash({ repoId: 'repo_test01', prompt: 'x' }),
    );
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('x')).toBe('"x"');
  });

  it('skips undefined members and keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe('the idempotency store', () => {
  it('is keyed per device: one key on two devices is two requests', () => {
    const store = createIdempotencyStore();
    const first = run('run_aaaaaaaaaaaaaa');
    store.record({ deviceId: 'dev_a', key: 'k1', hash: 'h1', run: first, now: NOW });
    expect(store.lookup({ deviceId: 'dev_a', key: 'k1', hash: 'h1', now: NOW }).kind).toBe(
      'replay',
    );
    expect(store.lookup({ deviceId: 'dev_b', key: 'k1', hash: 'h1', now: NOW }).kind).toBe('miss');
  });

  it('answers a replay with the stored run and a different hash with a mismatch', () => {
    const store = createIdempotencyStore();
    const first = run('run_aaaaaaaaaaaaaa');
    store.record({ deviceId: 'dev_a', key: 'k1', hash: 'h1', run: first, now: NOW });
    const replay = store.lookup({ deviceId: 'dev_a', key: 'k1', hash: 'h1', now: NOW });
    expect(replay).toEqual({ kind: 'replay', run: first });
    expect(store.lookup({ deviceId: 'dev_a', key: 'k1', hash: 'h2', now: NOW }).kind).toBe(
      'mismatch',
    );
  });

  it('forgets an entry after the 24 h retention', () => {
    const store = createIdempotencyStore();
    store.record({ deviceId: 'dev_a', key: 'k1', hash: 'h1', run: run('run_a'), now: NOW });
    expect(
      store.lookup({ deviceId: 'dev_a', key: 'k1', hash: 'h1', now: later(86_399) }).kind,
    ).toBe('replay');
    expect(
      store.lookup({ deviceId: 'dev_a', key: 'k1', hash: 'h1', now: later(86_400) }).kind,
    ).toBe('miss');
    expect(store.size()).toBe(0);
  });

  it('caps the map at a thousand entries, evicting the oldest first', () => {
    const store = createIdempotencyStore();
    for (let index = 0; index < IDEMPOTENCY_MAX_ENTRIES + 1; index += 1) {
      store.record({
        deviceId: 'dev_a',
        key: `k${index}`,
        hash: 'h',
        run: run('run_a'),
        now: NOW,
      });
    }
    expect(store.size()).toBe(IDEMPOTENCY_MAX_ENTRIES);
    expect(store.lookup({ deviceId: 'dev_a', key: 'k0', hash: 'h', now: NOW }).kind).toBe('miss');
    expect(store.lookup({ deviceId: 'dev_a', key: 'k1', hash: 'h', now: NOW }).kind).toBe('replay');
  });
});

describe('idempotentRun', () => {
  it('starts once for one key and replays the stored run', () => {
    const store = createIdempotencyStore();
    let starts = 0;
    const start = (): Run => {
      starts += 1;
      return run('run_aaaaaaaaaaaaaa');
    };
    const first = idempotentRun({
      store,
      deviceId: 'dev_a',
      key: 'k1',
      body: { prompt: 'one' },
      now: NOW,
      start,
    });
    const second = idempotentRun({
      store,
      deviceId: 'dev_a',
      key: 'k1',
      body: { prompt: 'one' },
      now: NOW,
      start,
    });
    expect(starts).toBe(1);
    expect(second.id).toBe(first.id);
  });

  it('rejects the same key with a different body', () => {
    const store = createIdempotencyStore();
    const start = (): Run => run('run_aaaaaaaaaaaaaa');
    idempotentRun({
      store,
      deviceId: 'dev_a',
      key: 'k1',
      body: { prompt: 'one' },
      now: NOW,
      start,
    });
    expect(() =>
      idempotentRun({
        store,
        deviceId: 'dev_a',
        key: 'k1',
        body: { prompt: 'different' },
        now: NOW,
        start,
      }),
    ).toThrow(RunApiError);
  });

  it('does nothing special when the route has no key', () => {
    const store = createIdempotencyStore();
    let starts = 0;
    const start = (): Run => {
      starts += 1;
      return run('run_aaaaaaaaaaaaaa');
    };
    idempotentRun({ store, deviceId: 'dev_a', key: null, body: {}, now: NOW, start });
    idempotentRun({ store, deviceId: 'dev_a', key: null, body: {}, now: NOW, start });
    expect(starts).toBe(2);
    expect(store.size()).toBe(0);
  });
});

describe('requireIdempotencyKey', () => {
  it('answers 400 when the header is missing or empty', () => {
    for (const header of [undefined, '']) {
      try {
        requireIdempotencyKey(header);
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(RunApiError);
        const refusal = error as RunApiError;
        expect(refusal.status).toBe(400);
        expect(refusal.code).toBe('bad_request');
        expect(refusal.details).toEqual({ reason: 'idempotency_key_required' });
      }
    }
  });

  it('rejects a key longer than the contract maximum', () => {
    expect(() => requireIdempotencyKey('k'.repeat(256))).toThrow(RunApiError);
    expect(requireIdempotencyKey('k'.repeat(255))).toBe('k'.repeat(255));
  });
});
