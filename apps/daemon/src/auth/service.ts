import { DeviceId, SCOPES, scopeSchema } from '@codebox/contracts';
import type { CodeboxConfig, Device, Scope } from '@codebox/contracts';
import {
  deviceFingerprint,
  generatePairingCode,
  hashRefreshToken,
  hashSecret,
  issueRefreshToken,
  mintAccessToken,
  normalisePairingCode,
  sha256Hex,
  verifyAccessToken,
  verifyPairingCode,
} from '@codebox/security';
import type { Store } from '@codebox/store';
import type { DeviceRecord } from '@codebox/store';
import type { Logger } from '../logger.js';
import { AuthError } from './errors.js';
import { newDeviceId as generateDeviceId } from './ids.js';

export const PAIRING_NAME_MAX_LENGTH = 64;
export const PAIRING_TTL_MIN_SECONDS = 30;
export const PAIRING_TTL_MAX_SECONDS = 3600;

const SECONDS_PER_DAY = 86_400;

export interface PairingCode {
  readonly code: string;
  readonly expiresAt: string;
  readonly scopes: readonly Scope[];
  readonly name: string;
}

export interface PairExchangeInput {
  readonly code: string;
  readonly deviceName: string;
  readonly platform: 'ios' | 'android' | 'web' | 'cli';
  readonly devicePublicKey: string;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scopes: readonly Scope[];
}

export interface PairResult extends TokenPair {
  readonly device: Device;
}

export interface AuthenticatedDevice {
  readonly id: string;
  readonly scopes: readonly Scope[];
}

export interface AuthService {
  issueCode(input: {
    name: string;
    ttlSeconds?: number;
    scopes?: readonly Scope[];
  }): Promise<PairingCode>;
  exchange(input: PairExchangeInput, source: string): Promise<PairResult>;
  refresh(input: { refreshToken: string }): Promise<TokenPair>;
  logout(deviceId: string): void;
  authenticate(accessToken: string): AuthenticatedDevice | null;
}

export interface CreateAuthServiceOptions {
  readonly store: Store;
  readonly config: Pick<
    CodeboxConfig,
    | 'CB_SESSION_SECRET'
    | 'CB_PAIRING_TTL_SECONDS'
    | 'CB_ACCESS_TOKEN_TTL_SECONDS'
    | 'CB_REFRESH_TOKEN_TTL_DAYS'
  >;
  readonly clock: () => Date;
  readonly logger: Logger;
  readonly newDeviceId?: () => string;
  readonly generateCode?: () => string;
}

interface PendingCode {
  readonly hash: string;
  readonly expiresAt: string;
  readonly scopes: readonly Scope[];
  readonly name: string;
  usedAt: string | null;
}

/**
 * Only the `Device` fields leave the service: a store row also carries the refresh hashes and
 * the public key, and neither is ever part of a response body.
 */
function publicDevice(record: DeviceRecord): Device {
  return {
    id: record.id,
    name: record.name,
    platform: record.platform,
    scopes: [...record.scopes],
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
  };
}

function validateScopes(scopes: readonly Scope[]): readonly Scope[] {
  for (const scope of scopes) {
    if (!scopeSchema.safeParse(scope).success) {
      throw new AuthError('invalid_payload', 422, { path: 'scopes' });
    }
  }
  if (scopes.length === 0) throw new AuthError('invalid_payload', 422, { path: 'scopes' });
  return [...scopes];
}

function rejection(reason: 'unknown' | 'expired' | 'used'): AuthError {
  if (reason === 'expired') return new AuthError('expired_code', 401, { reason: 'expired_code' });
  if (reason === 'used') return new AuthError('used_code', 401, { reason: 'used_code' });
  return new AuthError('unknown_code', 401, { reason: 'unknown_code' });
}

export function createAuthService(options: CreateAuthServiceOptions): AuthService {
  const { store, config, clock, logger } = options;
  const secret = config.CB_SESSION_SECRET;
  const accessTtlSeconds = config.CB_ACCESS_TOKEN_TTL_SECONDS;
  const refreshTtlMs = config.CB_REFRESH_TOKEN_TTL_DAYS * SECONDS_PER_DAY * 1000;
  // In memory by design (docs/api.md §2): a restart invalidates every unused pairing code.
  const pending = new Map<string, PendingCode>();
  const nextDeviceId = options.newDeviceId ?? generateDeviceId;
  const nextCode = options.generateCode ?? ((): string => generatePairingCode());

  return {
    async issueCode(input: {
      name: string;
      ttlSeconds?: number;
      scopes?: readonly Scope[];
    }): Promise<PairingCode> {
      const name = input.name;
      if (name.length < 1 || name.length > PAIRING_NAME_MAX_LENGTH) {
        throw new AuthError('invalid_payload', 422, { path: 'name' });
      }
      const ttlSeconds = input.ttlSeconds ?? config.CB_PAIRING_TTL_SECONDS;
      if (
        !Number.isInteger(ttlSeconds) ||
        ttlSeconds < PAIRING_TTL_MIN_SECONDS ||
        ttlSeconds > PAIRING_TTL_MAX_SECONDS
      ) {
        throw new AuthError('invalid_payload', 422, { path: 'ttlSeconds' });
      }
      const scopes = validateScopes(input.scopes ?? SCOPES);
      const at = clock();
      const code = nextCode();
      const normalised = normalisePairingCode(code);
      const hash = await hashSecret(normalised);
      const expiresAt = new Date(at.getTime() + ttlSeconds * 1000).toISOString();
      pending.set(sha256Hex(normalised), { hash, expiresAt, scopes, name, usedAt: null });
      return { code, expiresAt, scopes, name };
    },

    async exchange(input: PairExchangeInput, source: string): Promise<PairResult> {
      const at = clock();
      const key = sha256Hex(normalisePairingCode(input.code));
      const candidate = pending.get(key);
      const verification = await verifyPairingCode({
        code: input.code,
        pending:
          candidate === undefined
            ? null
            : { hash: candidate.hash, expiresAt: candidate.expiresAt, usedAt: candidate.usedAt },
        now: at,
      });
      // Two correct exchanges can pass the await together; the re-read and the `usedAt` write
      // below run in one tick, so only the first one creates a device.
      const current = pending.get(key);
      if (!verification.ok) throw rejection(verification.reason);
      if (current === undefined || current.usedAt !== null) throw rejection('used');
      current.usedAt = at.toISOString();

      const deviceId = nextDeviceId();
      if (!DeviceId.safeParse(deviceId).success) {
        throw new Error('the device id generator returned an invalid id');
      }
      const refresh = issueRefreshToken({ secret });
      const record = store.devices.create({
        id: deviceId,
        name: input.deviceName,
        platform: input.platform,
        publicKey: input.devicePublicKey,
        fingerprint: deviceFingerprint(input.devicePublicKey),
        scopes: [...current.scopes],
        refreshTokenHash: refresh.hash,
        refreshPreviousHash: null,
        refreshExpiresAt: new Date(at.getTime() + refreshTtlMs).toISOString(),
        createdAt: at.toISOString(),
        lastSeenAt: null,
        revokedAt: null,
      });
      const access = mintAccessToken({
        deviceId,
        scopes: current.scopes,
        secret,
        now: at,
        ttlSeconds: accessTtlSeconds,
      });
      logger.info({ msg: 'device_paired', deviceId, source });
      return {
        device: publicDevice(record),
        accessToken: access.token,
        refreshToken: refresh.token,
        expiresIn: accessTtlSeconds,
        scopes: [...current.scopes],
      };
    },

    async refresh(input: { refreshToken: string }): Promise<TokenPair> {
      const at = clock();
      const currentHash = hashRefreshToken(input.refreshToken, secret);
      const record = store.devices.getByRefreshHash(currentHash);
      if (record === null) throw new AuthError('unauthorized', 401, { reason: 'unauthorized' });
      if (record.revokedAt !== null || Date.parse(record.refreshExpiresAt) <= at.getTime()) {
        if (record.revokedAt === null) store.devices.revoke(record.id, at.toISOString());
        throw new AuthError('unauthorized', 401, { reason: 'unauthorized' });
      }
      if (record.refreshTokenHash !== currentHash) {
        store.devices.revoke(record.id, at.toISOString());
        logger.warn({ msg: 'refresh_token_replay', deviceId: record.id });
        throw new AuthError('unauthorized', 401, { reason: 'unauthorized' });
      }
      const rotated = issueRefreshToken({ secret });
      store.devices.rotateRefresh(record.id, {
        refreshTokenHash: rotated.hash,
        refreshPreviousHash: record.refreshTokenHash,
        refreshExpiresAt: new Date(at.getTime() + refreshTtlMs).toISOString(),
      });
      const access = mintAccessToken({
        deviceId: record.id,
        scopes: record.scopes,
        secret,
        now: at,
        ttlSeconds: accessTtlSeconds,
      });
      return {
        accessToken: access.token,
        refreshToken: rotated.token,
        expiresIn: accessTtlSeconds,
        scopes: [...record.scopes],
      };
    },

    logout(deviceId: string): void {
      store.devices.revoke(deviceId, clock().toISOString());
    },

    authenticate(accessToken: string): AuthenticatedDevice | null {
      const at = clock();
      const claims = verifyAccessToken({ token: accessToken, secret, now: at });
      if (claims === null) return null;
      const record = store.devices.getRecord(claims.sub);
      if (record === null || record.revokedAt !== null) return null;
      store.devices.touch(record.id, at.toISOString());
      return { id: record.id, scopes: [...record.scopes] };
    },
  };
}
