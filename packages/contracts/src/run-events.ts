import { z } from 'zod';
import { pageSchema } from './pagination.js';
import type { Page } from './pagination.js';
import { parseOrThrow } from './parse.js';
import { sseEventNameSchema, timestampSchema } from './primitives.js';

export const runEventRecordSchema = z.strictObject({
  id: z.number().int().positive(),
  seq: z.number().int().min(1).nullable(),
  type: sseEventNameSchema,
  data: z.record(z.string(), z.unknown()),
  ts: timestampSchema,
});
export type RunEventRecord = z.infer<typeof runEventRecordSchema>;

export const runEventPageSchema: z.ZodType<Page<RunEventRecord>> = pageSchema(runEventRecordSchema);
export type RunEventPage = Page<RunEventRecord>;

/** docs/api.md §5.4. `run.events` is the boundary the daemon already reports. */
export function parseRunEventPage(input: unknown): RunEventPage {
  return parseOrThrow(runEventPageSchema, input, 'run.events');
}
