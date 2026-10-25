import { z } from 'zod';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  RepoId,
  cronSchema,
  jobNextSchema,
  parseJob,
  parseOrThrow,
  parsePage,
  repoPolicySchema,
  jobSchema,
  runModeSchema,
  runSchema,
  timestampSchema,
  timezoneSchema,
} from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { handle, json, queryInput, readJson, requireScope } from '../runs/errors.js';
import { requireIdempotencyKey } from '../runs/idempotency.js';
import type { JobsService } from './service.js';

const TITLE_MAX_LENGTH = 120;
const PROMPT_MAX_LENGTH = 8_000;
const NEXT_COUNT_MAX = 20;
const NEXT_COUNT_DEFAULT = 5;

const listJobsQuerySchema = z.strictObject({
  repoId: RepoId.optional(),
  enabled: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

const createJobSchema = z.strictObject({
  repoId: RepoId,
  title: z.string().min(1).max(TITLE_MAX_LENGTH),
  prompt: z.string().min(1).max(PROMPT_MAX_LENGTH),
  mode: runModeSchema.optional(),
  agent: z.string().min(1).optional(),
  model: z.string().min(1).nullable().optional(),
  cron: cronSchema,
  timezone: timezoneSchema,
  policy: repoPolicySchema.optional(),
});

const patchJobSchema = z.strictObject({
  title: z.string().min(1).max(TITLE_MAX_LENGTH).optional(),
  prompt: z.string().min(1).max(PROMPT_MAX_LENGTH).optional(),
  cron: cronSchema.optional(),
  timezone: timezoneSchema.optional(),
  agent: z.string().min(1).optional(),
  model: z.string().min(1).nullable().optional(),
  policy: repoPolicySchema.optional(),
  enabled: z.boolean().optional(),
});

const jobNextQuerySchema = z.strictObject({
  count: z.coerce.number().int().min(1).max(NEXT_COUNT_MAX).default(NEXT_COUNT_DEFAULT),
});

/** `{ job, lastRuns, nextFires }`: no `JobDetail` in `packages/contracts` yet, so strict here. */
const jobDetailSchema = z.strictObject({
  job: jobSchema,
  lastRuns: z.array(runSchema),
  nextFires: z.array(timestampSchema),
});

export function registerJobsRoutes(app: DaemonApp, jobs: JobsService): void {
  app.get(`${API_PREFIX}/jobs`, (c) =>
    handle(c, 'jobs', () => {
      const query = parseOrThrow(listJobsQuerySchema, queryInput(c, 'jobs'), 'jobs');
      const page = jobs.list({
        limit: query.limit,
        cursor: query.cursor ?? null,
        ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        ...(query.enabled === undefined ? {} : { enabled: query.enabled === 'true' }),
      });
      return json(c, parsePage(jobSchema, page, 'jobs'), 200);
    }),
  );

  app.post(`${API_PREFIX}/jobs`, (c) =>
    handle(c, 'jobs', async () => {
      requireScope(c, 'write');
      const body = parseOrThrow(createJobSchema, await readJson(c), 'job');
      const job = jobs.create({
        repoId: body.repoId,
        title: body.title,
        prompt: body.prompt,
        cron: body.cron,
        timezone: body.timezone,
        ...(body.mode === undefined ? {} : { mode: body.mode }),
        ...(body.agent === undefined ? {} : { agent: body.agent }),
        ...(body.model === undefined ? {} : { model: body.model }),
        ...(body.policy === undefined ? {} : { policy: body.policy }),
      });
      return json(c, parseJob(job), 201);
    }),
  );

  app.get(`${API_PREFIX}/jobs/:id`, (c) =>
    handle(c, 'jobs', () => {
      const detail = jobs.get(c.req.param('id'));
      return json(c, parseOrThrow(jobDetailSchema, detail, 'jobDetail'), 200);
    }),
  );

  app.patch(`${API_PREFIX}/jobs/:id`, (c) =>
    handle(c, 'jobs', async () => {
      requireScope(c, 'write');
      const body = parseOrThrow(patchJobSchema, await readJson(c), 'job.patch');
      const job = jobs.patch(c.req.param('id'), {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
        ...(body.cron === undefined ? {} : { cron: body.cron }),
        ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
        ...(body.agent === undefined ? {} : { agent: body.agent }),
        ...(body.model === undefined ? {} : { model: body.model }),
        ...(body.policy === undefined ? {} : { policy: body.policy }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      });
      return json(c, parseJob(job), 200);
    }),
  );

  app.delete(`${API_PREFIX}/jobs/:id`, (c) =>
    handle(c, 'jobs', () => {
      requireScope(c, 'write');
      jobs.remove(c.req.param('id'));
      return c.body(null, 204);
    }),
  );

  app.post(`${API_PREFIX}/jobs/:id/run`, (c) =>
    handle(c, 'jobs', () => {
      const device = requireScope(c, 'runs');
      const key = requireIdempotencyKey(c.req.header('idempotency-key'));
      const run = jobs.runNow(c.req.param('id'), { deviceId: device.id, idempotencyKey: key });
      return json(c, parseOrThrow(runSchema, run, 'run'), 202);
    }),
  );

  app.post(`${API_PREFIX}/jobs/:id/pause`, (c) =>
    handle(c, 'jobs', () => {
      requireScope(c, 'write');
      return json(c, parseJob(jobs.pause(c.req.param('id'))), 200);
    }),
  );

  app.post(`${API_PREFIX}/jobs/:id/resume`, (c) =>
    handle(c, 'jobs', () => {
      requireScope(c, 'write');
      return json(c, parseJob(jobs.resume(c.req.param('id'))), 200);
    }),
  );

  app.get(`${API_PREFIX}/jobs/:id/next`, (c) =>
    handle(c, 'jobs', () => {
      const query = parseOrThrow(jobNextQuerySchema, queryInput(c, 'job.next'), 'job.next');
      const fires = jobs.next(c.req.param('id'), query.count);
      return json(c, parseOrThrow(jobNextSchema, { fires }, 'job.next'), 200);
    }),
  );
}
