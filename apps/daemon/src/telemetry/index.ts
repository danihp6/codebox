import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerTelemetryRoutes } from './routes.js';
import { createTelemetryService } from './service.js';

export { createTelemetryService } from './service.js';

export function createModule(context: DaemonContext): DaemonModule {
  // Building the service performs no I/O: the probes, the queries and the log directory read
  // happen on the request or on the first retention tick.
  const service = createTelemetryService({ context });
  return {
    name: 'telemetry',
    register(app): void {
      registerTelemetryRoutes(app, service);
      service.start();
    },
    shutdown(): void {
      service.stop();
    },
  };
}
