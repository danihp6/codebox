import type { DaemonContext, DaemonModule } from '../modules.js';
import {
  PAIRING_RATE_LIMIT,
  PAIRING_RATE_WINDOW_SECONDS,
  createApiRateLimiters,
  createRateLimiter,
  isLoopbackRequest,
} from './middleware.js';
import { registerAuthRoutes } from './routes.js';
import { createAuthService } from './service.js';

export { AuthError } from './errors.js';
export type { AuthFailureReason } from './errors.js';
export {
  API_RATE_LIMIT,
  API_RATE_WINDOW_SECONDS,
  PAIRING_RATE_LIMIT,
  PAIRING_RATE_WINDOW_SECONDS,
  WORK_RATE_LIMIT,
  WORK_RATE_WINDOW_SECONDS,
  authenticateRequest,
  authenticatedDevice,
  bearerToken,
  createApiRateLimiters,
  createAuthMiddleware,
  createRateLimiter,
  isLoopbackRequest,
  isPublicRoute,
  isWorkRoute,
  remoteAddress,
  requiredScope,
} from './middleware.js';
export type {
  ApiRateLimiters,
  RateLimitDecision,
  RateLimiter,
  RateLimiterOptions,
} from './middleware.js';
export { registerAuthRoutes } from './routes.js';
export type { RegisterAuthRoutesOptions } from './routes.js';
export { createAuthService } from './service.js';
export type {
  AuthService,
  AuthenticatedDevice,
  CreateAuthServiceOptions,
  PairExchangeInput,
  PairResult,
  PairingCode,
  TokenPair,
} from './service.js';

export function createModule(context: DaemonContext): DaemonModule {
  const service = createAuthService({
    store: context.store,
    config: context.config,
    clock: context.clock,
    logger: context.logger,
  });
  const rateLimit = createRateLimiter({
    limit: PAIRING_RATE_LIMIT,
    windowSeconds: PAIRING_RATE_WINDOW_SECONDS,
    now: context.clock,
  });
  const limiters = createApiRateLimiters({ now: context.clock });
  return {
    name: 'auth',
    register(app, ctx): void {
      registerAuthRoutes(app, service, {
        now: ctx.clock,
        isLoopback: isLoopbackRequest,
        rateLimit,
        limiters,
        store: ctx.store,
      });
    },
  };
}
