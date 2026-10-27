import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { ApiError } from '../../core/api/api-client';
import { I18nService } from '../../core/i18n/i18n.service';
import { AddCredentialSheet } from './add-credential.sheet';
import { ConnectServiceSheet } from './connect-service.sheet';
import { CredentialsApi } from './credentials.api';
import type { CreateCredentialBody, CreateIntegrationBody } from './credentials.api';
import { CredentialsStore } from './credentials.store';
import { translate } from './i18n';

@Component({
  selector: 'app-credentials-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, AddCredentialSheet, ConnectServiceSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CredentialsStore],
  styles: [
    `
      .cb-credentials-section {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        margin-block-end: calc(var(--cb-space) * 4);
      }
      .cb-credentials-head {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        justify-content: space-between;
      }
      .cb-credentials-head h2 {
        margin: 0;
        font-size: 1.05rem;
      }
      .cb-credentials-list {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-credentials-row {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        border-block-end: 1px solid var(--cb-surface);
        padding-block: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
      }
      .cb-credentials-name {
        font-weight: 600;
      }
      .cb-chip {
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        padding-inline: var(--cb-space);
        font-size: 0.8rem;
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
      .cb-confirm {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        inline-size: 100%;
      }
      .cb-unavailable {
        border: 1px dashed var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('credentials.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-credentials">
        @if (store.loading()) {
          <div data-testid="credentials-loading">{{ t('credentials.loading') }}</div>
        }

        @if (failure(); as error) {
          <div class="cb-unavailable" data-testid="credentials-error" [attr.data-code]="error.code">
            <p>{{ t('credentials.error') }}</p>
            <p class="cb-mono cb-muted">{{ error.code }}</p>
            <button type="button" data-testid="credentials-retry" (click)="retry()">
              {{ t('credentials.retry') }}
            </button>
          </div>
        }

        <section class="cb-credentials-section" data-testid="credentials-section-services">
          <div class="cb-credentials-head">
            <h2>{{ t('credentials.section.services') }}</h2>
            <button
              type="button"
              data-testid="credentials-connect-service"
              (click)="connecting.set(true)"
            >
              {{ t('credentials.action.connectService') }}
            </button>
          </div>
          <ul class="cb-credentials-list">
            @for (service of store.services(); track service.id) {
              <li
                class="cb-credentials-row"
                data-testid="credentials-service-row"
                [attr.data-service-id]="service.id"
              >
                <span class="cb-credentials-name">{{ service.name }}</span>
                <span class="cb-chip" data-testid="credentials-service-auth">{{
                  service.auth
                }}</span>
                <span class="cb-mono cb-muted">{{ service.baseUrl }}</span>
              </li>
            }
          </ul>
        </section>

        <section class="cb-credentials-section" data-testid="credentials-section-open">
          <div class="cb-credentials-head">
            <h2>{{ t('credentials.section.open') }}</h2>
            <button type="button" data-testid="credentials-add-open" (click)="adding.set(true)">
              {{ t('credentials.action.addOpen') }}
            </button>
          </div>
          <ul class="cb-credentials-list">
            @for (credential of store.openCredentials(); track credential.id) {
              <li
                class="cb-credentials-row"
                data-testid="credentials-open-row"
                [attr.data-credential-id]="credential.id"
              >
                <span class="cb-credentials-name">{{ credential.name }}</span>
                <span class="cb-chip" data-testid="credentials-open-kind">{{
                  credential.kind
                }}</span>
                <span class="cb-chip" data-testid="credentials-open-expose">{{
                  credential.expose
                }}</span>
                <span class="cb-mono" data-testid="credentials-last-four">{{
                  masked(credential.lastFour)
                }}</span>

                @if (confirming() === credential.id) {
                  <div class="cb-confirm" data-testid="credential-delete-confirm-block">
                    <button
                      type="button"
                      data-testid="credential-delete-confirm"
                      [disabled]="store.saving()"
                      (click)="remove(credential.id)"
                    >
                      {{ t('credentials.deleteConfirm') }}
                    </button>
                    <button
                      type="button"
                      data-testid="credential-delete-cancel"
                      (click)="cancelDelete()"
                    >
                      {{ t('credentials.action.cancel') }}
                    </button>
                  </div>
                } @else {
                  <button
                    type="button"
                    data-testid="credential-delete"
                    (click)="askDelete(credential.id)"
                  >
                    {{ t('credentials.action.delete') }}
                  </button>
                }
              </li>
            }
          </ul>
        </section>

        @if (isEmpty()) {
          <p data-testid="credentials-empty">{{ t('credentials.empty') }}</p>
        }

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
