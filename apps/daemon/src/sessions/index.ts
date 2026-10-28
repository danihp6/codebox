import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerSessionRoutes } from './routes.js';
import { sessionService } from './service.js';

export {
  MAX_TEXT_CHARS,
  TARGET_WRITE_SETS,
  createSessionsService,
  outsideTarget,
  sessionService,
  sessionsInternals,
} from './service.js';
export type {
  CreateSessionInput,
  CreateSessionsServiceOptions,
  SessionMergePort,
  SessionWorkspaces,
  SessionsAgent,
  SessionsInternals,
  SessionsService,
} from './service.js';
export { newSessionId, newSessionMessageId } from './ids.js';

export function createModule(context: DaemonContext): DaemonModule {
  // Building the module opens no socket and reads no row: `register` mounts the routes only.
  const service = sessionService(context);
  return {
    name: 'sessions',
    register(app): void {
      registerSessionRoutes(app, service);
    },
  };
}
