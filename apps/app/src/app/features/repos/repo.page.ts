import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { REPO_POLICIES } from '@codebox/contracts';
import type { RepoPolicy } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';
import { splitProtectedPaths } from './repo-form';
import { RepoStore } from './repo.store';

@Component({
  selector: 'app-repo-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RepoStore],
  styles: [
    `
      .cb-repo-head {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
      }
      .cb-section {
        margin-block-start: calc(var(--cb-space) * 4);
      }
      .cb-section h2 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-policy-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
      }
      .cb-policy-actions button[data-active='true'] {
        border-color: var(--cb-accent);
        color: var(--cb-accent);
      }
      .cb-paths-editor {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        max-inline-size: 32rem;
      }
      .cb-paths-editor input,
      .cb-paths-editor textarea {
        font: inherit;
        color: inherit;
        background: var(--cb-surface);
        border: 1px solid var(--cb-muted);
        border-radius: calc(var(--cb-radius) / 2);
        padding: calc(var(--cb-space) * 2);
      }
      .cb-preview {
        margin: 0;
        padding: calc(var(--cb-space) * 2);
        background: var(--cb-surface);
        border-radius: calc(var(--cb-radius) / 2);
        overflow-x: auto;
      }
      .cb-repo-checks {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-repo-check {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
      }
      .cb-verify {
        margin-block-start: calc(var(--cb-space) * 4);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
      }
      .cb-verify[data-ok='true'] {
        border-color: var(--cb-accent);
      }
      .cb-verify[data-ok='false'] {
        border-color: var(--cb-danger);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('repos.detail.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-repo" [attr.data-repo-id]="store.repoId()">
        @if (store.loading()) {
          <div data-testid="repo-loading">{{ t('common.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="repo-error" [attr.data-code]="failure.code">
            <p>{{ t('common.error') }}</p>
            <button type="button" data-testid="repo-retry" (click)="reload()">
              {{ t('repos.action.retry') }}
            </button>
          </div>
        }

        @if (store.repo(); as repo) {
          <div class="cb-repo-head">
            <h1 class="cb-mono" data-testid="repo-slug-value">{{ repo.slug }}</h1>
            <span class="cb-mono" data-testid="repo-default-branch">{{ repo.defaultBranch }}</span>
            <span data-testid="repo-enabled" [attr.data-enabled]="repo.enabled">
              {{ repo.enabled ? t('repos.detail.enabled') : t('repos.detail.disabled') }}
            </span>
          </div>

          <section class="cb-section">
            <h2>{{ t('repos.detail.policy') }}</h2>
            <div class="cb-policy-actions">
              @for (policy of policies; track policy) {
                <button
                  type="button"
                  [attr.data-testid]="'repo-policy-' + policy"
                  [attr.data-active]="repo.policy === policy"
                  [disabled]="store.saving()"
                  (click)="store.setPolicy(policy)"
                >
                  {{ t('repos.policy.' + policy) }}
                </button>
              }
              <span data-testid="repo-policy-current" [attr.data-policy]="repo.policy">
                {{ t('repos.policy.' + repo.policy) }}
              </span>
            </div>
          </section>

          <section class="cb-section">
            <h2>{{ t('repos.detail.gate') }}</h2>
            <div class="cb-paths-editor">
              <input
                data-testid="repo-gate-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                [value]="gateDraft()"
                (input)="setGate($event)"
              />
              <button
                type="button"
                data-testid="repo-gate-save"
                [disabled]="store.saving()"
                (click)="store.saveGate(gateDraft())"
              >
                {{ t('repos.action.save') }}
              </button>
            </div>
          </section>

          <section class="cb-section">
            <h2>{{ t('repos.detail.protectedPaths') }}</h2>
            <div class="cb-paths-editor">
              <textarea
                data-testid="repo-protected-paths"
                rows="6"
                spellcheck="false"
                [value]="pathsDraft()"
                (input)="setPaths($event)"
              ></textarea>
              <button
                type="button"
                data-testid="repo-protected-paths-save"
                [disabled]="store.saving()"
                (click)="store.saveProtectedPaths(split(pathsDraft()))"
              >
                {{ t('repos.action.save') }}
              </button>
              <p>{{ t('repos.detail.preview') }}</p>
              <pre class="cb-preview cb-mono" data-testid="protected-paths-preview">{{ preview() }}</pre>
            </div>
          </section>

          <section class="cb-section">
            <h2>{{ t('repos.verify.title') }}</h2>
            <button type="button" data-testid="repo-verify-action" (click)="store.verify()">
              {{ t('repos.action.verify') }}
            </button>
            @if (store.verifyError(); as failure) {
              <div data-testid="repo-verify-error" [attr.data-code]="failure.code">
                {{ t('repos.verify.error') }}
              </div>
            }
            @if (store.verification(); as verification) {
              <div
                class="cb-verify"
                data-testid="repo-verify"
                [attr.data-ok]="verification.ok"
                [attr.data-can-push]="verification.canPush"
              >
                <p>{{ verification.ok ? t('repos.verify.ok') : t('repos.verify.ko') }}</p>
                <p>
                  {{ verification.canPush ? t('repos.verify.canPush') : t('repos.verify.noPush') }}
                </p>
                <p>
                  {{ t('repos.verify.defaultBranch') }}:
                  <span class="cb-mono">{{ verification.defaultBranch }}</span>
                </p>
                <ul class="cb-repo-checks">
                  @for (check of verification.checks; track check.name) {
                    <li
                      class="cb-repo-check"
                      data-testid="repo-check"
                      [attr.data-name]="check.name"
                      [attr.data-state]="check.state"
                    >
                      <span class="cb-mono">{{ check.name }}</span>
                      <span class="cb-mono">{{ check.state }}</span>
                    </li>
                  }
                </ul>
              </div>
            }
          </section>

          <section class="cb-section">
            <h2>{{ t('repos.detail.lastRun') }}</h2>
            @if (repo.lastRun; as run) {
              <a class="cb-mono" data-testid="repo-last-run" [routerLink]="['/runs', run.id]">
                {{ run.id }}
              </a>
            } @else {
              <p data-testid="repo-last-run-empty">{{ t('repos.detail.noRun') }}</p>
            }
          </section>
        }
      </div>
    </ion-content>
  `,
})
export class RepoPage {
  readonly id = input.required<string>();
  readonly store = inject(RepoStore);
  readonly policies: readonly RepoPolicy[] = REPO_POLICIES;
  readonly split = splitProtectedPaths;

  readonly gateDraft = signal('');
  readonly pathsDraft = signal('');
  readonly preview = computed<string>(() => JSON.stringify(splitProtectedPaths(this.pathsDraft())));

  private readonly i18n = inject(I18nService);
  private hydratedFor: string | null = null;

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    effect(() => {
      const repo = this.store.repo();
      if (repo === null) return;
      untracked(() => {
        if (this.hydratedFor === repo.id) return;
        this.hydratedFor = repo.id;
        this.gateDraft.set(repo.gate);
        this.pathsDraft.set(repo.protectedPaths.join('\n'));
      });
    });
    effect(() => {
      const candidate = this.id();
      untracked(() => this.store.load(candidate));
    });
  }

  reload(): void {
    this.store.load(this.id());
  }

  setGate(event: Event): void {
    this.gateDraft.set(fieldValue(event));
  }

  setPaths(event: Event): void {
    this.pathsDraft.set(fieldValue(event));
  }
}

function fieldValue(event: Event): string {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value;
  return '';
}
