import { z } from 'zod';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  ChatId,
  RepoId,
  parseOrThrow,
  parsePage,
  parseSchedule,
  parseScheduleDetail,
  repoPolicySchema,
  scheduleFirePolicySchema,
  scheduleModeSchema,
  scheduleSchema,
  scheduleWindowTimeSchema,
  timezoneSchema,
} from '@codebox/contracts';
import type { Schedule } from '@codebox/contracts';
import type { SchedulePatch } from '@codebox/store';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { handle, json, queryInput, readJson, requireScope } from '../runs/errors.js';
import type { SchedulesService } from './service.js';

const SCHEDULES_PATH = `${API_PREFIX}/schedules`;
const TITLE_MAX_LENGTH = 120;
const PROMPT_MAX_LENGTH = 8_000;

const listQuery = z.strictObject({
  repoId: RepoId.optional(),
  enabled: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

const createBody = z.strictObject({
  title: z.string().min(1).max(TITLE_MAX_LENGTH),
  prompt: z.string().min(1).max(PROMPT_MAX_LENGTH),
  mode: scheduleModeSchema,
  // A plain string: the cron failure code is the service's, so `details.reason` carries
  // field_count, range, step or syntax instead of a schema message.
  cron: z.string().min(1).nullable().optional(),
  timezone: timezoneSchema,
  windowStart: scheduleWindowTimeSchema.nullable().optional(),
  windowEnd: scheduleWindowTimeSchema.nullable().optional(),
  cooldownMinutes: z.number().int().nonnegative().optional(),
  maxFires: z.number().int().min(1).nullable().optional(),
  maxCostPerFireUsd: z.number().nonnegative().nullable().optional(),
  firePolicy: scheduleFirePolicySchema.optional(),
  repoId: RepoId.nullable().optional(),
  chatSessionId: ChatId.nullable().optional(),
  policy: repoPolicySchema.optional(),
});

const patchBody = z.strictObject({
  title: z.string().min(1).max(TITLE_MAX_LENGTH).optional(),
  prompt: z.string().min(1).max(PROMPT_MAX_LENGTH).optional(),
  mode: scheduleModeSchema.optional(),
  cron: z.string().min(1).nullable().optional(),
  timezone: timezoneSchema.optional(),
  windowStart: scheduleWindowTimeSchema.nullable().optional(),
  windowEnd: scheduleWindowTimeSchema.nullable().optional(),
  cooldownMinutes: z.number().int().nonnegative().optional(),
  maxFires: z.number().int().min(1).nullable().optional(),
  maxCostPerFireUsd: z.number().nonnegative().nullable().optional(),
  firePolicy: scheduleFirePolicySchema.optional(),
  chatSessionId: ChatId.nullable().optional(),
  enabled: z.boolean().optional(),
  policy: repoPolicySchema.optional(),
});

function patchOf(body: z.infer<typeof patchBody>): SchedulePatch {
  return {
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
    ...(body.mode === undefined ? {} : { mode: body.mode }),
    ...(body.cron === undefined ? {} : { cron: body.cron }),
    ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
    ...(body.windowStart === undefined ? {} : { windowStart: body.windowStart }),
    ...(body.windowEnd === undefined ? {} : { windowEnd: body.windowEnd }),
    ...(body.cooldownMinutes === undefined ? {} : { cooldownMinutes: body.cooldownMinutes }),
    ...(body.maxFires === undefined ? {} : { maxFires: body.maxFires }),
    ...(body.maxCostPerFireUsd === undefined ? {} : { maxCostPerFireUsd: body.maxCostPerFireUsd }),
    ...(body.firePolicy === undefined ? {} : { firePolicy: body.firePolicy }),
    ...(body.chatSessionId === undefined ? {} : { chatSessionId: body.chatSessionId }),
    ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
    ...(body.policy === undefined ? {} : { policy: body.policy }),
  };
}

export function registerScheduleRoutes(app: DaemonApp, schedules: SchedulesService): void {
  app.get(SCHEDULES_PATH, (c) =>
    handle(c, 'schedules', () => {
      const query = parseOrThrow(listQuery, queryInput(c, 'schedules'), 'schedules');
      const page = schedules.list({
        limit: query.limit,
        cursor: query.cursor ?? null,
        ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      });
      return json(c, parsePage(scheduleSchema, page, 'schedules'), 200);
    }),
  );

  app.post(SCHEDULES_PATH, (c) =>
    handle(c, 'schedules', async () => {
      requireScope(c, 'write');
      const body = parseOrThrow(createBody, await readJson(c), 'schedule');
      const created: Schedule = schedules.create({
        title: body.title,
        prompt: body.prompt,
        mode: body.mode,
        timezone: body.timezone,
        ...(body.cron === undefined ? {} : { cron: body.cron }),
        ...(body.windowStart === undefined ? {} : { windowStart: body.windowStart }),
        ...(body.windowEnd === undefined ? {} : { windowEnd: body.windowEnd }),
        ...(body.cooldownMinutes === undefined ? {} : { cooldownMinutes: body.cooldownMinutes }),
        ...(body.maxFires === undefined ? {} : { maxFires: body.maxFires }),
        ...(body.maxCostPerFireUsd === undefined
          ? {}
          : { maxCostPerFireUsd: body.maxCostPerFireUsd }),
        ...(body.firePolicy === undefined ? {} : { firePolicy: body.firePolicy }),
        ...(body.repoId === undefined ? {} : { repoId: body.repoId }),
        ...(body.chatSessionId === undefined ? {} : { chatSessionId: body.chatSessionId }),
        ...(body.policy === undefined ? {} : { policy: body.policy }),
      });
      return json(c, parseSchedule(created), 201);
    }),
  );

  app.get(`${SCHEDULES_PATH}/:id`, (c) =>
    handle(c, 'schedules', () => {
      const detail = schedules.get(c.req.param('id'));
      return json(c, parseScheduleDetail(detail), 200);
    }),
  );

  app.patch(`${SCHEDULES_PATH}/:id`, (c) =>
    handle(c, 'schedules', async () => {
      requireScope(c, 'write');
      const body = parseOrThrow(patchBody, await readJson(c), 'schedule');
      const updated = schedules.patch(c.req.param('id'), patchOf(body));
      return json(c, parseSchedule(updated), 200);
    }),
  );

  app.delete(`${SCHEDULES_PATH}/:id`, (c) =>
    handle(c, 'schedules', () => {
      requireScope(c, 'write');
      schedules.remove(c.req.param('id'));
      return c.body(null, 204);
    }),
  );

  app.post(`${SCHEDULES_PATH}/:id/pause`, (c) =>
    handle(c, 'schedules', () => {
      requireScope(c, 'write');
      return json(c, parseSchedule(schedules.pause(c.req.param('id'))), 200);
    }),
  );

  app.post(`${SCHEDULES_PATH}/:id/resume`, (c) =>
    handle(c, 'schedules', () => {
      requireScope(c, 'write');
      return json(c, parseSchedule(schedules.resume(c.req.param('id'))), 200);
    }),
  );
}
