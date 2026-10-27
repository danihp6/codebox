import { z } from 'zod';

export const CREDENTIAL_VALUE_MAX_LENGTH = 16_384;
export const CREDENTIAL_NAME_MAX_LENGTH = 120;
export const INTEGRATION_NAME_MAX_LENGTH = 120;
export const INTEGRATION_PATH_MAX_LENGTH = 2_048;
export const INTEGRATION_BODY_MAX_BYTES = 65_536;
export const INTEGRATION_HOSTS_MAX = 20;
export const INTEGRATION_RESULT_MAX_CHARACTERS = 65_536;

export const credentialKindSchema = z.enum([
  'api_key',
  'bearer',
  'basic',
  'github_app',
  'model_key',
]);
export type CredentialKind = z.infer<typeof credentialKindSchema>;

export const exposeKindSchema = z.enum(['daemon', 'tool', 'env']);
export type ExposeKind = z.infer<typeof exposeKindSchema>;

export const createCredentialSchema = z.strictObject({
  name: z.string().min(1).max(CREDENTIAL_NAME_MAX_LENGTH),
  kind: credentialKindSchema,
  expose: exposeKindSchema,
  value: z.string().min(1).max(CREDENTIAL_VALUE_MAX_LENGTH),
});
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;

export const rotateCredentialSchema = z.strictObject({
  value: z.string().min(1).max(CREDENTIAL_VALUE_MAX_LENGTH),
});
export type RotateCredentialInput = z.infer<typeof rotateCredentialSchema>;

export const publicCredentialSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: credentialKindSchema,
  expose: exposeKindSchema,
  configured: z.boolean(),
  lastFour: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastUsedAt: z.string().min(1).nullable(),
});
export type PublicCredential = z.infer<typeof publicCredentialSchema>;

export const integrationAuthSchema = z.enum(['none', 'bearer', 'header', 'basic']);
export type IntegrationAuth = z.infer<typeof integrationAuthSchema>;

export const publicIntegrationSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  auth: integrationAuthSchema,
  headerName: z.string().min(1).nullable(),
  credentialId: z.string().min(1).nullable(),
  allowedHosts: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type PublicIntegration = z.infer<typeof publicIntegrationSchema>;

export const createIntegrationSchema = z.strictObject({
  name: z.string().min(1).max(INTEGRATION_NAME_MAX_LENGTH),
  baseUrl: z.url(),
  auth: integrationAuthSchema,
  headerName: z.string().min(1).max(CREDENTIAL_NAME_MAX_LENGTH).optional(),
  credentialId: z.string().min(1).optional(),
  allowedHosts: z.array(z.string().min(1).max(253)).min(1).max(INTEGRATION_HOSTS_MAX),
});
export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;

export const integrationMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export type IntegrationMethod = z.infer<typeof integrationMethodSchema>;

export const integrationRequestSchema = z.strictObject({
  method: integrationMethodSchema,
  path: z.string().min(1).max(INTEGRATION_PATH_MAX_LENGTH),
  query: z.record(z.string().min(1), z.string()).optional(),
  headers: z.record(z.string().min(1), z.string()).optional(),
  body: z
    .string()
    .refine((value) => Buffer.byteLength(value, 'utf8') <= INTEGRATION_BODY_MAX_BYTES, {
      message: 'expected at most 65536 bytes',
    })
    .optional(),
});
export type IntegrationRequestInput = z.infer<typeof integrationRequestSchema>;

export const githubCompleteSchema = z.strictObject({
  code: z.string().min(1).max(512),
  state: z.string().min(1).max(512),
});
export type GithubCompleteInput = z.infer<typeof githubCompleteSchema>;

export const storedCredentialSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: credentialKindSchema,
  expose: exposeKindSchema,
  sealed: z.strictObject({
    v: z.literal(1),
    iv: z.string().min(1),
    tag: z.string().min(1),
    ciphertext: z.string(),
  }),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastUsedAt: z.string().min(1).nullable(),
  lastFour: z.string().optional(),
});

export const storedIntegrationSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  auth: integrationAuthSchema,
  headerName: z.string().min(1).nullable(),
  credentialId: z.string().min(1).nullable(),
  allowedHosts: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
