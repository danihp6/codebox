import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DesignDocumentError, parseScreenSpec } from './index.js';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/screens/${name}.json`, import.meta.url)),
      'utf8',
    ),
  ) as unknown;
}

describe('parseScreenSpec', () => {
  it('reads the three states and the declared hash', () => {
    const spec = parseScreenSpec({
      screen: 'Repo · backlog',
      route: '/repos/:id',
      states: { loading: 'Rows grey', empty: 'Empty file', error: 'Envelope' },
      snapshotSha256: 'a'.repeat(64),
    });

    expect(spec).toEqual({
      screen: 'Repo · backlog',
      route: '/repos/:id',
      states: { loading: 'Rows grey', empty: 'Empty file', error: 'Envelope' },
      snapshotSha256: 'a'.repeat(64),
    });
  });

  it('fills a missing state key and a missing snapshotSha256 with null', () => {
    const spec = parseScreenSpec({
      screen: 'Dashboard',
      route: '/dashboard',
      states: { loading: 'Skeleton' },
    });

    expect(spec.states).toEqual({ loading: 'Skeleton', empty: null, error: null });
    expect(spec.snapshotSha256).toBeNull();
  });

  it('rejects a snapshot hash that is not 64 lowercase hex', () => {
    for (const snapshotSha256 of ['A'.repeat(64), 'a'.repeat(63), 'sha256:abc', 42]) {
      expect(() =>
        parseScreenSpec({ screen: 'Dashboard', route: '/dashboard', snapshotSha256 }),
      ).toThrow(DesignDocumentError);
    }
  });

  it('rejects an unknown field, an unknown state and an empty screen or route', () => {
    for (const document of [
      { screen: 'Dashboard', route: '/dashboard', extra: 1 },
      { screen: 'Dashboard', route: '/dashboard', states: { paused: 'x' } },
      { screen: 'Dashboard', route: '/dashboard', states: { loading: 3 } },
      { screen: '', route: '/dashboard' },
      { screen: 'Dashboard', route: '' },
      { route: '/dashboard' },
      null,
    ]) {
      expect(() => parseScreenSpec(document)).toThrow(DesignDocumentError);
    }
  });

  it('reports the screen boundary', () => {
    try {
      parseScreenSpec({ screen: 'Dashboard', route: '/dashboard', snapshotSha256: 'abc' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DesignDocumentError);
      expect(error).toMatchObject({ boundary: 'screen' });
    }
  });

  it('parses both fixtures', () => {
    expect(parseScreenSpec(fixture('dashboard')).screen).toBe('Dashboard');
    expect(parseScreenSpec(fixture('repo-backlog'))).toEqual({
      screen: 'Repo · backlog',
      route: '/repos/:id',
      states: {
        loading: 'Rows grey until the file parses',
        empty: 'Empty file, one chat button',
        error: 'Envelope over the list',
      },
      snapshotSha256: null,
    });
  });
});
