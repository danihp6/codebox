import { z } from 'zod';

export const PROVIDER_LABEL_MAX_LENGTH = 80;
export const ACCOUNT_TOKEN_MAX_LENGTH = 16_384;
export const OAUTH_CODE_MAX_LENGTH = 512;
export const OAUTH_STATE_MAX_LENGTH = 512;

export const addTokenAccountSchema = z.strictObject({
  label: z.string().min(1).max(PROVIDER_LABEL_MAX_LENGTH),
  priority: z.number().int().min(0),
  auth: z.literal('token'),
  value: z.string().min(1).max(ACCOUNT_TOKEN_MAX_LENGTH),
});
export type AddTokenAccountInput = z.infer<typeof addTokenAccountSchema>;

export const patchAccountSchema = z.strictObject({
  label: z.string().min(1).max(PROVIDER_LABEL_MAX_LENGTH).optional(),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  budgetUsd: z.number().nonnegative().nullable().optional(),
});
export type PatchAccountInput = z.infer<typeof patchAccountSchema>;

export const startOauthSchema = z.strictObject({
  label: z.string().min(1).max(PROVIDER_LABEL_MAX_LENGTH),
  priority: z.number().int().min(0),
});
export type StartOauthInput = z.infer<typeof startOauthSchema>;

export const completeOauthSchema = z.strictObject({
  code: z.string().min(1).max(OAUTH_CODE_MAX_LENGTH),
  state: z.string().min(1).max(OAUTH_STATE_MAX_LENGTH),
});
export type CompleteOauthInput = z.infer<typeof completeOauthSchema>;
