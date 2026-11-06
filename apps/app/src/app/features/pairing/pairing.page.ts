import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { IonContent } from '@ionic/angular';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL } from '../../core/api/http';
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
  imports: [IonContent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      ion-content {
        --background: var(--cb-bg);
      }
      /* The frame "01 · Pairing — mobile dark" is 390 × 844 with a 24 px page margin; the
         regions sit at their drawn offsets, so the masthead starts 112 px down. */
      .cb-pair {
        display: flex;
        flex-direction: column;
        padding: 112px 24px 48px;
        font-family: var(--cb-font-sans);
        color: var(--cb-text);
      }
      .cb-pair-masthead {
        display: flex;
        flex-direction: column;
      }
      .cb-pair-wordmark {
        margin: 0;
        align-self: flex-start;
        font-size: 30px;
        font-weight: 600;
        line-height: 36px;
        color: var(--cb-text);
      }
      .cb-pair-tagline {
        margin: 4px 0 0;
        align-self: flex-start;
        font-size: 13px;
        font-weight: 400;
        line-height: 16px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      /* The drawn card is 342 × 404 with a 16 px radius and a 20 px inset: the 1 px stroke sits
         inside the 19 px padding, so the fields start 20 px from the card's edge. */
      .cb-pair-card {
        margin-block-start: 32px;
        min-block-size: 404px;
        padding: 19px;
        border: 1px solid var(--cb-surface);
        border-radius: 16px;
        background: var(--cb-bg);
      }
      .cb-pair-form {
        display: flex;
        flex-direction: column;
        margin: 0;
      }
      .cb-pair-eyebrow {
        margin: 0;
        align-self: flex-start;
        font-size: 11px;
        font-weight: 500;
        line-height: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      /* The frame draws no code label; the control keeps a named label off-canvas. */
      .cb-pair-sr {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .cb-pair-input {
        inline-size: 100%;
        min-inline-size: 0;
        block-size: 48px;
        padding: 0 16px;
        border: 1px solid var(--cb-surface);
        border-radius: 8px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font-family: var(--cb-font-sans);
        font-size: 14px;
        line-height: 17px;
      }
      .cb-pair-input-code {
        margin-block-start: 13px;
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.18em;
      }
      .cb-pair-label {
        display: block;
        align-self: flex-start;
        margin: 12px 0 0;
        font-size: 11px;
        font-weight: 500;
        line-height: 13px;
        color: var(--cb-muted);
      }
      .cb-pair-label + .cb-pair-input {
        margin-block-start: 8px;
      }
      .cb-pair-hint {
        margin: 8px 0 0;
        align-self: flex-start;
        font-size: 11px;
        line-height: 13px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-pair-server {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-block-start: 12px;
      }
      .cb-pair-server-label {
        align-self: flex-start;
        font-size: 11px;
        font-weight: 500;
        line-height: 13px;
        color: var(--cb-muted);
      }
      .cb-pair-server-value {
        align-self: flex-start;
        font-size: 12px;
        line-height: 15px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-pair-error {
        margin: 12px 0 0;
        font-size: 12px;
        line-height: 15px;
        color: var(--cb-danger);
        overflow-wrap: anywhere;
      }
      .cb-pair-cta {
        margin-block-start: 20px;
        block-size: 48px;
        inline-size: 100%;
        border: 0;
        border-radius: 10px;
        background: var(--cb-surface);
        color: var(--cb-text);
        font-family: var(--cb-font-sans);
        font-size: 14px;
        font-weight: 600;
        line-height: 17px;
        cursor: pointer;
      }
      .cb-pair-cta:disabled {
        cursor: progress;
        opacity: 0.6;
      }
    `,
  ],
  template: `
    <ion-content>
      <div class="cb-pair" data-testid="page-pair">
        <header class="cb-pair-masthead" data-testid="pair-masthead">
          <h1 class="cb-pair-wordmark" data-testid="pair-wordmark">Codebox</h1>
          <p class="cb-pair-tagline" data-testid="pair-tagline">{{ t('pair.tagline') }}</p>
        </header>

        <div class="cb-pair-card" data-testid="pair-card">
          <form class="cb-pair-form" data-testid="pair-form" (submit)="submit($event)">
            <p class="cb-pair-eyebrow" data-testid="pair-eyebrow">{{ t('pair.eyebrow') }}</p>

            <label class="cb-pair-sr" for="pair-code">{{ t('pair.code') }}</label>
            <input
              id="pair-code"
              class="cb-pair-input cb-pair-input-code"
              data-testid="pair-code"
              type="text"
              autocomplete="one-time-code"
              autocapitalize="characters"
              spellcheck="false"
              inputmode="text"
              [value]="code()"
              (input)="setCode(valueOf($event))"
            />
            <p class="cb-pair-hint" data-testid="pair-code-hint">{{ t('pair.code.hint') }}</p>

            <label class="cb-pair-label" for="pair-device-name">{{ t('pair.deviceName') }}</label>
            <input
              id="pair-device-name"
              class="cb-pair-input"
              data-testid="pair-device-name"
              type="text"
              autocomplete="off"
              [value]="deviceName()"
              (input)="setDeviceName(valueOf($event))"
            />
            <p class="cb-pair-hint" data-testid="pair-device-hint">
              {{ t('pair.deviceName.hint') }}
            </p>

            <div class="cb-pair-server" data-testid="pair-server">
              <span class="cb-pair-server-label">{{ t('pair.server') }}</span>
              <span class="cb-pair-server-value" data-testid="pair-server-value">{{ server }}</span>
            </div>

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

            <button
              class="cb-pair-cta"
              type="submit"
              data-testid="pair-submit"
              [disabled]="submitting()"
            >
              {{ submitting() ? t('pair.submitting') : t('pair.submit') }}
            </button>
          </form>
        </div>
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

  readonly server: string = API_BASE_URL === '' ? location.origin : API_BASE_URL;

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
