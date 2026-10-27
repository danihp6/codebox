import { decodeMasterKey, lastFour, openSecret, sealSecret } from '@codebox/security';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { createIntegrationsService } from '../integrations/service.js';
import type {
  IntegrationRequestInput,
  IntegrationRequestResult,
  IntegrationsService,
} from '../integrations/service.js';
import { createFileIntegrationStorage, integrationsDirectory } from '../integrations/storage.js';
import { newCredentialId } from './ids.js';
import { publicCredentialSchema } from './schemas.js';
import type {
  CreateCredentialInput,
  CreateIntegrationInput,
  ExposeKind,
  PublicCredential,
  PublicIntegration,
  RotateCredentialInput,
} from './schemas.js';
import { createFileCredentialStorage, credentialsDirectory, storedLastFour } from './storage.js';
import type { CredentialStorage, StoredCredential } from './storage.js';

export interface CredentialsService {
  readonly storage: CredentialStorage;
  list(): readonly PublicCredential[];
  create(input: CreateCredentialInput): PublicCredential;
  rotate(id: string, input: RotateCredentialInput): PublicCredential;
  remove(id: string): void;
  /** The plaintext of one credential; the caller never logs or returns it. */
  open(id: string): string;
  listIntegrations(): readonly PublicIntegration[];
  createIntegration(input: CreateIntegrationInput): PublicIntegration;
  removeIntegration(id: string): void;
  request(id: string, input: IntegrationRequestInput): Promise<IntegrationRequestResult>;
}

export interface CreateCredentialsServiceOptions {
  readonly context: DaemonContext;
  readonly now?: () => Date;
  readonly storage?: CredentialStorage;
}

const INTEGRATIONS = new WeakMap<CredentialsService, IntegrationsService>();

/** The integration service the credentials service built, so the module mounts one route set. */
export function integrationsOf(service: CredentialsService): IntegrationsService {
  const integrations = INTEGRATIONS.get(service);
  if (integrations === undefined) {
    throw new Error('the credentials service was not created by createCredentialsService');
  }
  return integrations;
}

function masterKeyOf(config: DaemonContext['config']): Uint8Array | null {
  if (config.CB_SECRETS_KEY === null) return null;
  try {
    return decodeMasterKey(config.CB_SECRETS_KEY);
  } catch {
    return null;
  }
}

function envExposureAllowed(expose: ExposeKind, kind: string): boolean {
  return expose !== 'env' || kind === 'model_key';
}

export function createCredentialsService(
  options: CreateCredentialsServiceOptions,
): CredentialsService {
  const context = options.context;
  const logger = context.logger;
  const now = options.now ?? context.clock;
  const masterKey = masterKeyOf(context.config);
  const storage =
    options.storage ??
    createFileCredentialStorage({
      directory: credentialsDirectory(context.paths.stateDir),
      masterKey,
    });

  function requireConfigured(): void {
    if (!storage.configured || masterKey === null) {
      throw new RunApiError('provider_unavailable', 503, { reason: 'secrets_not_configured' });
    }
  }

  function requireCredential(id: string): StoredCredential {
    const credential = storage.get(id);
    if (credential === null) throw new RunApiError('not_found', 404, { path: 'credential.id' });
    return credential;
  }

  function toPublic(credential: StoredCredential): PublicCredential {
    return publicCredentialSchema.parse({
      id: credential.id,
      name: credential.name,
      kind: credential.kind,
      expose: credential.expose,
      configured: storage.configured,
      lastFour: storedLastFour(credential),
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      lastUsedAt: credential.lastUsedAt,
    });
  }

  function withLastFour(credential: StoredCredential, four: string): StoredCredential {
    return { ...credential, lastFour: four } as StoredCredential;
  }

  function key(): Uint8Array {
    if (masterKey === null) {
      throw new RunApiError('provider_unavailable', 503, { reason: 'secrets_not_configured' });
    }
    return masterKey;
  }

  function create(input: CreateCredentialInput): PublicCredential {
    if (!envExposureAllowed(input.expose, input.kind)) {
      throw new RunApiError('validation_failed', 422, {
        path: 'credential.expose',
        reason: 'env_not_allowed',
      });
    }
    requireConfigured();
    const at = now().toISOString();
    const credential = withLastFour(
      {
        id: newCredentialId(),
        name: input.name,
        kind: input.kind,
        expose: input.expose,
        sealed: sealSecret(input.value, key()),
        createdAt: at,
        updatedAt: at,
        lastUsedAt: null,
      },
      lastFour(input.value),
    );
    storage.save(credential);
    logger.info({
      msg: 'credential_saved',
      credentialId: credential.id,
      kind: credential.kind,
      expose: credential.expose,
    });
    return toPublic(credential);
  }

  function rotate(id: string, input: RotateCredentialInput): PublicCredential {
    requireConfigured();
    const current = requireCredential(id);
    const at = now().toISOString();
    const rotated = withLastFour(
      {
        ...current,
        sealed: sealSecret(input.value, key()),
        updatedAt: at,
        lastUsedAt: null,
      },
      lastFour(input.value),
    );
    storage.save(rotated);
    logger.info({ msg: 'credential_rotated', credentialId: id });
    return toPublic(rotated);
  }

  function remove(id: string): void {
    requireCredential(id);
    storage.remove(id);
    logger.info({ msg: 'credential_removed', credentialId: id });
  }

  function open(id: string): string {
    const credential = requireCredential(id);
    requireConfigured();
    try {
      return openSecret(credential.sealed, key());
    } catch {
      throw new RunApiError('provider_unavailable', 503, { reason: 'secrets_decrypt_failed' });
    }
  }

  const source = { storage, open, create };
  const integrations = createIntegrationsService({
    context,
    now,
    storage: createFileIntegrationStorage({
      directory: integrationsDirectory(context.paths.stateDir),
    }),
    credentials: source,
  });

  const service: CredentialsService = {
    storage,
    list(): readonly PublicCredential[] {
      return storage.list().map(toPublic);
    },
    create,
    rotate,
    remove,
    open,
    listIntegrations: () => integrations.list(),
    createIntegration: (input) => integrations.create(input),
    removeIntegration: (id) => integrations.remove(id),
    request: (id, input) => integrations.request(id, input),
  };
  INTEGRATIONS.set(service, integrations);
  return service;
}
