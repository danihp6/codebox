import { Injectable, computed, inject, signal } from '@angular/core';
import type { Device, Scope } from '@codebox/contracts';
import { firstValueFrom } from 'rxjs';
import { ApiClient, ApiError } from '../api/api-client';
import type { PairResult, TokenPair } from '../api/api-client';
import { generateDeviceKeyPair } from './pairing';
import type { DeviceKeyPair } from './pairing';
import { REFRESH_TOKEN_KEY, SECURE_STORE } from './secure-store';

export type PairPlatform = 'web' | 'ios' | 'android';

let deviceKeys: Promise<DeviceKeyPair> | null = null;

function keysForThisInstall(): Promise<DeviceKeyPair> {
  deviceKeys ??= generateDeviceKeyPair();
  return deviceKeys;
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(ApiClient);
  private readonly secure = inject(SECURE_STORE);

  private readonly scopesState = signal<readonly Scope[]>([]);
  private readonly deviceState = signal<Device | null>(null);
  private readonly accessTokenState = signal<string | null>(null);
  private refreshInFlight: Promise<boolean> | null = null;

  readonly scopes = this.scopesState.asReadonly();
  readonly device = this.deviceState.asReadonly();
  readonly signedIn = computed(() => this.accessTokenState() !== null);
  readonly accessToken = this.accessTokenState.asReadonly();

  async pair(input: {
    code: string;
    deviceName: string;
    platform: PairPlatform;
  }): Promise<void> {
    const keys = await keysForThisInstall();
    const result = await firstValueFrom(
      this.api.pair({
        code: input.code,
        deviceName: input.deviceName,
        platform: input.platform,
        devicePublicKey: keys.publicKeyJwk,
      }),
    );
    this.applyPair(result);
    await this.secure.set(REFRESH_TOKEN_KEY, result.refreshToken);
  }

  async restore(): Promise<boolean> {
    if (this.signedIn()) return true;
    const stored = await this.secure.get(REFRESH_TOKEN_KEY);
    if (stored === null) return false;
    try {
      return await this.refresh();
    } catch {
      return false;
    }
  }

  refresh(): Promise<boolean> {
    this.refreshInFlight ??= this.rotate().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  async logout(): Promise<void> {
    try {
      if (this.signedIn()) await firstValueFrom(this.api.logout());
    } catch {
      // Revocation is best effort: the local session is cleared either way.
    }
    this.accessTokenState.set(null);
    this.scopesState.set([]);
    this.deviceState.set(null);
    await this.secure.clear();
  }

  private async rotate(): Promise<boolean> {
    const stored = await this.secure.get(REFRESH_TOKEN_KEY);
    if (stored === null) return false;
    try {
      const tokens = await firstValueFrom(this.api.refresh(stored));
      this.applyTokens(tokens);
      await this.secure.set(REFRESH_TOKEN_KEY, tokens.refreshToken);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.accessTokenState.set(null);
        this.scopesState.set([]);
        this.deviceState.set(null);
        await this.secure.remove(REFRESH_TOKEN_KEY);
        return false;
      }
      throw error;
    }
  }

  private applyPair(result: PairResult): void {
    this.deviceState.set(result.device);
    this.scopesState.set(result.scopes);
    this.accessTokenState.set(result.accessToken);
  }

  private applyTokens(tokens: TokenPair): void {
    this.scopesState.set(tokens.scopes);
    this.accessTokenState.set(tokens.accessToken);
  }
}
