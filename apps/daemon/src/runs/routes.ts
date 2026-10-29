import { z } from 'zod';
import {
  JobId,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  RepoId,
  branchSchema,
  parsePage,
  parseRun,
  parseRunDiff,
  parseOrThrow,
  runModeSchema,
  runSchema,
  runStateSchema,
  sseEventNameSchema,
  timestampSchema,
} from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { RunApiError, handle, json, queryInput, readJson, requireScope } from './errors.js';
import type { AppContext } from './errors.js';
import { requireIdempotencyKey } from './idempotency.js';
import { runsServiceInternals } from './service.js';
import type { EventPage, RunsService } from './service.js';

const PROMPT_MAX_LENGTH = 8_000;
const EVENTS_DEFAULT_LIMIT = 200;

const listRunsQuerySchema = z.strictObject({
  repoId: RepoId.optional(),
  jobId: JobId.optional(),
  state: runStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

const createRunSchema = z.strictObject({
  repoId: RepoId,
  prompt: z.string().min(1).max(PROMPT_MAX_LENGTH),
  mode: runModeSchema.optional(),
  agent: z.string().min(1).optional(),
  model: z.string().min(1).nullable().optional(),
  baseRef: branchSchema.optional(),
});

const runEventsQuerySchema = z.strictObject({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(EVENTS_DEFAULT_LIMIT),
});

/** The contract has no event-page schema yet; this is the strict local shape of §5.4. */
const eventPageSchema = z.strictObject({
  data: z.array(
    z.strictObject({
      id: z.number().int().positive(),
      seq: z.number().int().min(1).nullable(),
      type: sseEventNameSchema,
      data: z.record(z.string(), z.unknown()),
      ts: timestampSchema,
    }),
  ),
  nextCursor: z.string().nullable(),
});

function idempotencyHeader(c: AppContext): string {
  return requireIdempotencyKey(c.req.header('idempotency-key'));
}

export function registerRunsRoutes(app: DaemonApp, runs: RunsService): void {
  const internals = runsServiceInternals(runs);

  app.get(`${API_PREFIX}/runs`, (c) =>
    handle(c, 'runs', () => {
      const query = parseOrThrow(listRunsQuerySchema, queryInput(c, 'runs'), 'runs');
      const page = internals.store.runs.list({
        limit: query.limit,
        cursor: query.cursor ?? null,
        ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        ...(query.jobId === undefined ? {} : { jobId: query.jobId }),
        ...(query.state === undefined ? {} : { state: query.state }),
      });
      return json(c, parsePage(runSchema, page, 'runs'), 200);
    }),
  );

  app.post(`${API_PREFIX}/runs`, (c) =>
    handle(c, 'runs', async () => {
      const device = requireScope(c, 'runs');
      const body = parseOrThrow(createRunSchema, await readJson(c), 'run');
      const key = idempotencyHeader(c);
      const run = runs.createRun({
        repoId: body.repoId,
        prompt: body.prompt,
        mode: body.mode ?? 'work',
        deviceId: device.id,
        idempotencyKey: key,
        ...(body.agent === undefined ? {} : { agent: body.agent }),
        ...(body.model === undefined ? {} : { model: body.model }),
        ...(body.baseRef === undefined ? {} : { baseRef: body.baseRef }),
      });
      return json(c, parseRun(run), 202);
    }),
  );

  app.get(`${API_PREFIX}/runs/:id`, (c) =>
    handle(c, 'runs', () => {
      const id = c.req.param('id');
      const run = internals.store.runs.get(id);
      if (run === null) throw new RunApiError('not_found', 404, { path: 'run.id' });
      return json(c, parseRun(run), 200);
    }),
  );

  app.post(`${API_PREFIX}/runs/:id/cancel`, (c) =>
    handle(c, 'runs', async () => {
      requireScope(c, 'runs');
      const run = await runs.cancel(c.req.param('id'));
      return json(c, parseRun(run), 202);
    }),
  );

  app.post(`${API_PREFIX}/runs/:id/revert`, (c) =>
    handle(c, 'runs', () => {
      const device = requireScope(c, 'runs');
      const run = runs.revert({
        runId: c.req.param('id'),
        deviceId: device.id,
        idempotencyKey: c.req.header('idempotency-key') ?? '',
      });
      return json(c, parseRun(run), 202);
    }),
  );

  app.get(`${API_PREFIX}/runs/:id/events`, (c) =>
    handle(c, 'runs', () => {
      const query = parseOrThrow(runEventsQuerySchema, queryInput(c, 'runs'), 'run.events');
      const page: EventPage = runs.events(c.req.param('id'), query.after, query.limit);
      return json(c, parseOrThrow(eventPageSchema, page, 'run.events'), 200);
    }),
  );

  app.get(`${API_PREFIX}/runs/:id/diff`, (c) =>
    handle(c, 'runs', async () => {
      const diff = await runs.diff(c.req.param('id'));
      return json(c, parseRunDiff(diff), 200);
    }),
  );
}
