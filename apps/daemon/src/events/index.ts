import type { DaemonContext, DaemonModule } from '../modules.js';
import { createSseBridge } from './bridge.js';
import { SSE_CONNECTIONS_PER_DEVICE, createConnectionLimiter } from './limits.js';
import { eventNotifier } from './notifier.js';
import { registerEventRoutes } from './routes.js';

export function createModule(context: DaemonContext): DaemonModule {
  // Both are pure: no socket, no timer, no store write until the first stream asks for a frame.
  const bridge = createSseBridge({
    store: context.store,
    clock: context.clock,
    notifier: eventNotifier(context),
  });
  const limiter = createConnectionLimiter(SSE_CONNECTIONS_PER_DEVICE);
  return {
    name: 'events',
    register(app): void {
      registerEventRoutes(app, { bridge, limiter });
    },
  };
}
