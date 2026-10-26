import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerChatRoutes } from './routes.js';
import { createChatService } from './service.js';
import type { ChatService } from './service.js';

const SERVICES = new WeakMap<DaemonContext, ChatService>();

/** The chat service the `chat` module built for this daemon, or `null` when it is disabled. */
export function chatServiceFor(context: DaemonContext): ChatService | null {
  return SERVICES.get(context) ?? null;
}

export function createModule(context: DaemonContext): DaemonModule {
  // No agent client, no workspace manager and no timer is built here: `createChatService`
  // claims everything on first use, so loading the module never touches the network.
  const service = createChatService({ context });
  SERVICES.set(context, service);
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
