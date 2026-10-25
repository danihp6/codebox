import { describe, expect, it } from 'vitest';
import { ID_RANDOM_CHARS, newJobId, newRunId } from './ids.js';

describe('run and job ids', () => {
  it('mints the contract shape with 20 Crockford characters', () => {
    const runId = newRunId();
    expect(runId).toMatch(/^run_[0-9A-HJKMNP-TV-Z]{20}$/);
    const jobId = newJobId();
    expect(jobId).toMatch(/^job_[0-9A-HJKMNP-TV-Z]{20}$/);
  });

  it('never repeats across a hundred draws', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newRunId()));
    expect(ids.size).toBe(100);
  });

  it('maps injected bytes through the Crockford alphabet', () => {
    expect(newRunId(() => Buffer.alloc(ID_RANDOM_CHARS, 0))).toBe(
      `run_${'0'.repeat(ID_RANDOM_CHARS)}`,
    );
    expect(newJobId(() => Buffer.alloc(ID_RANDOM_CHARS, 31))).toBe(
      `job_${'Z'.repeat(ID_RANDOM_CHARS)}`,
    );
  });

  it('rejects a random source that returns too few bytes', () => {
    expect(() => newRunId(() => Buffer.alloc(2))).toThrow(RangeError);
    expect(() => newJobId(() => Buffer.alloc(0))).toThrow(RangeError);
  });
});
