import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerWorksRoutes } from './routes.js';
import { worksService } from './service.js';

export { createWorkFromItem, createWorksService, worksInternals, worksService } from './service.js';
export type {
  CreateWorkFromItemInput,
  CreateWorkOptions,
  SessionCreator,
  WorkDetailResult,
  WorkQuery,
  WorksInternals,
  WorksService,
} from './service.js';
export { newWorkId } from './ids.js';

export function createModule(context: DaemonContext): DaemonModule {
  // Building the module reads no row and opens no timer: `register` mounts the routes only.
  const service = worksService(context);
  return {
    name: 'works',
    register(app): void {
      registerWorksRoutes(app, service);
    },
  };
}
