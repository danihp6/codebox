import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContractParseError, parseOrThrow, toParseIssues } from './parse.js';

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (thrown) {
    return thrown;
  }
  return null;
}

describe('parse', () => {
  it('dotted paths start at the boundary and keep array indices', () => {
    const schema = z.strictObject({
      guardrails: z.array(z.strictObject({ id: z.string().min(1) })),
      config: z.record(z.string(), z.string()),
    });
    const error = capture(() =>
      parseOrThrow(schema, { guardrails: [{ id: 'gate' }, {}], config: {} }, 'run'),
    );
    expect(error).toBeInstanceOf(ContractParseError);
    if (error instanceof ContractParseError) {
      expect(error.boundary).toBe('run');
      expect(error.first.path).toBe('run.guardrails.1.id');
      expect(error.issues).toHaveLength(1);
    }
  });

  it('joins a record key verbatim', () => {
    const schema = z.strictObject({ CB_BIND: z.string().min(1) });
    const error = capture(() => parseOrThrow(schema, { CB_BIND: '' }, 'config'));
    expect(error instanceof ContractParseError ? error.first.path : null).toBe('config.CB_BIND');
  });

  it('reports the boundary alone for a missing root value', () => {
    const error = capture(() => parseOrThrow(z.strictObject({ a: z.string() }), null, 'job'));
    expect(error instanceof ContractParseError ? error.first.path : null).toBe('job');
  });

  it('expands an unrecognized key into its own path', () => {
    const schema = z.strictObject({ a: z.string() });
    const error = capture(() => parseOrThrow(schema, { a: 'x', extra: 1 }, 'job'));
    expect(error instanceof ContractParseError ? error.first.path : null).toBe('job.extra');
    if (error instanceof ContractParseError) {
      expect(error.first.code).toBe('unrecognized_keys');
    }
  });

  it('keeps the zod code and message for every issue', () => {
    const error = capture(() =>
      parseOrThrow(z.strictObject({ n: z.number() }), { n: 'x' }, 'body'),
    );
    if (error instanceof ContractParseError) {
      expect(error.first.code).toBe('invalid_type');
      expect(error.first.message.length).toBeGreaterThan(0);
      expect(String(error)).toContain('body.n');
    }
  });

  it('toParseIssues prefixes the boundary and never returns a bare key', () => {
    const result = z.strictObject({ n: z.number() }).safeParse({ n: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = toParseIssues(result.error, 'events');
      expect(issues).toEqual([
        {
          path: 'events.n',
          message: expect.any(String),
          code: 'invalid_type',
        },
      ]);
    }
  });

  it('first is never undefined, even with an empty issue list', () => {
    const error = new ContractParseError('job', []);
    expect(error.first.path).toBe('job');
    expect(error.issues).toEqual([]);
  });
});
