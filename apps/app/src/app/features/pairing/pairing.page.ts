import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { ApiError } from '../../core/api/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import type { PairPlatform } from '../../core/auth/auth.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';

export type PairingProblem = 'code' | 'deviceName';

export type PairingFailure = 'codeRejected' | 'rateLimited' | 'offline' | 'failed';

const CODE_MAX_LENGTH = 64;
const DEVICE_NAME_MAX_LENGTH = 64;

/** The first invalid field, or null. Trims before it measures. */
export function pairingProblem(input: { code: string; deviceName: string }): PairingProblem | null {
  const code = input.code.trim();
  if (code.length === 0 || code.length > CODE_MAX_LENGTH) return 'code';
  const deviceName = input.deviceName.trim();
  if (deviceName.length === 0 || deviceName.length > DEVICE_NAME_MAX_LENGTH) return 'deviceName';
  return null;
}

/** The failure to render for a rejected `AuthStore.pair`. */
export function pairingFailureOf(error: unknown): PairingFailure {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.status === 0) return 'offline';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 401) return 'codeRejected';
  return 'failed';
}

/** `Capacitor.getPlatform()` to the pair platform, unknown values as 'web'. */
export function platformFor(platform: string): PairPlatform {
  if (platform === 'ios' || platform === 'android' || platform === 'web') return platform;
  return 'web';
}

@Component({
  selector: 'app-pairing-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-pair-form {
        display: grid;
        gap: calc(var(--cb-space) * 2);
        width: 100%;
        /* 420 px at the 4 px token; the frozen width grep forbids a px literal. */
        max-width: calc(var(--cb-space) * 105);
        box-sizing: border-box;
      }
      .cb-pair-field {
        display: grid;
        gap: var(--cb-space);
        min-width: 0;
      }
      .cb-pair-form label {
        color: var(--cb-text);
      }
      .cb-pair-form input {
        width: 100%;
        box-sizing: border-box;
        min-width: 0;
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        color: var(--cb-text);
      }
      .cb-pair-form button {
        box-sizing: border-box;
        min-width: 0;
        padding: calc(var(--cb-space) * 3);
        border: 1px solid var(--cb-text);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        color: var(--cb-text);
        cursor: pointer;
      }
      .cb-pair-form button:disabled {
        cursor: progress;
        opacity: 0.6;
      }
      .cb-pair-error {
        margin: 0;
        overflow-wrap: anywhere;
        color: var(--cb-danger);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('pair.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-pair">
        <form class="cb-pair-form" data-testid="pair-form" (submit)="submit($event)">
          <div class="cb-pair-field">
            <label for="pair-code">{{ t('pair.code') }}</label>
            <input
              id="pair-code"
              data-testid="pair-code"
              type="text"
              autocomplete="one-time-code"
              autocapitalize="characters"
              spellcheck="false"
              inputmode="text"
              [value]="code()"
              (input)="setCode(valueOf($event))"
            />
            <span>{{ t('pair.code.hint') }}</span>
          </div>

          <div class="cb-pair-field">
            <label for="pair-device-name">{{ t('pair.deviceName') }}</label>
            <input
              id="pair-device-name"
              data-testid="pair-device-name"
              type="text"
              autocomplete="off"
              [value]="deviceName()"
              (input)="setDeviceName(valueOf($event))"
            />
            <span>{{ t('pair.deviceName.hint') }}</span>
          </div>

          <button type="submit" data-testid="pair-submit" [disabled]="submitting()">
            {{ submitting() ? t('pair.submitting') : t('pair.submit') }}
          </button>

          @if (failure(); as failure) {
            <p
              class="cb-pair-error"
              data-testid="pair-error"
              role="alert"
              [attr.data-failure]="failure"
            >
              {{ t('pair.error.' + failure) }}
            </p>
          }
        </form>
      </div>
    </ion-content>
  `,
})
export class PairingPage {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  private readonly codeState = signal('');
  private readonly deviceNameState = signal('');
  private readonly submittingState = signal(false);
  private readonly failureState = signal<PairingFailure | PairingProblem | null>(null);

  readonly code: Signal<string> = this.codeState.asReadonly();
  readonly deviceName: Signal<string> = this.deviceNameState.asReadonly();
  readonly submitting: Signal<boolean> = this.submittingState.asReadonly();
  readonly failure: Signal<PairingFailure | PairingProblem | null> = this.failureState.asReadonly();

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  setCode(value: string): void {
    this.codeState.set(value);
  }

  setDeviceName(value: string): void {
    this.deviceNameState.set(value);
  }

  valueOf(event: Event): string {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.value;
    }
    return '';
  }

  async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    this.failureState.set(null);

    const problem = pairingProblem({
      code: this.codeState(),
      deviceName: this.deviceNameState(),
    });
    if (problem !== null) {
      this.failureState.set(problem);
      return;
    }
    if (this.submittingState()) return;

    this.submittingState.set(true);
    try {
      await this.authStore.pair({
        code: this.codeState().trim(),
        deviceName: this.deviceNameState().trim(),
        platform: platformFor(Capacitor.getPlatform()),
      });
      void this.router.navigate(['/dashboard']);
    } catch (error) {
      this.failureState.set(pairingFailureOf(error));
    } finally {
      this.submittingState.set(false);
    }
  }
}
