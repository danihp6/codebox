export { safeEqual, sha256Hex } from './constant-time.js';

export { DEFAULT_SCRYPT_PARAMS, hashSecret, verifySecret, deviceFingerprint } from './hash.js';
export type { ScryptParams } from './hash.js';

export {
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_ALPHABET,
  generatePairingCode,
  normalisePairingCode,
  verifyPairingCode,
} from './pairing.js';
export type { PendingPairingCode, PairingRejection, PairingVerification } from './pairing.js';

export {
  ACCESS_TOKEN_PREFIX,
  mintAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  hashRefreshToken,
  hasScope,
  authorizeDevice,
} from './tokens.js';
export type {
  AccessTokenClaims,
  MintedAccessToken,
  IssuedRefreshToken,
  IssueRefreshTokenInput,
} from './tokens.js';

export { REDACTED_PLACEHOLDER, REDACTION_KEY_PATTERNS, isSecretKey, redact } from './redact.js';

export { REDACTION_CORPUS } from './redact-corpus.js';
export type { RedactionFixture } from './redact-corpus.js';

export {
  SECRET_PATTERN_NAMES,
  SECRET_PATTERN_SOURCES,
  SECRET_SCAN_ALLOW_MARKER,
  SECRET_PLACEHOLDERS,
  scanPatchForSecrets,
  formatSecretFinding,
} from './secret-scan.js';
export type { SecretFinding, SecretPatternName } from './secret-scan.js';

export {
  SEALED_SECRET_VERSION,
  MASTER_KEY_BYTES,
  MASTER_KEY_BASE64_LENGTH,
  VaultError,
  decodeMasterKey,
  sealSecret,
  openSecret,
  lastFour,
} from './credential-vault.js';
export type { SealedSecret, VaultCode } from './credential-vault.js';

export { checkIntegrationUrl, hostAllowed } from './integration-allowlist.js';
export type { AllowlistRejection, AllowlistResult } from './integration-allowlist.js';

export { verifyAccessJwt } from './access-jwt.js';
export type {
  AccessJwk,
  AccessJwks,
  AccessClaims,
  AccessRejection,
  AccessVerification,
} from './access-jwt.js';
