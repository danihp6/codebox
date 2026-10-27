import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { I18nService } from '../../core/i18n/i18n.service';
import type { ApiError } from '../../core/api/api-client';
import { CredentialsApi, INTEGRATION_AUTHS } from './credentials.api';
import type {
  CreateIntegrationBody,
  Credential,
  GithubManifestStart,
  IntegrationAuth,
} from './credentials.api';
import { translate } from './i18n';

type Mode = 'menu' | 'github' | 'integration';

const NAME_MAX_LENGTH = 120;

@Component({
  selector: 'app-connect-service-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-sheet {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
      }
      .cb-sheet-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
      }
      .cb-sheet-field {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
      }
      .cb-sheet-error {
        border-inline-start: 3px solid var(--cb-danger);
        margin: 0;
        padding-inline-start: calc(var(--cb-space) * 2);
      }
    `,
  ],
  template: `
    <section class="cb-sheet" data-testid="connect-service-sheet">
      @if (mode() === 'menu') {
        <h2>{{ t('connect.title') }}</h2>
        <button type="button" data-testid="service-github" (click)="startGithub()">
          {{ t('connect.github') }}
        </button>
        <button type="button" data-testid="service-integration" (click)="startIntegration()">
          {{ t('connect.integration') }}
        </button>
        <div class="cb-sheet-actions">
          <button type="button" data-testid="connect-service-cancel" (click)="close()">
            {{ t('connect.cancel') }}
          </button>
        </div>
      } @else if (mode() === 'github') {
        <h2>{{ t('connect.github') }}</h2>
        @if (start(); as manifestStart) {
          <p>{{ t('connect.manifestHint') }}</p>
          <form
            method="post"
            [attr.action]="manifestStart.action"
            data-testid="github-manifest-form"
          >
            <input type="hidden" name="manifest" [value]="manifestJson()" />
            <input type="hidden" name="state" [value]="manifestStart.state" />
            <button type="submit">{{ t('connect.manifestSubmit') }}</button>
          </form>
        }
        <div class="cb-sheet-actions">
          <button type="button" data-testid="connect-service-back" (click)="back()">
            {{ t('credentials.action.back') }}
          </button>
        </div>
      } @else {
        <h2>{{ t('connect.integration') }}</h2>
        <form data-testid="integration-form" (submit)="submitIntegration($event)">
          <label class="cb-sheet-field" for="integration-name">
            <span>{{ t('connect.name') }}</span>
            <input
              id="integration-name"
              data-testid="integration-name"
              type="text"
              autocomplete="off"
              [value]="name()"
              (input)="name.set(valueOf($event))"
            />
          </label>

          <label class="cb-sheet-field" for="integration-base-url">
            <span>{{ t('connect.baseUrl') }}</span>
            <input
              id="integration-base-url"
              data-testid="integration-base-url"
              type="url"
              autocomplete="off"
              [value]="baseUrl()"
              (input)="baseUrl.set(valueOf($event))"
            />
          </label>

          <label class="cb-sheet-field" for="integration-auth">
            <span>{{ t('connect.auth') }}</span>
            <select
              id="integration-auth"
              data-testid="integration-auth"
              (change)="setAuth(valueOf($event))"
            >
              @for (option of auths; track option) {
                <option [value]="option" [selected]="option === auth()">
                  {{ t('integration.auth.' + option) }}
                </option>
              }
            </select>
          </label>

          @if (auth() === 'header') {
            <label class="cb-sheet-field" for="integration-header">
              <span>{{ t('connect.headerName') }}</span>
              <input
                id="integration-header"
                data-testid="integration-header"
                type="text"
                autocomplete="off"
                [value]="headerName()"
                (input)="headerName.set(valueOf($event))"
              />
            </label>
          }

          <label class="cb-sheet-field" for="integration-credential">
            <span>{{ t('connect.credential') }}</span>
            <select
              id="integration-credential"
              data-testid="integration-credential"
              (change)="credentialId.set(valueOf($event))"
            >
              @for (credential of credentials(); track credential.id) {
                <option [value]="credential.id" [selected]="credential.id === credentialId()">
                  {{ credential.name }}
                </option>
              }
            </select>
          </label>

          <label class="cb-sheet-field" for="integration-hosts">
            <span>{{ t('connect.hosts') }}</span>
            <textarea
              id="integration-hosts"
              data-testid="integration-hosts"
              rows="3"
              [value]="hosts()"
              (input)="hosts.set(valueOf($event))"
            ></textarea>
          </label>

          @if (problem(); as message) {
            <p class="cb-sheet-error" data-testid="integration-problem">{{ message }}</p>
          }

          <div class="cb-sheet-actions">
            <button type="button" data-testid="connect-service-cancel" (click)="close()">
              {{ t('connect.cancel') }}
            </button>
            <button
              type="button"
              data-testid="integration-save"
              [disabled]="saving()"
              (click)="submitIntegration()"
            >
              {{ t('connect.save') }}
            </button>
          </div>
        </form>
      }

      @if (error(); as failure) {
        <p
          class="cb-sheet-error"
          data-testid="connect-service-error"
          [attr.data-code]="failure.code"
        >
          {{ t('connect.problem.github') }}
        </p>
      }
    </section>
  `,
})
export class ConnectServiceSheet {
  readonly credentials = input<readonly Credential[]>([]);
  readonly saving = input<boolean>(false);
  readonly created = output<CreateIntegrationBody>();
  readonly closed = output<void>();

  private readonly api = inject(CredentialsApi);
  private readonly destroy = inject(DestroyRef);
  private readonly i18n = inject(I18nService);

  readonly auths = INTEGRATION_AUTHS;
  readonly locale = this.i18n.locale;
  readonly t = (key: string): string => translate(this.locale(), key);

  readonly mode = signal<Mode>('menu');
  readonly start = signal<GithubManifestStart | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly problem = signal<string | null>(null);
  readonly name = signal('');
  readonly baseUrl = signal('');
  readonly auth = signal<IntegrationAuth>('none');
  readonly headerName = signal('');
  readonly credentialId = signal('');
  readonly hosts = signal('');

  readonly manifestJson = computed(() => JSON.stringify(this.start()?.manifest ?? {}));

  startGithub(): void {
    this.mode.set('github');
    this.start.set(null);
    this.error.set(null);
    this.api
      .startGithubManifest()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (start) => this.start.set(start),
        error: (failure: ApiError) => this.error.set(failure),
      });
  }

  startIntegration(): void {
    this.mode.set('integration');
    this.error.set(null);
    this.problem.set(null);
  }

  back(): void {
    this.mode.set('menu');
    this.start.set(null);
    this.error.set(null);
    this.problem.set(null);
  }

  setAuth(value: string): void {
    if ((INTEGRATION_AUTHS as readonly string[]).includes(value)) {
      this.auth.set(value as IntegrationAuth);
    }
  }

  valueOf(event: Event): string {
    return fieldValue(event);
  }

  submitIntegration(event?: Event): void {
    event?.preventDefault();
    if (this.mode() !== 'integration') return;
    const name = this.name().trim();
    const baseUrl = this.baseUrl().trim();
    const auth = this.auth();
    const headerName = this.headerName().trim();
    const credentialId = this.credentialId().trim();
    const allowedHosts = parseHosts(this.hosts());

    const problem = this.validationProblem({
      name,
      baseUrl,
      auth,
      headerName,
      credentialId,
      allowedHosts,
    });
    this.problem.set(problem);
    if (problem !== null) return;

    const body: CreateIntegrationBody = {
      name,
      baseUrl,
      auth,
      allowedHosts,
      ...(auth === 'header' ? { headerName } : {}),
      ...(auth === 'none' ? {} : { credentialId }),
    };
    this.created.emit(body);
  }

  close(): void {
    this.problem.set(null);
    this.mode.set('menu');
    this.closed.emit();
  }

  private validationProblem(input: {
    readonly name: string;
    readonly baseUrl: string;
    readonly auth: IntegrationAuth;
    readonly headerName: string;
    readonly credentialId: string;
    readonly allowedHosts: readonly string[];
  }): string | null {
    if (input.name.length === 0 || input.name.length > NAME_MAX_LENGTH) {
      return this.t('connect.problem.name');
    }
    if (input.baseUrl.length === 0) return this.t('connect.problem.baseUrl');
    if (input.allowedHosts.length === 0) return this.t('connect.problem.hosts');
    if (input.auth !== 'none' && input.credentialId.length === 0) {
      return this.t('connect.problem.credential');
    }
    if (input.auth === 'header' && input.headerName.length === 0) {
      return this.t('connect.problem.headerName');
    }
    return null;
  }
}

function parseHosts(input: string): readonly string[] {
  return input
    .split(/[\n,]+/)
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

function fieldValue(event: Event): string {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return target.value;
  }
  return '';
}
