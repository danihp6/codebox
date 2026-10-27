import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerIntegrationRoutes } from '../integrations/index.js';
import { registerCredentialRoutes } from './routes.js';
import { createCredentialsService, integrationsOf } from './service.js';

export { createCredentialsService, integrationsOf } from './service.js';
export type { CreateCredentialsServiceOptions, CredentialsService } from './service.js';
export { createManifestStateStore } from './manifest.js';
export type { ManifestStateStore } from './manifest.js';
export { newCredentialId, newIntegrationId } from './ids.js';
export { createFileCredentialStorage, credentialsDirectory } from './storage.js';
export type { CredentialStorage, StoredCredential } from './storage.js';

export function createModule(context: DaemonContext): DaemonModule {
  const service = createCredentialsService({ context });
  const integrations = integrationsOf(service);
  return {
    name: 'credentials',
    register(app): void {
      if (!service.storage.configured) {
        context.logger.warn({ msg: 'secrets_store_unconfigured' });
      }
      registerCredentialRoutes(app, service);
      registerIntegrationRoutes(app, integrations);
    },
  };
}
