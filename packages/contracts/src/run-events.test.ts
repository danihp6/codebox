import { describe, expect, it } from 'vitest';
import { ContractParseError } from './parse.js';
import { parseRunEventPage, runEventPageSchema, runEventRecordSchema } from './run-events.js';
import type { RunEventPage } from './run-events.js';

const PAGE: RunEventPage = {
  data: [
    {
      id: 1842,
      seq: 17,
      type: 'run.output',
      data: { runId: 'run_01JABCDEFGHJKMNPQRSV', seq: 17, ts: '2026-10-24T18:04:02Z' },
      ts: '2026-10-24T18:04:02Z',
    },
  ],
  nextCursor: '1842',
};

function refused(input: unknown): ContractParseError {
  let caught: unknown = null;
  try {
    parseRunEventPage(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ContractParseError);
  return caught as ContractParseError;
}

function mutated(mutate: (page: Record<string, unknown>) => void): Record<string, unknown> {
  const input = structuredClone(PAGE) as unknown as Record<string, unknown>;
  mutate(input);
  return input;
}

function firstRecord(input: Record<string, unknown>): Record<string, unknown> {
  const data = input['data'];
  expect(Array.isArray(data)).toBe(true);
  const record = (data as Record<string, unknown>[])[0];
  expect(record).toBeDefined();
  return record as Record<string, unknown>;
}

describe('run event page contract', () => {
  it('parses a page whose record carries a run sequence', () => {
    expect(parseRunEventPage(PAGE)).toEqual(PAGE);
    expect(runEventPageSchema.parse(PAGE)).toEqual(PAGE);
    expect(runEventRecordSchema.parse(PAGE.data[0])).toEqual(PAGE.data[0]);
  });

  it('parses a record whose sequence is null and an empty page', () => {
    const approval = {
      data: [
        {
          id: 7,
          seq: null,
          type: 'approval.created',
          data: { approvalId: 'apv_01JABCDEFGHJKMNPQRSV' },
          ts: '2026-10-24T18:04:02Z',
        },
      ],
      nextCursor: null,
    };
    expect(parseRunEventPage(approval)).toEqual(approval);
    expect(parseRunEventPage({ data: [], nextCursor: null })).toEqual({
      data: [],
      nextCursor: null,
    });
  });

  it('refuses an unknown event name at the record type', () => {
    const error = refused(
      mutated((page) => {
        firstRecord(page)['type'] = 'run.unknown';
      }),
    );
    expect(error.boundary).toBe('run.events');
    expect(error.first.path).toBe('run.events.data.0.type');
  });

  it('refuses an extra record key and names it', () => {
    const error = refused(
      mutated((page) => {
        firstRecord(page)['seq2'] = 1;
      }),
    );
    expect(error.boundary).toBe('run.events');
    expect(error.first.path).toBe('run.events.data.0.seq2');
  });

  it('refuses a next cursor that is not a string', () => {
    const error = refused(
      mutated((page) => {
        page['nextCursor'] = 1842;
      }),
    );
    expect(error.boundary).toBe('run.events');
    expect(error.first.path).toBe('run.events.nextCursor');
  });

  it('refuses an unknown page key and names it', () => {
    const error = refused(mutated((page) => (page['after'] = 0)));
    expect(error.boundary).toBe('run.events');
    expect(error.first.path).toBe('run.events.after');
  });
});
