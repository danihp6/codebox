import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerSettingsRoutes } from './routes.js';
import { createSettingsService } from './service.js';
import type { SettingsService } from './service.js';

export function createModule(context: DaemonContext): DaemonModule {
  const service: SettingsService = createSettingsService({ context });
  return {
    name: 'admin',
    register(app): void {
      registerSettingsRoutes(app, service);
    },
  };
}

export { createSettingsService } from './service.js';
export type { CreateSettingsServiceOptions, SettingsService } from './service.js';
