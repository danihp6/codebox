import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';
import { toCreateBody, validateRepoForm } from './repo-form';
import type { RepoFormProblem, RepoFormValues } from './repo-form';
import { ReposStore } from './repos.store';

@Component({
  selector: 'app-repos-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ReposStore],
  styles: [
    `
      .cb-repo-list,
      .cb-repo-checks {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-repo-row,
      .cb-repo-check {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        border-block-end: 1px solid var(--cb-surface);
        padding-block: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
      }
      .cb-repo-form {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        max-inline-size: 32rem;
      }
      .cb-repo-form label {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
      }
      .cb-repo-form input,
      .cb-repo-form textarea {
        font: inherit;
        color: inherit;
        background: var(--cb-surface);
        border: 1px solid var(--cb-muted);
        border-radius: calc(var(--cb-radius) / 2);
        padding: calc(var(--cb-space) * 2);
      }
      .cb-field-error {
        color: var(--cb-danger);
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
      .cb-verify h2,
      .cb-section h2 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('repos.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-repos">
        @if (store.loading()) {
          <div data-testid="repos-loading">{{ t('common.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="repos-error" [attr.data-code]="failure.code">
            <p>{{ t('common.error') }}</p>
            <button type="button" data-testid="repos-retry" (click)="store.load()">
              {{ t('repos.action.retry') }}
            </button>
          </div>
        }

        <section class="cb-section">
          <h2>{{ t('repos.section.list') }}</h2>
          @if (store.repos().length === 0) {
            @if (!store.loading()) {
              <p data-testid="repos-empty">{{ t('repos.empty') }}</p>
            }
          } @else {
            <ul class="cb-repo-list">
              @for (repo of store.repos(); track repo.id) {
                <li class="cb-repo-row" data-testid="repo-row" [attr.data-repo-id]="repo.id">
                  <a class="cb-mono" [routerLink]="['/repos', repo.id]" [attr.data-testid]="'repo-link-' + repo.id">
                    {{ repo.slug }}
                  </a>
                  <span class="cb-mono">{{ repo.defaultBranch }}</span>
                  <span>{{ t('repos.policy.' + repo.policy) }}</span>
                  <button
                    type="button"
                    [attr.data-testid]="'repo-row-verify-' + repo.id"
                    [disabled]="store.verifyFor() === repo.id"
                    (click)="store.verify(repo.id)"
                  >
                    {{ t('repos.action.verify') }}
                  </button>
                </li>
              }
            </ul>
          }
        </section>

        <section class="cb-section">
          <h2>{{ t('repos.section.add') }}</h2>
          <form class="cb-repo-form" (submit)="submit($event)">
            <label>
              <span>{{ t('repos.field.slug') }}</span>
              <input
                data-testid="repo-slug"
                type="text"
                autocomplete="off"
                spellcheck="false"
                [value]="slug()"
                (input)="setSlug($event)"
              />
            </label>
            @if (hasProblem('slug')) {
              <p class="cb-field-error" data-testid="repo-slug-error">{{ t('repos.error.slug') }}</p>
            }

            <label>
              <span>{{ t('repos.field.defaultBranch') }}</span>
              <input
                data-testid="repo-default-branch"
                type="text"
                autocomplete="off"
                spellcheck="false"
                [value]="defaultBranch()"
                (input)="setDefaultBranch($event)"
              />
            </label>
            @if (hasProblem('defaultBranch')) {
              <p class="cb-field-error" data-testid="repo-default-branch-error">
                {{ t('repos.error.defaultBranch') }}
              </p>
            }

            <label>
              <span>{{ t('repos.field.gate') }}</span>
              <input
                data-testid="repo-gate"
                type="text"
                autocomplete="off"
                spellcheck="false"
                [value]="gate()"
                (input)="setGate($event)"
              />
            </label>
            @if (hasProblem('gate')) {
              <p class="cb-field-error" data-testid="repo-gate-error">{{ t('repos.error.gate') }}</p>
            }

            <label>
              <span>{{ t('repos.field.protectedPaths') }}</span>
              <textarea
                data-testid="repo-protected-paths"
                rows="4"
                spellcheck="false"
                [value]="protectedPaths()"
                (input)="setProtectedPaths($event)"
              ></textarea>
            </label>

            <button type="submit" data-testid="repo-submit" [disabled]="store.creating()">
              {{ t('repos.action.create') }}
            </button>
          </form>
        </section>

        @if (store.verifyError(); as failure) {
          <div class="cb-verify" data-testid="repo-verify-error" [attr.data-code]="failure.code">
            {{ t('repos.verify.error') }}
          </div>
        }

        @if (store.verification(); as verification) {
          <section
            class="cb-verify"
            data-testid="repo-verify"
            [attr.data-ok]="verification.ok"
            [attr.data-can-push]="verification.canPush"
          >
            <h2>{{ t('repos.verify.title') }}</h2>
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
          </section>
        }
      </div>
    </ion-content>
  `,
})
export class ReposPage {
  readonly store = inject(ReposStore);

  readonly slug = signal('');
  readonly defaultBranch = signal('main');
  readonly gate = signal('npm ci && npm test && npm run build');
  readonly protectedPaths = signal('');
  readonly problems = signal<readonly RepoFormProblem[]>([]);

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  readonly hasProblem = (problem: RepoFormProblem): boolean => this.problems().includes(problem);

  constructor() {
    this.store.load();
  }

  submit(event: Event): void {
    event.preventDefault();
    const values: RepoFormValues = {
      slug: this.slug(),
      defaultBranch: this.defaultBranch(),
      gate: this.gate(),
      protectedPaths: this.protectedPaths(),
    };
    const problems = validateRepoForm(values);
    this.problems.set(problems);
    if (problems.length > 0) return;
    this.store.create(toCreateBody(values));
    this.slug.set('');
    this.protectedPaths.set('');
  }

  setSlug(event: Event): void {
    this.slug.set(fieldValue(event));
  }

  setDefaultBranch(event: Event): void {
    this.defaultBranch.set(fieldValue(event));
  }

  setGate(event: Event): void {
    this.gate.set(fieldValue(event));
  }

  setProtectedPaths(event: Event): void {
    this.protectedPaths.set(fieldValue(event));
  }
}

function fieldValue(event: Event): string {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value;
  return '';
}
