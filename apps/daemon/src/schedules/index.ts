import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerScheduleRoutes } from './routes.js';
import { createSchedulesService } from './service.js';

export { createSchedulesService, newScheduleId, schedulesRuntimeOf } from './service.js';
export type {
  CreateScheduleInput,
  CreateSchedulesServiceOptions,
  ScheduleTickReport,
  SchedulesRuntime,
  SchedulesService,
} from './service.js';
export { ScheduleFireError, createScheduleFirePort } from './fire.js';
export type { CreateScheduleFirePortOptions, ScheduleFirePort } from './fire.js';

export function createModule(context: DaemonContext): DaemonModule {
  // Building the module opens no timer and reads no row: `register` mounts the routes and starts
  // the tick, and `shutdown` stops it without cancelling a fire already in flight.
  const service = createSchedulesService({ context });
  return {
    name: 'schedules',
    register(app): void {
      registerScheduleRoutes(app, service);
      service.start();
    },
    shutdown(): void {
      service.stop();
    },
  };
}
