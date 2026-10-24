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

export { verifyAccessJwt } from './access-jwt.js';
export type {
  AccessJwk,
  AccessJwks,
  AccessClaims,
  AccessRejection,
  AccessVerification,
} from './access-jwt.js';
