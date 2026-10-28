import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import { ProviderAccountId, timestampSchema } from './primitives.js';

export const providerIdSchema: z.ZodString = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const PROVIDER_AUTH_KINDS = ['oauth', 'token'] as const;
export const providerAuthKindSchema = z.enum(PROVIDER_AUTH_KINDS);
export type ProviderAuthKind = z.infer<typeof providerAuthKindSchema>;

export const providerSchema = z.strictObject({
  id: providerIdSchema,
  label: z.string().min(1).max(80),
  authKind: providerAuthKindSchema,
  baseUrl: z.url({ protocol: /^https$/ }).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Provider = z.infer<typeof providerSchema>;

export const PROVIDER_ACCOUNT_STATES = ['active', 'exhausted', 'invalid', 'disabled'] as const;
export const providerAccountStateSchema = z.enum(PROVIDER_ACCOUNT_STATES);
export type ProviderAccountState = z.infer<typeof providerAccountStateSchema>;

/** `usedToday` is the account's own daily rollup; `day` is UTC, `YYYY-MM-DD` (D54 budget). */
export const accountDaySchema: z.ZodString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const providerAccountSchema = z
  .strictObject({
    id: ProviderAccountId,
    providerId: providerIdSchema,
    label: z.string().min(1).max(80),
    credentialId: z.string().min(1),
    priority: z.number().int().min(0),
    state: providerAccountStateSchema,
    resetAt: timestampSchema.nullable(),
    budgetUsd: z.number().nonnegative().nullable(),
    usedToday: z.strictObject({
      day: accountDaySchema,
      usd: z.number().nonnegative(),
    }),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((value, ctx) => {
    if (value.state === 'exhausted' && value.resetAt === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['resetAt'],
        message: 'an exhausted account carries the instant it may be used again',
      });
    }
  });
export type ProviderAccount = z.infer<typeof providerAccountSchema>;

export function parseProvider(input: unknown): Provider {
  return parseOrThrow(providerSchema, input, 'provider');
}

export function parseProviderAccount(input: unknown): ProviderAccount {
  return parseOrThrow(providerAccountSchema, input, 'providerAccount');
}
