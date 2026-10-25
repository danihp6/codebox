import { z } from 'zod';
import type { Routine } from '@codebox/contracts';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  cronSchema,
  pageOfRoutine,
  parseOrThrow,
  parseRoutine,
  routineKindSchema,
  timezoneSchema,
} from '@codebox/contracts';
import type { RoutineFilter, RoutinePatch } from '@codebox/store';
import { API_PREFIX } from '../app.js';
import { nextFireAt } from '../jobs/service.js';
import type { DaemonApp } from '../modules.js';
import { RunApiError, handle, json, queryInput, readJson, requireScope } from '../runs/errors.js';
import { routineRuntimeOf } from './service.js';
import type { RoutineRuntime, RoutineService } from './service.js';

const ROUTINES_PATH = `${API_PREFIX}/routines`;

const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
  kind: routineKindSchema.optional(),
  enabled: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const patchBody = z.strictObject({
  title: z.string().min(1).max(120).optional(),
  cron: cronSchema.optional(),
  timezone: timezoneSchema.optional(),
  prompt: z.string().min(1).optional(),
  notify: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

function requireRoutine(runtime: RoutineRuntime, id: string): Routine {
  const routine = runtime.store.routines.get(id);
  if (routine === null) throw new RunApiError('not_found', 404, { path: 'routine.id' });
  return routine;
}

function invalidSchedule(field: 'cron' | 'timezone'): RunApiError {
  return new RunApiError('validation_failed', 422, {
    path: field === 'cron' ? 'routine.cron' : 'routine.timezone',
  });
}

/** The next fire of a schedule, or the §3 refusal a client can act on. */
function nextFireOrThrow(runtime: RoutineRuntime, cron: string, timezone: string): string {
  const schedule = nextFireAt({ cron, timezone }, runtime.now());
  if (!schedule.ok) throw invalidSchedule(schedule.field);
  return schedule.nextFireAt;
}

export function registerRoutineRoutes(app: DaemonApp, service: RoutineService): void {
  const runtime = routineRuntimeOf(service);

  app.get(ROUTINES_PATH, (c) =>
    handle(c, 'routine', () => {
      const query = parseOrThrow(listQuery, queryInput(c, 'routine'), 'routine');
      const filter: RoutineFilter = {
        limit: query.limit,
        cursor: query.cursor ?? null,
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      };
      return json(
        c,
        parseOrThrow(pageOfRoutine, runtime.store.routines.list(filter), 'routine'),
        200,
      );
    }),
  );

  app.get(`${ROUTINES_PATH}/:id`, (c) =>
    handle(c, 'routine', () =>
      json(c, parseRoutine(requireRoutine(runtime, c.req.param('id'))), 200),
    ),
  );

  app.patch(`${ROUTINES_PATH}/:id`, (c) =>
    handle(c, 'routine', async () => {
      requireScope(c, 'write');
      const current = requireRoutine(runtime, c.req.param('id'));
      const body = parseOrThrow(patchBody, await readJson(c), 'routine.patch');
      if (body.prompt !== undefined && current.kind === 'reminder') {
        throw new RunApiError('validation_failed', 422, { path: 'routine.prompt' });
      }
      const cron = body.cron ?? current.cron;
      const timezone = body.timezone ?? current.timezone;
      let nextFire: string | null | undefined;
      if (body.enabled === false) {
        nextFire = null;
      } else if (
        body.enabled !== undefined ||
        body.cron !== undefined ||
        body.timezone !== undefined
      ) {
        nextFire = nextFireOrThrow(runtime, cron, timezone);
      }
      const patch: RoutinePatch = {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.cron === undefined ? {} : { cron: body.cron }),
        ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
        ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
        ...(body.notify === undefined ? {} : { notify: body.notify }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(nextFire === undefined ? {} : { nextFireAt: nextFire }),
      };
      return json(c, parseRoutine(runtime.store.routines.update(current.id, patch)), 200);
    }),
  );

  app.post(`${ROUTINES_PATH}/:id/pause`, (c) =>
    handle(c, 'routine', () => {
      requireScope(c, 'write');
      const current = requireRoutine(runtime, c.req.param('id'));
      const updated = runtime.store.routines.update(current.id, {
        enabled: false,
        nextFireAt: null,
      });
      return json(c, parseRoutine(updated), 200);
    }),
  );

  app.post(`${ROUTINES_PATH}/:id/resume`, (c) =>
    handle(c, 'routine', () => {
      requireScope(c, 'write');
      const current = requireRoutine(runtime, c.req.param('id'));
      const nextFire = nextFireOrThrow(runtime, current.cron, current.timezone);
      const updated = runtime.store.routines.update(current.id, {
        enabled: true,
        nextFireAt: nextFire,
      });
      return json(c, parseRoutine(updated), 200);
    }),
  );

  app.post(`${ROUTINES_PATH}/:id/run`, (c) =>
    handle(c, 'routine', () => {
      requireScope(c, 'runs');
      const current = requireRoutine(runtime, c.req.param('id'));
      return json(c, parseRoutine(service.runNow(current)), 202);
    }),
  );

  app.delete(`${ROUTINES_PATH}/:id`, (c) =>
    handle(c, 'routine', () => {
      requireScope(c, 'write');
      runtime.store.routines.delete(c.req.param('id'));
      return c.body(null, 204);
    }),
  );
}
