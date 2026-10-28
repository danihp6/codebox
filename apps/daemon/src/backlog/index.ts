import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerBacklogRoutes } from './routes.js';
import { backlogService } from './service.js';

export {
  BACKLOG_PATH,
  BacklogMissingError,
  BacklogRefError,
  backlogInternals,
  backlogService,
  createBacklogRuntime,
  createBacklogService,
} from './service.js';
export type {
  BacklogInternals,
  BacklogRefReason,
  BacklogRuntime,
  BacklogService,
  BacklogSnapshot,
  CreateBacklogRuntimeOptions,
  CreateBacklogServiceOptions,
} from './service.js';
export { workStates } from './select.js';

export function createModule(context: DaemonContext): DaemonModule {
  // D56: the backlog is read on demand, so the module opens no timer and reserves nothing.
  const service = backlogService(context);
  return {
    name: 'backlog',
    register(app): void {
      registerBacklogRoutes(app, service);
    },
  };
}
