import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerPushRoutes } from './routes.js';
import { createPushService } from './service.js';

export { createPushService, PUSH_PUMP_MS } from './service.js';
export type {
  PushService,
  CreatePushServiceOptions,
  PushPumpReport,
  PushDeliveryReport,
} from './service.js';
export { DEFAULT_NOTIFICATION_EVENTS, NOTIFICATION_TYPES, deliveryKeyOf } from './mapping.js';
export type { NotificationType, PushMessage } from './mapping.js';
export type { PushTransport, PushSendInput, PushSendOutcome } from './transport.js';
export { NOTIFICATION_PREFERENCES_KEY, PUSH_SUBSCRIPTIONS_KEY } from './storage.js';

export function createModule(context: DaemonContext): DaemonModule {
  // Nothing is opened here: an unconfigured push subsystem still answers its routes, and
  // `register` is what starts the pump.
  const service = createPushService({ context });
  return {
    name: 'push',
    register(app): void {
      registerPushRoutes(app, service);
      service.start();
    },
    shutdown(): void {
      service.stop();
    },
  };
}
