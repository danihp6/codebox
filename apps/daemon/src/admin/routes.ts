import { z } from 'zod';
import { brakeSchema, parseOrThrow, timezoneSchema } from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { handle, json, readJson, requireScope } from '../runs/errors.js';
import type { SettingsService } from './service.js';

const SETTINGS_PATH = `${API_PREFIX}/settings`;
const BRAKE_PATH = `${API_PREFIX}/admin/brake`;
const CACHE_WIPE_PATH = `${API_PREFIX}/admin/cache/wipe`;

/** The only writable setting: the rest are host configuration (`docs/api.md` §5.7). */
const patchSettingsSchema = z.strictObject({
  timezone: timezoneSchema.optional(),
});

export function registerSettingsRoutes(app: DaemonApp, service: SettingsService): void {
  app.get(SETTINGS_PATH, (c) => handle(c, 'settings', () => json(c, service.get(), 200)));

  app.patch(SETTINGS_PATH, (c) =>
    handle(c, 'settings', async () => {
      requireScope(c, 'write');
      const body = parseOrThrow(patchSettingsSchema, await readJson(c), 'settings');
      return json(
        c,
        service.patch(body.timezone === undefined ? {} : { timezone: body.timezone }),
        200,
      );
    }),
  );

  app.post(BRAKE_PATH, (c) =>
    handle(c, 'brake', async () => {
      requireScope(c, 'admin');
      const body = parseOrThrow(brakeSchema, await readJson(c), 'brake');
      return json(c, service.brake(body.enabled), 200);
    }),
  );

  app.post(CACHE_WIPE_PATH, (c) =>
    handle(c, 'cacheWipe', async () => {
      requireScope(c, 'admin');
      await service.wipeCache();
      return c.body(null, 202);
    }),
  );
}
