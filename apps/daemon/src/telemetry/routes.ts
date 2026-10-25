import { z } from 'zod';
import { parseOrThrow, telemetryRangeSchema } from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { handle, json, queryInput } from '../runs/errors.js';
import { TELEMETRY_DEFAULT_RANGE } from './service.js';
import type { TelemetryService } from './service.js';

const telemetryQuerySchema = z.strictObject({
  range: telemetryRangeSchema.default(TELEMETRY_DEFAULT_RANGE),
});

export function registerTelemetryRoutes(app: DaemonApp, service: TelemetryService): void {
  app.get(`${API_PREFIX}/telemetry`, (c) =>
    handle(c, 'telemetry', async () => {
      const query = parseOrThrow(telemetryQuerySchema, queryInput(c, 'telemetry'), 'telemetry');
      return json(c, await service.report(query.range), 200);
    }),
  );
}
