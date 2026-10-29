import { createHash } from 'node:crypto';
import type { DesignFinding, ScreenSpec } from './types.js';

export interface SnapshotInput {
  readonly file: string;
  readonly spec: ScreenSpec;
  readonly bytes: Uint8Array | null;
}

/** sha256 of the bytes, lowercase hex. Hashing is arithmetic; no file is opened in this package. */
export function snapshotHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A declared hash is checked against the export it names; bytes are read by the caller, so this
 * stays a pure function of the two.
 */
export function checkSnapshots(input: readonly SnapshotInput[]): readonly DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const entry of input) {
    const declared = entry.spec.snapshotSha256;
    if (declared === null) continue;
    if (entry.bytes === null) {
      findings.push({
        file: entry.file,
        line: 1,
        rule: 'snapshot_hash_mismatch',
        message: `snapshot ${declared} is missing`,
      });
      continue;
    }
    if (snapshotHash(entry.bytes) !== declared) {
      findings.push({
        file: entry.file,
        line: 1,
        rule: 'snapshot_hash_mismatch',
        message: 'snapshot hash does not match the export',
      });
    }
  }
  return findings;
}
