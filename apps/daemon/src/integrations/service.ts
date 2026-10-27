import { z } from 'zod';
import { checkIntegrationUrl } from '@codebox/security';
import type { DaemonContext } from '../modules.js';
import type { CredentialStorage } from '../credentials/storage.js';
import {
  INTEGRATION_RESULT_MAX_CHARACTERS,
  integrationAuthSchema,
  integrationMethodSchema,
  publicIntegrationSchema,
} from '../credentials/schemas.js';
import type {
  CreateIntegrationInput,
  PublicCredential,
  PublicIntegration,
} from '../credentials/schemas.js';
import { RunApiError } from '../runs/errors.js';
import { newIntegrationId } from '../credentials/ids.js';
import { createManifestStateStore } from '../credentials/manifest.js';
import type { ManifestStateStore } from '../credentials/manifest.js';
import type { IntegrationStorage, StoredIntegration } from './storage.js';

export const GITHUB_MANIFEST_ACTION = 'https://github.com/settings/apps/new';
export const ALLOWED_REQUEST_HEADERS: readonly string[] = Object.freeze(['accept', 'content-type']);

const TRAILING_SLASHES = /\/+$/;
const RESULT_SLICE = INTEGRATION_RESULT_MAX_CHARACTERS;

const conversionSchema = z.strictObject({
  id: z.number().int().positive(),
  pem: z.string().min(1),
});

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** What the integration service needs from the credential service: metadata and one plaintext. */
export interface IntegrationCredentialSource {
  readonly storage: CredentialStorage;
  open(id: string): string;
  create(input: {
    readonly name: string;
    readonly kind: 'github_app';
    readonly expose: 'daemon';
    readonly value: string;
  }): PublicCredential;
}

export interface IntegrationRequestInput {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface IntegrationRequestResult {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
  readonly truncated: boolean;
}

export interface GithubManifestStart {
  readonly action: string;
  readonly manifest: Record<string, unknown>;
  readonly state: string;
}

export interface GithubManifestComplete {
  readonly configured: true;
  readonly appId: number;
  readonly credentialId: string;
}

export interface IntegrationsService {
  list(): readonly PublicIntegration[];
  create(input: CreateIntegrationInput): PublicIntegration;
  remove(id: string): void;
  request(id: string, input: IntegrationRequestInput): Promise<IntegrationRequestResult>;
  startManifest(): GithubManifestStart;
  completeManifest(input: {
    readonly code: string;
    readonly state: string;
  }): Promise<GithubManifestComplete>;
}

export interface CreateIntegrationsServiceOptions {
  readonly context: DaemonContext;
  readonly now?: () => Date;
  readonly fetch?: FetchLike;
  readonly storage: IntegrationStorage;
  readonly credentials: IntegrationCredentialSource;
}

function publicOf(integration: StoredIntegration): PublicIntegration {
  return publicIntegrationSchema.parse({
    id: integration.id,
    name: integration.name,
    baseUrl: integration.baseUrl,
    auth: integration.auth,
    headerName: integration.headerName,
    credentialId: integration.credentialId,
    allowedHosts: [...integration.allowedHosts],
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  });
}

function timeoutSignal(seconds: number): AbortSignal | undefined {
  return seconds === 0 ? undefined : AbortSignal.timeout(seconds * 1000);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

function authHeader(
  auth: string,
  headerName: string | null,
  value: string,
): Record<string, string> {
  switch (auth) {
    case 'bearer':
      return { authorization: `Bearer ${value}` };
    case 'header':
      return { [(headerName ?? 'authorization').toLowerCase()]: value };
    case 'basic':
      return { authorization: `Basic ${Buffer.from(value, 'utf8').toString('base64')}` };
    default:
      return {};
  }
}

export function createIntegrationsService(
  options: CreateIntegrationsServiceOptions,
): IntegrationsService {
  const context = options.context;
  const logger = context.logger;
  const now = options.now ?? context.clock;
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const storage = options.storage;
  const credentials = options.credentials;
  const states: ManifestStateStore = createManifestStateStore({ now });

  function requireIntegration(id: string): StoredIntegration {
    const integration = storage.get(id);
    if (integration === null) throw new RunApiError('not_found', 404, { path: 'integration.id' });
    return integration;
  }

  function publicUrl(): string | null {
    return context.config.CB_PUBLIC_URL;
  }

  function manifestBody(): Record<string, unknown> {
    const url = publicUrl();
    const manifest: Record<string, unknown> = {
      name: `codebox-${context.config.CB_INSTANCE_NAME}`,
      public: false,
      default_permissions: {
        contents: 'write',
        issues: 'write',
        metadata: 'read',
        pull_requests: 'write',
        checks: 'write',
      },
      default_events: [],
    };
    if (url !== null) {
      manifest.url = url;
      manifest.redirect_url = `${url.replace(TRAILING_SLASHES, '')}/providers/github/callback`;
    }
    return manifest;
  }

  async function exchangeManifest(code: string): Promise<{ id: number; pem: string }> {
    const base = context.config.CB_GITHUB_API_URL.replace(TRAILING_SLASHES, '');
    const url = `${base}/app-manifests/${encodeURIComponent(code)}/conversions`;
    const init: RequestInit = {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json' },
    };
    const signal = timeoutSignal(context.config.CB_INTEGRATION_TIMEOUT_SECONDS);
    if (signal !== undefined) init.signal = signal;
    let response: Response;
    let text: string;
    try {
      response = await fetchFn(url, init);
      text = await response.text();
    } catch (error) {
      logger.warn({ msg: 'github_manifest_failed', code: errorName(error) });
      throw new RunApiError('provider_unavailable', 503, { reason: 'provider_unavailable' });
    }
    if (response.status < 200 || response.status >= 300) {
      logger.warn({ msg: 'github_manifest_failed', status: response.status });
      throw new RunApiError('provider_unavailable', 503, { reason: 'provider_unavailable' });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new RunApiError('provider_unavailable', 503, { reason: 'provider_unavailable' });
    }
    const parsed = conversionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new RunApiError('provider_unavailable', 503, { reason: 'provider_unavailable' });
    }
    return parsed.data;
  }

  return {
    list(): readonly PublicIntegration[] {
      return storage.list().map(publicOf);
    },

    create(input: CreateIntegrationInput): PublicIntegration {
      const at = now().toISOString();
      let baseUrl: URL;
      try {
        baseUrl = new URL(input.baseUrl);
      } catch {
        throw new RunApiError('validation_failed', 422, { path: 'integration.baseUrl' });
      }
      if (baseUrl.protocol !== 'https:') {
        throw new RunApiError('validation_failed', 422, { path: 'integration.baseUrl' });
      }
      if (input.auth === 'header' && input.headerName === undefined) {
        throw new RunApiError('validation_failed', 422, { path: 'integration.headerName' });
      }
      let credentialId: string | null = null;
      if (input.auth !== 'none') {
        if (input.credentialId === undefined) {
          throw new RunApiError('validation_failed', 422, { path: 'integration.credentialId' });
        }
        if (credentials.storage.get(input.credentialId) === null) {
          throw new RunApiError('not_found', 404, { path: 'integration.credentialId' });
        }
        credentialId = input.credentialId;
      }
      const integration: StoredIntegration = {
        id: newIntegrationId(),
        name: input.name,
        baseUrl: input.baseUrl,
        auth: integrationAuthSchema.parse(input.auth),
        headerName: input.auth === 'header' ? (input.headerName ?? null) : null,
        credentialId,
        allowedHosts: [...input.allowedHosts],
        createdAt: at,
        updatedAt: at,
      };
      storage.save(integration);
      logger.info({
        msg: 'integration_created',
        integrationId: integration.id,
        auth: integration.auth,
      });
      return publicOf(integration);
    },

    remove(id: string): void {
      requireIntegration(id);
      storage.remove(id);
      logger.info({ msg: 'integration_removed', integrationId: id });
    },

    async request(id: string, input: IntegrationRequestInput): Promise<IntegrationRequestResult> {
      const integration = requireIntegration(id);
      const checked = checkIntegrationUrl({
        baseUrl: integration.baseUrl,
        path: input.path,
        allowedHosts: integration.allowedHosts,
      });
      if (!checked.ok) {
        logger.info({
          msg: 'integration_request_refused',
          integrationId: id,
          reason: checked.reason,
        });
        throw new RunApiError('validation_failed', 422, {
          path: 'integration.path',
          reason: 'host_not_allowed',
        });
      }
      const method = integrationMethodSchema.parse(input.method);
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(input.headers ?? {})) {
        const lower = name.toLowerCase();
        if (ALLOWED_REQUEST_HEADERS.includes(lower)) headers[lower] = value;
      }
      let touched: string | null = null;
      if (integration.auth !== 'none' && integration.credentialId !== null) {
        const credential = credentials.storage.get(integration.credentialId);
        if (credential === null) {
          throw new RunApiError('not_found', 404, { path: 'credential.id' });
        }
        const value = credentials.open(credential.id);
        Object.assign(headers, authHeader(integration.auth, integration.headerName, value));
        touched = credential.id;
      }
      const url = checked.url;
      for (const [key, value] of Object.entries(input.query ?? {})) {
        url.searchParams.set(key, value);
      }
      const init: RequestInit = { method, headers };
      if (input.body !== undefined && method !== 'GET') init.body = input.body;
      const signal = timeoutSignal(context.config.CB_INTEGRATION_TIMEOUT_SECONDS);
      if (signal !== undefined) init.signal = signal;
      let response: Response;
      let text: string;
      try {
        response = await fetchFn(url.toString(), init);
        text = await response.text();
      } catch (error) {
        logger.warn({
          msg: 'integration_request_failed',
          integrationId: id,
          code: errorName(error),
        });
        throw new RunApiError('provider_unavailable', 503, {
          reason: 'integration_unreachable',
        });
      }
      const truncated = text.length > RESULT_SLICE;
      if (response.status < 200 || response.status >= 300) {
        logger.warn({
          msg: 'integration_request_failed',
          integrationId: id,
          status: response.status,
        });
      } else if (touched !== null) {
        credentials.storage.touch(touched, now().toISOString());
      }
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: truncated ? text.slice(0, RESULT_SLICE) : text,
        truncated,
      };
    },

    startManifest(): GithubManifestStart {
      if (!credentials.storage.configured) {
        throw new RunApiError('provider_unavailable', 503, {
          reason: 'secrets_not_configured',
        });
      }
      const state = states.issue();
      logger.info({ msg: 'github_manifest_started' });
      return { action: GITHUB_MANIFEST_ACTION, manifest: manifestBody(), state };
    },

    async completeManifest(input: {
      readonly code: string;
      readonly state: string;
    }): Promise<GithubManifestComplete> {
      if (!credentials.storage.configured) {
        throw new RunApiError('provider_unavailable', 503, {
          reason: 'secrets_not_configured',
        });
      }
      if (!states.consume(input.state)) {
        throw new RunApiError('validation_failed', 422, { reason: 'state_invalid' });
      }
      const app = await exchangeManifest(input.code);
      const credential = credentials.create({
        name: `GitHub App ${app.id}`,
        kind: 'github_app',
        expose: 'daemon',
        value: app.pem,
      });
      logger.info({ msg: 'github_manifest_completed', appId: app.id });
      return { configured: true, appId: app.id, credentialId: credential.id };
    },
  };
}
