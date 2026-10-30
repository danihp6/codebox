import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerReposRoutes } from './routes.js';
import { reposService } from './service.js';

export { createReposService, reposService, REPO_DEFAULTS } from './service.js';
export type {
  CreateRepoInput,
  CreateReposServiceOptions,
  RepoListQuery,
  RepoPatchInput,
  RepoVerifyPort,
  ReposService,
} from './service.js';
export { newRepoId } from './ids.js';

export function createModule(context: DaemonContext): DaemonModule {
  const service = reposService(context);
  return {
    name: 'repos',
    register(app): void {
      registerReposRoutes(app, service);
    },
  };
}
