export type AllowlistRejection = 'invalid_url' | 'scheme' | 'host';

export type AllowlistResult =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: AllowlistRejection };

/**
 * Lowercases both sides and compares the whole host: a suffix, a trailing dot or an unlisted
 * IP literal is a different host, and no DNS lookup ever runs here.
 */
export function hostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const candidate = host.toLowerCase();
  return allowedHosts.some((entry) => entry.toLowerCase() === candidate);
}

/** `https` only; `path` must start with '/'; the resolved host must match an entry exactly. */
export function checkIntegrationUrl(input: {
  readonly baseUrl: string;
  readonly path: string;
  readonly allowedHosts: readonly string[];
}): AllowlistResult {
  if (!input.path.startsWith('/')) return { ok: false, reason: 'invalid_url' };
  let base: URL;
  try {
    base = new URL(input.baseUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (base.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  let url: URL;
  try {
    url = new URL(input.path, base);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (!hostAllowed(url.hostname, input.allowedHosts)) return { ok: false, reason: 'host' };
  return { ok: true, url };
}
