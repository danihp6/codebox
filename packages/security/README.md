# `@codebox/security`

Pairing, device tokens, redaction and request signing. Every secret that leaves a process and
every comparison that could leak one through timing is decided here; the daemon maps a typed
failure to an HTTP status and never re-implements a token format, a comparison or a redaction
rule. No I/O, no network, no `process.env`: the caller passes the secret, the TTL and `now`.

## Files

- `package.json` — workspace manifest.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.

## `src/`

- `index.ts` — public entry point; re-exports every name once, grouped by module.
- `constant-time.ts` — `safeEqual` (SHA-256 digests compared with `timingSafeEqual`) and `sha256Hex`.
- `hash.ts` — scrypt hashing and verification of compared secrets, `DEFAULT_SCRYPT_PARAMS`, `deviceFingerprint`.
- `pairing.ts` — the 10-character Crockford code, its normaliser and the single-use, TTL-bounded `verifyPairingCode`.
- `tokens.ts` — `cb1` access tokens, HMAC refresh-token hashes, `hasScope` and `authorizeDevice`.
- `redact.ts` — the log redactor, its `[redacted]` placeholder and the documented key patterns.
- `access-jwt.ts` — the Cloudflare Access RS256 verifier; the daemon fetches the JWKS, this package never does.
- `constant-time.test.ts` — comparison, lengths and the SHA-256 hex vector.
- `hash.test.ts` — scrypt format, fresh salt, verification and malformed stored hashes.
- `pairing.test.ts` — the alphabet, the injected byte source, normalisation and single use.
- `tokens.test.ts` — expiry boundaries, tampered signatures, refresh-token stability and scope authorisation.
- `redact.test.ts` — the nested fixture, non-mutation, cycles, dates, errors and binary.
- `access-jwt.test.ts` — a real RSA pair, the valid claims and every rejection reason.

## Checks

- `npm run lint`, `npm test` and `npm run build` from the repository root.
- `npx vitest run --project packages/security` runs only this package's tests.
- Purity: no `process.env`, `Date.now()`, `new Date()`, `Math.random`, `fetch(` or filesystem in
  `src/**` outside the tests, and `@codebox/contracts` is imported type-only.

## Choices

- scrypt, not Argon2id: Argon2id is not a Node built-in and this package adds no dependency.
  Compared values are salted scrypt hashes; the refresh token, which the daemon must look up by
  hash, is stored as `HMAC-SHA256(CB_SESSION_SECRET, token)` instead — a salted hash cannot
  support a lookup and a database copy without the secret still grants nothing.
