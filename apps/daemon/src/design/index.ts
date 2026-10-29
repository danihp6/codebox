import type { DaemonContext, DaemonModule } from '../modules.js';
import { registerDesignRoutes } from './routes.js';
import { designService } from './service.js';

export { DesignPreviewError, buildDesignPreview } from './preview.js';
export type { DesignPreviewInput, DesignSource } from './preview.js';
export {
  DesignReadError,
  DesignRevisionError,
  createDesignRuntime,
  createDesignService,
  designInternals,
  designService,
} from './service.js';
export type {
  CreateDesignServiceOptions,
  DesignInternals,
  DesignRuntime,
  DesignRuntimeOptions,
  DesignService,
  DesignSnapshot,
} from './service.js';

export function createModule(context: DaemonContext): DaemonModule {
  const service = designService(context);
  return {
    name: 'design',
    register(app): void {
      registerDesignRoutes(app, service, context.store);
    },
  };
}
