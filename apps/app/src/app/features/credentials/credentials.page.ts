import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonToolbar } from '@ionic/angular';
import type { ApiError } from '../../core/api/api-client';
import { I18nService } from '../../core/i18n/i18n.service';
import { AddCredentialSheet } from './add-credential.sheet';
import { ConnectServiceSheet } from './connect-service.sheet';
import { CredentialsApi } from './credentials.api';
import type { CreateCredentialBody, CreateIntegrationBody, Credential } from './credentials.api';
import { CredentialsStore } from './credentials.store';
import { translate } from './i18n';

/**
 * Frame `16 · Settings / Credentials`: a back link with a two-line title, the two group headings,
 * the GitHub App card, one card per integration, one 52 px row per open credential, the filled
 * *add* row, the outlined *connect* row and the two write-only notes. The page only ever sees
 * `lastFour`; a value never reaches the DOM (D50).
 */
@Component({
  selector: 'app-credentials-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonToolbar, AddCredentialSheet, ConnectServiceSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CredentialsStore],
  styles: [
    `
      :host {
        --cb-cred-stroke: color-mix(in srgb, var(--cb-muted) 28%, transparent);
      }
      .cb-cred-toolbar {
        --background: var(--cb-bg);
        --border-width: 0;
        --min-height: 0;
        --padding-start: 0;
        --padding-end: 0;
        border-block-end: 1px solid var(--cb-cred-stroke);
      }
      .cb-cred-head {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 20px 24px 16px 18px;
        background: var(--cb-bg);
        font-family: var(--cb-font-sans);
      }
      .cb-cred-back {
        display: inline-grid;
        place-items: center;
        flex: none;
        inline-size: 44px;
        block-size: 44px;
        margin-block-start: -9px;
        margin-inline-start: -12px;
        margin-inline-end: -8px;
        color: var(--cb-accent);
        font-size: 22px;
        font-weight: 400;
        line-height: 27px;
        text-decoration: none;
      }
      .cb-cred-titles {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-inline-size: 0;
      }
      .cb-cred-title {
        margin: 0;
        color: var(--cb-text);
        font-size: 15px;
        font-weight: 600;
        line-height: 18px;
        overflow-wrap: anywhere;
      }
      .cb-cred-sub {
        margin: 0;
        color: var(--cb-muted);
        font-size: 10px;
        font-weight: 400;
        line-height: 12px;
        overflow-wrap: anywhere;
      }
      ion-content.cb-cred-content {
        --background: var(--cb-bg);
      }
      .cb-cred {
        display: flex;
        flex-direction: column;
        padding: 16px 24px 48px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font-family: var(--cb-font-sans);
        font-size: 12px;
        line-height: 15px;
      }
      .cb-cred-state {
        margin-block-end: 16px;
        padding: 12px;
        border: 1px dashed var(--cb-muted);
        border-radius: 10px;
        color: var(--cb-muted);
        font-size: 12px;
        line-height: 15px;
        overflow-wrap: anywhere;
      }
      .cb-cred-state p {
        margin: 0 0 4px;
      }
      .cb-cred-retry {
        min-block-size: 32px;
        padding-inline: 12px;
        border: 1px solid var(--cb-cred-stroke);
        border-radius: 8px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font: inherit;
        cursor: pointer;
      }
      .cb-cred-empty {
        margin: 0 0 16px;
        color: var(--cb-muted);
        font-size: 11px;
        line-height: 13px;
        overflow-wrap: anywhere;
      }
      .cb-cred-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-inline-size: 0;
      }
      .cb-cred-section + .cb-cred-section {
        margin-block-start: 16px;
      }
      .cb-cred-group {
        margin: 0;
        color: var(--cb-muted);
        font-size: 10px;
        font-weight: 500;
        line-height: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .cb-cred-services,
      .cb-cred-rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
        min-inline-size: 0;
      }
      .cb-cred-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-inline-size: 0;
        padding: 11px 16px 12px;
        border: 1px solid var(--cb-cred-stroke);
        border-radius: 12px;
        background: var(--cb-surface);
      }
      .cb-cred-gh {
        min-block-size: 78px;
      }
      .cb-cred-service {
        min-block-size: 64px;
      }
      .cb-cred-card-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        min-inline-size: 0;
      }
      .cb-cred-gh-name {
        min-inline-size: 0;
        color: var(--cb-text);
        font-size: 14px;
        font-weight: 600;
        line-height: 17px;
        overflow-wrap: anywhere;
      }
      .cb-cred-service-name {
        min-inline-size: 0;
        color: var(--cb-text);
        font-size: 13px;
        font-weight: 600;
        line-height: 16px;
        overflow-wrap: anywhere;
      }
      .cb-cred-gh-manage {
        flex: none;
        inline-size: 88px;
        block-size: 26px;
        padding: 0;
        border: 1px solid var(--cb-cred-stroke);
        border-radius: 8px;
        background: var(--cb-bg);
        color: var(--cb-muted);
        font-family: var(--cb-font-sans);
        font-size: 9px;
        font-weight: 400;
        line-height: 11px;
        cursor: pointer;
      }
      .cb-cred-gh-state {
        display: flex;
        align-items: center;
        gap: 5px;
        margin: 0;
        color: var(--cb-accent);
        font-size: 10px;
        font-weight: 400;
        line-height: 12px;
      }
      .cb-cred-gh-state[data-configured='false'] {
        color: var(--cb-muted);
      }
      .cb-cred-gh-dot {
        inline-size: 5px;
        block-size: 5px;
        border-radius: 50%;
        background: currentColor;
      }
      .cb-cred-gh-how,
      .cb-cred-service-how {
        margin: 0;
        color: var(--cb-muted);
        font-size: 9px;
        font-weight: 400;
        line-height: 11px;
        overflow-wrap: anywhere;
      }
      .cb-cred-gh-how {
        margin-block-start: 4px;
      }
      .cb-cred-service-how {
        font-size: 10px;
        line-height: 12px;
      }
      .cb-cred-mono {
        font-family: var(--cb-font-mono);
        overflow-wrap: anywhere;
      }
      .cb-cred-chip {
        display: inline-flex;
        align-items: center;
        flex: none;
        block-size: 18px;
        padding-inline: 8px;
        border: 1px solid var(--cb-cred-stroke);
        border-radius: 9px;
        background: var(--cb-bg);
        color: var(--cb-accent);
        font-size: 9px;
        font-weight: 400;
        line-height: 11px;
        white-space: nowrap;
      }
      .cb-cred-chip[data-expose='env'] {
        border-color: color-mix(in srgb, var(--cb-warn) 45%, transparent);
        color: var(--cb-warn);
      }
      .cb-cred-row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: 4px 8px;
        min-block-size: 52px;
        min-inline-size: 0;
        padding: 9px 16px;
        border: 1px solid var(--cb-cred-stroke);
        border-radius: 10px;
        background: var(--cb-surface);
      }
      .cb-cred-row-body {
        display: flex;
        flex: 1 1 90px;
        flex-direction: column;
        gap: 2px;
        min-inline-size: 0;
      }
      .cb-cred-open-name {
        color: var(--cb-text);
        font-size: 12px;
        font-weight: 500;
        line-height: 15px;
        overflow-wrap: anywhere;
      }
      .cb-cred-meta {
        margin: 0;
        color: var(--cb-muted);
        font-size: 9px;
        font-weight: 400;
        line-height: 11px;
        overflow-wrap: anywhere;
      }
      .cb-cred-row-side {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        min-inline-size: 0;
      }
      .cb-cred-delete,
      .cb-cred-delete-confirm,
      .cb-cred-delete-cancel {
        min-block-size: 32px;
        padding-inline: 6px;
        border: 0;
        background: none;
        font-family: var(--cb-font-sans);
        font-size: 9px;
        font-weight: 400;
        line-height: 11px;
        cursor: pointer;
      }
      .cb-cred-delete,
      .cb-cred-delete-confirm {
        color: var(--cb-danger);
      }
      .cb-cred-delete-cancel {
        color: var(--cb-muted);
      }
      .cb-cred-confirm {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        min-inline-size: 0;
      }
      .cb-cred-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-block-start: 16px;
      }
      .cb-cred-action {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        inline-size: 100%;
        block-size: 44px;
        padding: 0 16px;
        border: 1px solid var(--cb-cred-stroke);
        border-radius: 10px;
        background: var(--cb-bg);
        color: var(--cb-muted);
        font-family: var(--cb-font-sans);
        font-size: 12px;
        font-weight: 400;
        line-height: 15px;
        text-align: start;
        cursor: pointer;
      }
      .cb-cred-action-primary {
        border-color: color-mix(in srgb, var(--cb-accent) 45%, transparent);
        color: var(--cb-accent);
        font-weight: 600;
      }
      .cb-cred-notes {
        display: flex;
        flex-direction: column;
        margin-block-start: 20px;
      }
      .cb-cred-note {
        margin: 0;
        color: var(--cb-muted);
        font-size: 9px;
        font-weight: 400;
        line-height: 14px;
        overflow-wrap: anywhere;
      }
    `,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar class="cb-cred-toolbar">
        <div class="cb-cred-head">
          <a
            class="cb-cred-back"
            data-testid="credentials-back"
            routerLink="/settings"
            [attr.aria-label]="t('credentials.action.back')"
            >‹</a
          >
          <div class="cb-cred-titles">
            <h1 class="cb-cred-title">{{ t('credentials.title') }}</h1>
            <p
              class="cb-cred-sub"
              data-testid="credentials-sub"
              [attr.data-count]="store.credentials().length + store.integrations().length"
            >
              {{ t('credentials.sub') }}
            </p>
          </div>
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content class="cb-cred-content">
      <div class="cb-cred" data-testid="page-credentials">
        @if (store.loading()) {
          <div class="cb-cred-state" data-testid="credentials-loading">
            {{ t('credentials.loading') }}
          </div>
        }

        @if (failure(); as error) {
          <div class="cb-cred-state" data-testid="credentials-error" [attr.data-code]="error.code">
            <p>{{ t('credentials.error') }}</p>
            <p class="cb-cred-mono">{{ error.code }}</p>
            <button
              type="button"
              class="cb-cred-retry"
              data-testid="credentials-retry"
              (click)="retry()"
            >
              {{ t('credentials.retry') }}
            </button>
          </div>
        }

        @if (isEmpty()) {
          <p class="cb-cred-empty" data-testid="credentials-empty">{{ t('credentials.empty') }}</p>
        }

        <section class="cb-cred-section" data-testid="credentials-section-services">
          <h2 class="cb-cred-group" data-testid="credentials-group" data-group="services">
            {{ t('credentials.group.services') }}
          </h2>
          <ul class="cb-cred-services" data-testid="credentials-services">
            @if (githubApp(); as gh) {
              <li
                class="cb-cred-card cb-cred-gh"
                data-testid="credentials-gh"
                [attr.data-credential-id]="gh.id"
              >
                <div class="cb-cred-card-top">
                  <span class="cb-cred-gh-name" data-testid="credentials-gh-name">{{
                    gh.name
                  }}</span>
                  <button
                    type="button"
                    class="cb-cred-gh-manage"
                    data-testid="credentials-gh-manage"
                    (click)="connecting.set(true)"
                  >
                    {{ t('credentials.gh.manage') }}
                  </button>
                </div>
                <p
                  class="cb-cred-gh-state"
                  data-testid="credentials-gh-state"
                  [attr.data-configured]="gh.configured"
                >
                  <span
                    class="cb-cred-gh-dot"
                    data-testid="credentials-gh-dot"
                    aria-hidden="true"
                  ></span>
                  {{ gh.configured ? t('credentials.gh.configured') : t('credentials.gh.missing') }}
                </p>
                <p class="cb-cred-gh-how" data-testid="credentials-gh-how">
                  {{ t('credentials.gh.how') }}
                </p>
              </li>
            }
            @for (service of store.services(); track service.id) {
              <li
                class="cb-cred-card cb-cred-service"
                data-testid="credentials-service-row"
                [attr.data-service-id]="service.id"
              >
                <div class="cb-cred-card-top">
                  <span class="cb-cred-service-name">{{ service.name }}</span>
                  <span class="cb-cred-chip" data-testid="credentials-service-auth">{{
                    service.auth
                  }}</span>
                </div>
                <p class="cb-cred-service-how" data-testid="credentials-service-how">
                  {{ t('credentials.service.how') }} ·
                  <span class="cb-cred-mono">{{ service.baseUrl }}</span>
                </p>
              </li>
            }
          </ul>
        </section>

        <section class="cb-cred-section" data-testid="credentials-section-open">
          <h2 class="cb-cred-group" data-testid="credentials-group" data-group="open">
            {{ t('credentials.group.open') }}
          </h2>
          <ul class="cb-cred-rows">
            @for (credential of store.openCredentials(); track credential.id) {
              <li
                class="cb-cred-row"
                data-testid="credentials-open-row"
                [attr.data-credential-id]="credential.id"
              >
                <div class="cb-cred-row-body">
                  <span class="cb-cred-open-name">{{ credential.name }}</span>
                  <p class="cb-cred-meta" data-testid="credentials-open-meta">
                    <span data-testid="credentials-last-four">{{
                      masked(credential.lastFour)
                    }}</span>
                    · {{ credential.expose }}
                  </p>
                </div>
                <div class="cb-cred-row-side">
                  <span class="cb-cred-chip" data-testid="credentials-open-kind">{{
                    credential.kind
                  }}</span>
                  <span
                    class="cb-cred-chip"
                    data-testid="credentials-open-expose"
                    [attr.data-expose]="credential.expose"
                    >{{ credential.expose }}</span
                  >
                  @if (confirming() === credential.id) {
                    <div class="cb-cred-confirm" data-testid="credential-delete-confirm-block">
                      <button
                        type="button"
                        class="cb-cred-delete-confirm"
                        data-testid="credential-delete-confirm"
                        [disabled]="store.saving()"
                        (click)="remove(credential.id)"
                      >
                        {{ t('credentials.deleteConfirm') }}
                      </button>
                      <button
                        type="button"
                        class="cb-cred-delete-cancel"
                        data-testid="credential-delete-cancel"
                        (click)="cancelDelete()"
                      >
                        {{ t('credentials.action.cancel') }}
                      </button>
                    </div>
                  } @else {
                    <button
                      type="button"
                      class="cb-cred-delete"
                      data-testid="credential-delete"
                      (click)="askDelete(credential.id)"
                    >
                      {{ t('credentials.action.delete') }}
                    </button>
                  }
                </div>
              </li>
            }
          </ul>
        </section>

        <div class="cb-cred-actions">
          <button
            type="button"
            class="cb-cred-action cb-cred-action-primary"
            data-testid="credentials-add-open"
            (click)="adding.set(true)"
          >
            {{ t('credentials.action.addOpen') }}
          </button>
          <button
            type="button"
            class="cb-cred-action"
            data-testid="credentials-connect-service"
            (click)="connecting.set(true)"
          >
            {{ t('credentials.action.connectService') }}
          </button>
        </div>

        <div class="cb-cred-notes">
          <p class="cb-cred-note" data-testid="credentials-note" data-note="1">
            {{ t('credentials.writeOnly') }}
          </p>
          <p class="cb-cred-note" data-testid="credentials-note" data-note="2">
            {{ t('credentials.writeOnly.rotate') }}
          </p>
        </div>

        @if (connecting()) {
          <app-connect-service-sheet
            [credentials]="store.credentials()"
            [saving]="store.saving()"
            (created)="createService($event)"
            (closed)="connecting.set(false)"
          />
        }

        @if (adding()) {
          <app-add-credential-sheet
            [saving]="store.saving()"
            (saved)="saveCredential($event)"
            (closed)="adding.set(false)"
          />
        }
      </div>
    </ion-content>
  `,
})
export class CredentialsPage {
  readonly store = inject(CredentialsStore);
  readonly connecting = signal(false);
  readonly adding = signal(false);
  readonly confirming = signal<string | null>(null);
  readonly completionError = signal<ApiError | null>(null);
  readonly failure = computed(() => this.completionError() ?? this.store.error());
  readonly isEmpty = computed(
    () =>
      !this.store.loading() &&
      this.store.credentials().length === 0 &&
      this.store.integrations().length === 0,
  );
  readonly githubApp: Signal<Credential | null> = computed(
    () => this.store.credentials().find((credential) => credential.kind === 'github_app') ?? null,
  );

  private readonly api = inject(CredentialsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private readonly i18n = inject(I18nService);

  readonly locale = this.i18n.locale;
  readonly t = (key: string): string => translate(this.locale(), key);

  private completedPair: string | null = null;

  constructor() {
    this.store.load();
    this.completeManifestFromQuery();
  }

  masked(lastFour: string): string {
    return `••••${lastFour.slice(-4)}`;
  }

  askDelete(id: string): void {
    this.confirming.set(id);
  }

  cancelDelete(): void {
    this.confirming.set(null);
  }

  remove(id: string): void {
    this.confirming.set(null);
    this.store.removeCredential(id);
  }

  saveCredential(body: CreateCredentialBody): void {
    this.adding.set(false);
    this.store.createCredential(body);
  }

  createService(body: CreateIntegrationBody): void {
    this.connecting.set(false);
    this.store.createIntegration(body);
  }

  retry(): void {
    this.completionError.set(null);
    this.store.load();
  }

  private completeManifestFromQuery(): void {
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    const state = params.get('state');
    if (code === null || code === '' || state === null || state === '') return;
    const pair = `${code}:${state}`;
    if (this.completedPair === pair) return;
    this.completedPair = pair;
    this.api
      .completeGithubManifest(code, state)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => this.store.load(),
        error: (failure: ApiError) => this.completionError.set(failure),
      });
  }
}
