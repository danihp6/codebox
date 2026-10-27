import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ContractParseError, errorEnvelopeSchema } from '@codebox/contracts';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL, API_PREFIX } from '../../core/api/http';

export const CREDENTIAL_KINDS = ['api_key', 'bearer', 'basic', 'github_app', 'model_key'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_EXPOSES = ['daemon', 'tool', 'env'] as const;
export type CredentialExpose = (typeof CREDENTIAL_EXPOSES)[number];

export const INTEGRATION_AUTHS = ['none', 'bearer', 'header', 'basic'] as const;
export type IntegrationAuth = (typeof INTEGRATION_AUTHS)[number];

/** docs/api.md §5.9. A credential is metadata only: it never carries the value. */
export interface Credential {
  readonly id: string;
  readonly name: string;
  readonly kind: CredentialKind;
  readonly expose: CredentialExpose;
  readonly configured: boolean;
  readonly lastFour: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
}

export interface Integration {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly auth: IntegrationAuth;
  readonly headerName: string | null;
  readonly credentialId: string | null;
  readonly allowedHosts: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CredentialPage {
  readonly data: readonly Credential[];
  readonly nextCursor: string | null;
}

export interface IntegrationPage {
  readonly data: readonly Integration[];
  readonly nextCursor: string | null;
}

export interface CreateCredentialBody {
  readonly name: string;
  readonly kind: CredentialKind;
  readonly expose: CredentialExpose;
  readonly value: string;
}

export interface CreateIntegrationBody {
  readonly name: string;
  readonly baseUrl: string;
  readonly auth: IntegrationAuth;
  readonly headerName?: string;
  readonly credentialId?: string;
  readonly allowedHosts: readonly string[];
}

export interface GithubManifestStart {
  readonly action: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly state: string;
}

export interface GithubManifestComplete {
  readonly configured: true;
  readonly appId: number;
  readonly credentialId: string;
}

const CREDENTIAL_KEYS = [
  'id',
  'name',
  'kind',
  'expose',
  'configured',
  'lastFour',
  'createdAt',
  'updatedAt',
  'lastUsedAt',
] as const;

const INTEGRATION_KEYS = [
  'id',
  'name',
  'baseUrl',
  'auth',
  'headerName',
  'credentialId',
  'allowedHosts',
  'createdAt',
  'updatedAt',
] as const;

const PAGE_KEYS = ['data', 'nextCursor'] as const;
const MANIFEST_START_KEYS = ['action', 'manifest', 'state'] as const;
const MANIFEST_COMPLETE_KEYS = ['configured', 'appId', 'credentialId'] as const;

@Injectable({ providedIn: 'root' })
export class CredentialsApi {
  constructor(private readonly http: HttpClient) {}

  listCredentials(): Observable<CredentialPage> {
    return this.request(this.http.get<unknown>(this.url('/credentials')), parseCredentialPage);
  }

  createCredential(body: CreateCredentialBody): Observable<Credential> {
    return this.request(this.http.post<unknown>(this.url('/credentials'), body), parseCredential);
  }

  removeCredential(id: string): Observable<void> {
    return this.request(
      this.http.delete<unknown>(this.url(`/credentials/${id}`)),
      (): void => undefined,
    );
  }

  listIntegrations(): Observable<IntegrationPage> {
    return this.request(this.http.get<unknown>(this.url('/integrations')), parseIntegrationPage);
  }

  createIntegration(body: CreateIntegrationBody): Observable<Integration> {
    return this.request(this.http.post<unknown>(this.url('/integrations'), body), parseIntegration);
  }

  removeIntegration(id: string): Observable<void> {
    return this.request(
      this.http.delete<unknown>(this.url(`/integrations/${id}`)),
      (): void => undefined,
    );
  }

  startGithubManifest(): Observable<GithubManifestStart> {
    return this.request(
      this.http.post<unknown>(this.url('/integrations/github/manifest'), null),
      parseGithubManifestStart,
    );
  }

  completeGithubManifest(code: string, state: string): Observable<GithubManifestComplete> {
    return this.request(
      this.http.post<unknown>(this.url('/integrations/github/complete'), { code, state }),
      parseGithubManifestComplete,
    );
  }

  private url(path: string): string {
    return `${API_BASE_URL}${API_PREFIX}${path}`;
  }

  private request<T>(request: Observable<unknown>, parse: (input: unknown) => T): Observable<T> {
    return request.pipe(
      map((body) => this.parseBody(body, parse)),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }

  private parseBody<T>(body: unknown, parse: (input: unknown) => T): T {
    try {
      return parse(body);
    } catch (error) {
      if (error instanceof ContractParseError) {
        throw new ApiError({
          message: error.message,
          status: 200,
          code: 'contract',
          requestId: null,
          details: { boundary: error.boundary, issues: error.issues },
        });
      }
      throw error;
    }
  }
}

export function parseCredential(input: unknown): Credential {
  const record = recordOf(input, 'credential');
  rejectUnknown(record, CREDENTIAL_KEYS, 'credential');
  return {
    id: text(record, 'id', 'credential'),
    name: text(record, 'name', 'credential'),
    kind: oneOf(record, 'kind', CREDENTIAL_KINDS, 'credential'),
    expose: oneOf(record, 'expose', CREDENTIAL_EXPOSES, 'credential'),
    configured: boolean(record, 'configured', 'credential'),
    lastFour: optionalText(record, 'lastFour', 'credential'),
    createdAt: text(record, 'createdAt', 'credential'),
    updatedAt: text(record, 'updatedAt', 'credential'),
    lastUsedAt: nullableText(record, 'lastUsedAt', 'credential'),
  };
}

export function parseCredentialPage(input: unknown): CredentialPage {
  const record = recordOf(input, 'credential');
  rejectUnknown(record, PAGE_KEYS, 'credential');
  return {
    data: pageItems(record['data'], 'credential', parseCredential),
    nextCursor: nullableText(record, 'nextCursor', 'credential'),
  };
}

export function parseIntegration(input: unknown): Integration {
  const record = recordOf(input, 'integration');
  rejectUnknown(record, INTEGRATION_KEYS, 'integration');
  return {
    id: text(record, 'id', 'integration'),
    name: text(record, 'name', 'integration'),
    baseUrl: text(record, 'baseUrl', 'integration'),
    auth: oneOf(record, 'auth', INTEGRATION_AUTHS, 'integration'),
    headerName: nullableText(record, 'headerName', 'integration'),
    credentialId: nullableText(record, 'credentialId', 'integration'),
    allowedHosts: strings(record['allowedHosts'], 'integration', 'allowedHosts'),
    createdAt: text(record, 'createdAt', 'integration'),
    updatedAt: text(record, 'updatedAt', 'integration'),
  };
}

export function parseIntegrationPage(input: unknown): IntegrationPage {
  const record = recordOf(input, 'integration');
  rejectUnknown(record, PAGE_KEYS, 'integration');
  return {
    data: pageItems(record['data'], 'integration', parseIntegration),
    nextCursor: nullableText(record, 'nextCursor', 'integration'),
  };
}

export function parseGithubManifestStart(input: unknown): GithubManifestStart {
  const record = recordOf(input, 'githubManifest');
  rejectUnknown(record, MANIFEST_START_KEYS, 'githubManifest');
  const manifest = record['manifest'];
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw issue('githubManifest', 'githubManifest.manifest', 'expected an object');
  }
  return {
    action: text(record, 'action', 'githubManifest'),
    manifest: manifest as Readonly<Record<string, unknown>>,
    state: text(record, 'state', 'githubManifest'),
  };
}

export function parseGithubManifestComplete(input: unknown): GithubManifestComplete {
  const record = recordOf(input, 'githubManifest');
  rejectUnknown(record, MANIFEST_COMPLETE_KEYS, 'githubManifest');
  if (record['configured'] !== true) {
    throw issue('githubManifest', 'githubManifest.configured', 'expected true');
  }
  return {
    configured: true,
    appId: integer(record, 'appId', 'githubManifest'),
    credentialId: text(record, 'credentialId', 'githubManifest'),
  };
}

function recordOf(input: unknown, boundary: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw issue(boundary, boundary, 'expected an object');
  }
  return input as Record<string, unknown>;
}

function rejectUnknown(
  record: Record<string, unknown>,
  keys: readonly string[],
  boundary: string,
): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw issue(boundary, `${boundary}.${key}`, 'unrecognized key');
  }
}

function text(record: Record<string, unknown>, key: string, boundary: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw issue(boundary, `${boundary}.${key}`, 'expected a non-empty string');
  }
  return value;
}

function optionalText(record: Record<string, unknown>, key: string, boundary: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw issue(boundary, `${boundary}.${key}`, 'expected a string');
  return value;
}

function nullableText(
  record: Record<string, unknown>,
  key: string,
  boundary: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw issue(boundary, `${boundary}.${key}`, 'expected a string or null');
  }
  return value;
}

function boolean(record: Record<string, unknown>, key: string, boundary: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw issue(boundary, `${boundary}.${key}`, 'expected a boolean');
  }
  return value;
}

function integer(record: Record<string, unknown>, key: string, boundary: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw issue(boundary, `${boundary}.${key}`, 'expected an integer');
  }
  return value;
}

function oneOf<T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[],
  boundary: string,
): T {
  const value = record[key];
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw issue(boundary, `${boundary}.${key}`, `expected one of ${values.join(', ')}`);
  }
  return value as T;
}

function strings(input: unknown, boundary: string, key: string): readonly string[] {
  if (!Array.isArray(input)) throw issue(boundary, `${boundary}.${key}`, 'expected an array');
  const values: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value: unknown = input[index];
    if (typeof value !== 'string' || value.length === 0) {
      throw issue(boundary, `${boundary}.${key}.${index}`, 'expected a non-empty string');
    }
    values.push(value);
  }
  return values;
}

function pageItems<T>(input: unknown, boundary: string, parse: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(input)) throw issue(boundary, `${boundary}.data`, 'expected an array');
  const items: T[] = [];
  for (let index = 0; index < input.length; index += 1) {
    items.push(parse(input[index]));
  }
  return items;
}

function issue(boundary: string, path: string, message: string): ContractParseError {
  return new ContractParseError(boundary, [{ path, message, code: 'custom' }]);
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof HttpErrorResponse) {
    const envelope = errorEnvelopeSchema.safeParse(error.error);
    if (envelope.success) {
      const failure = envelope.data.error;
      return new ApiError({
        message: failure.message,
        status: error.status,
        code: failure.code,
        requestId: failure.requestId,
        details: failure.details ?? null,
      });
    }
    return new ApiError({
      message: error.message,
      status: error.status,
      code: error.status === 401 ? 'unauthorized' : 'internal',
      requestId: error.headers.get('x-request-id'),
      details: null,
    });
  }
  return new ApiError({
    message: error instanceof Error ? error.message : 'Request failed',
    status: 0,
    code: 'network',
    requestId: null,
    details: null,
  });
}
