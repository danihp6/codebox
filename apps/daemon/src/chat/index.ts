import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerChatRoutes } from './routes.js';
import { createChatService } from './service.js';

export function createModule(context: DaemonContext): DaemonModule {
  // No agent client, no workspace manager and no timer is built here: `createChatService`
  // claims everything on first use, so loading the module never touches the network.
  const service = createChatService({ context });
  return {
    name: 'chat',
    register(app): void {
      registerChatRoutes(app, service);
    },
    shutdown(): void {
      service.stop();
    },
  };
}
