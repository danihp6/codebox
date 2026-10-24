import { describe, expect, it } from 'vitest';
import { SSE_EVENT_NAMES, idSchema, timestampSchema } from './index.js';

describe('entry point', () => {
  it('re-exports the primitives through index.js', () => {
    expect(SSE_EVENT_NAMES).toHaveLength(20);
    expect(idSchema('run').safeParse('run_01JABCDEFG').success).toBe(true);
    expect(timestampSchema.safeParse('2026-10-24T18:03:11Z').success).toBe(true);
  });
});
