import { describe, expect, it } from 'vitest';
import { checkSnapshots, parseScreenSpec, snapshotHash } from './index.js';
import type { ScreenSpec } from './index.js';

const HASH_OF_X = '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881';

function spec(snapshotSha256: string | null): ScreenSpec {
  return parseScreenSpec({
    screen: 'Dashboard',
    route: '/dashboard',
    states: { loading: 'x', empty: 'y', error: 'z' },
    snapshotSha256,
  });
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('snapshot hash', () => {
  it('is sha256 of the bytes, lowercase hex', () => {
    expect(snapshotHash(bytesOf('x'))).toBe(HASH_OF_X);
    expect(snapshotHash(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('fails a declared hash that does not match the export', () => {
    const findings = checkSnapshots([
      { file: 'design/screens/dashboard.json', spec: spec(HASH_OF_X), bytes: bytesOf('y') },
    ]);

    expect(findings).toEqual([
      {
        file: 'design/screens/dashboard.json',
        line: 1,
        rule: 'snapshot_hash_mismatch',
        message: 'snapshot hash does not match the export',
      },
    ]);
  });

  it('passes a matching hash and a spec that declares none', () => {
    expect(
      checkSnapshots([
        { file: 'design/screens/dashboard.json', spec: spec(HASH_OF_X), bytes: bytesOf('x') },
        { file: 'design/screens/repo-backlog.json', spec: spec(null), bytes: null },
      ]),
    ).toEqual([]);
  });

  it('names the declared hash when the export is missing', () => {
    const findings = checkSnapshots([
      { file: 'design/screens/dashboard.json', spec: spec(HASH_OF_X), bytes: null },
    ]);

    expect(findings).toEqual([
      {
        file: 'design/screens/dashboard.json',
        line: 1,
        rule: 'snapshot_hash_mismatch',
        message: `snapshot ${HASH_OF_X} is missing`,
      },
    ]);
  });
});
