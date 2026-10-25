import type { DaemonContext, DaemonModule } from '../modules.js';
import { runsService } from '../runs/service.js';
import { registerJobsRoutes } from './routes.js';
import { createJobsService } from './service.js';

export function createModule(context: DaemonContext): DaemonModule {
  return {
    name: 'jobs',
    register(app): void {
      // Register does no I/O: the service is pure wiring and the engine stays lazy until the
      // first run request, so a tree with no GitHub credential and no OpenCode listener boots.
      registerJobsRoutes(app, createJobsService({ context, runs: runsService(context) }));
    },
    shutdown(): void {
      runsService(context).stop();
    },
  };
}
