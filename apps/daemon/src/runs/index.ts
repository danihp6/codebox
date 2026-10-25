import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerApprovalRoutes } from './approvals.js';
import { registerRunsRoutes } from './routes.js';
import { runsService } from './service.js';

export function createModule(context: DaemonContext): DaemonModule {
  return {
    name: 'runs',
    register(app): void {
      // Register does no I/O: `runsService` caches one instance per context and builds the
      // engine on the first run request, so the boot report never waits on OpenCode or GitHub.
      const service = runsService(context);
      registerRunsRoutes(app, service);
      registerApprovalRoutes(app, service);
    },
    shutdown(): void {
      runsService(context).stop();
    },
  };
}
