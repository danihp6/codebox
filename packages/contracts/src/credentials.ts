import { z } from 'zod';
import { parseOrThrow } from './parse.js';

export const CREDENTIAL_KINDS = ['api_key', 'bearer', 'basic', 'github_app', 'model_key'] as const;
export const credentialKindSchema = z.enum(CREDENTIAL_KINDS);
export type CredentialKind = z.infer<typeof credentialKindSchema>;

export const CREDENTIAL_EXPOSES = ['daemon', 'tool', 'env'] as const;
export const credentialExposeSchema = z.enum(CREDENTIAL_EXPOSES);
export type CredentialExpose = z.infer<typeof credentialExposeSchema>;

/** docs/api.md §5.9: metadata only; the value never crosses this boundary. */
export const credentialSummarySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: credentialKindSchema,
  expose: credentialExposeSchema,
  configured: z.boolean(),
  lastFour: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastUsedAt: z.string().min(1).nullable(),
});
export type CredentialSummary = z.infer<typeof credentialSummarySchema>;

export function parseCredentialSummary(input: unknown): CredentialSummary {
  return parseOrThrow(credentialSummarySchema, input, 'credential');
}
