import { randomBytes } from 'node:crypto';
import { safeEqual, sha256Hex } from '@codebox/security';

export const MANIFEST_STATE_TTL_SECONDS = 600;
export const MANIFEST_STATE_BYTES = 24;

export interface ManifestStateStore {
  issue(): string;
  consume(state: string): boolean;
}

/**
 * One state per manifest flow, held in memory: a daemon restart invalidates a form that has not
 * been completed yet. The comparison is constant time and an entry is removed when it is used.
 */
export function createManifestStateStore(options: {
  readonly now: () => Date;
  readonly ttlSeconds?: number;
}): ManifestStateStore {
  const ttlMs = Math.max(1, options.ttlSeconds ?? MANIFEST_STATE_TTL_SECONDS) * 1000;
  const pending = new Map<string, number>();

  function prune(at: number): void {
    for (const [digest, expiresAt] of pending) {
      if (expiresAt <= at) pending.delete(digest);
    }
  }

  return {
    issue(): string {
      const at = options.now().getTime();
      prune(at);
      const state = randomBytes(MANIFEST_STATE_BYTES).toString('base64url');
      pending.set(sha256Hex(state), at + ttlMs);
      return state;
    },
    consume(state: string): boolean {
      const at = options.now().getTime();
      const digest = sha256Hex(state);
      let matched: string | null = null;
      for (const [candidate, expiresAt] of pending) {
        if (safeEqual(candidate, digest) && expiresAt > at) matched = candidate;
      }
      prune(at);
      if (matched === null) return false;
      pending.delete(matched);
      return true;
    },
  };
}
