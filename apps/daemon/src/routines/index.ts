import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerRoutineRoutes } from './routes.js';
import { createRoutineService } from './service.js';

export { createRoutineService } from './service.js';
export type { CreateRoutineServiceOptions, RoutineService, RoutineTickReport } from './service.js';

export function createModule(context: DaemonContext): DaemonModule {
  // Building the module reads no row and starts no timer: `register` mounts the routes and
  // starts the tick, and `shutdown` stops it without waiting for a fire in flight.
  const service = createRoutineService({ context });
  return {
    name: 'routines',
    register(app): void {
      registerRoutineRoutes(app, service);
      service.start();
    },
    shutdown(): void {
      service.stop();
    },
  };
}
