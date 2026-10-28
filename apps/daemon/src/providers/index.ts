import type { DaemonContext, DaemonModule } from '../modules.js';
import { seedProviderCatalog } from './catalog.js';
import { registerProviderRoutes } from './routes.js';
import { createProvidersService } from './service.js';
import type { ProvidersService } from './service.js';

const SERVICES = new WeakMap<DaemonContext, ProvidersService>();

/**
 * The providers service of this daemon, built once. Seeding the catalog is idempotent, so a
 * caller that never loaded the module still sees the three adapters.
 */
export function providersServiceFor(context: DaemonContext): ProvidersService {
  const existing = SERVICES.get(context);
  if (existing !== undefined) return existing;
  seedProviderCatalog(context.store, context.clock().toISOString());
  const service = createProvidersService({ context });
  SERVICES.set(context, service);
  return service;
}

export function createModule(context: DaemonContext): DaemonModule {
  const service = providersServiceFor(context);
  return {
    name: 'providers',
    register(app): void {
      registerProviderRoutes(app, service);
    },
  };
}

export { createProvidersService } from './service.js';
export { PROVIDER_EXHAUSTED, ProviderExhaustedError, providerExhaustedApiError } from './errors.js';
export type {
  AccountTestResult,
  OauthStartResult,
  ProviderAccountView,
  ProvidersResponse,
  ProviderView,
  ProvidersService,
  TurnFailure,
  TurnFailureOutcome,
  TurnHandle,
} from './service.js';
