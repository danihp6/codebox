import { z } from 'zod';
import type { ProviderId } from '@codebox/contracts';

export const OAUTH_STATE_TTL_SECONDS = 600;
export const OAUTH_TOKEN_ENVELOPE_VERSION = 1;

export interface ProviderOauthTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string | null;
}

export interface ProviderOauthAdapter {
  readonly providerId: ProviderId;
  authorizeUrl(input: { readonly state: string }): string;
  exchange(input: { readonly code: string }): Promise<ProviderOauthTokens>;
}

/** Today: empty. A provider with no adapter answers `provider_oauth_unsupported`. */
export const DEFAULT_OAUTH_ADAPTERS: readonly ProviderOauthAdapter[] = Object.freeze([]);

const envelopeSchema = z.strictObject({
  v: z.literal(OAUTH_TOKEN_ENVELOPE_VERSION),
  access: z.string().min(1),
  refresh: z.string().min(1).nullable(),
  expiresAt: z.string().min(1).nullable(),
});

/** `{"v":1,"access":"…","refresh":null,"expiresAt":null}` — the sealed value of an OAuth account. */
export function encodeOauthEnvelope(tokens: ProviderOauthTokens): string {
  return JSON.stringify({
    v: OAUTH_TOKEN_ENVELOPE_VERSION,
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  });
}

export function decodeOauthEnvelope(value: string): ProviderOauthTokens | null {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    accessToken: parsed.data.access,
    refreshToken: parsed.data.refresh,
    expiresAt: parsed.data.expiresAt,
  };
}
