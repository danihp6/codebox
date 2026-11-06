import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import type { Repo } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';
import { toCreateBody, validateRepoForm } from './repo-form';
import type { RepoFormProblem, RepoFormValues } from './repo-form';
import { ReposStore } from './repos.store';

/** Seven bars: the loading state frame's shape (`design/README.md` §2). */
const SKELETON_BARS: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

@Component({
  selector: 'app-repos-page',
  standalone: true,
  imports: [RouterLink, IonContent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ReposStore],
  styles: [
    `
      .cb-repos {
        --repos-stroke: color-mix(in srgb, var(--cb-muted) 32%, transparent);
        display: flex;
        flex-direction: column;
        /* The frame's title sits under an OS status bar; the page starts there and lets the inset add to it. */
        padding-block-start: max(52px, calc(env(safe-area-inset-top, 0px) + 20px));
        padding-block-end: 88px;
        padding-inline: 24px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font-family: var(--cb-font-sans);
      }
      .cb-repos-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-block-size: 36px;
      }
      .cb-repos-title {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 600;
        line-height: 1.21;
        color: var(--cb-text);
      }
      .cb-repos-new {
        display: grid;
        place-items: center;
        flex: none;
        inline-size: 36px;
        block-size: 36px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--cb-accent);
        color: var(--cb-bg);
        font-family: var(--cb-font-sans);
        font-size: 1.25rem;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
      }
      .cb-repos-search {
        appearance: none;
        inline-size: 100%;
        block-size: 36px;
        margin-block-start: 8px;
        padding-inline: 16px;
        border: 1px solid var(--repos-stroke);
        border-radius: 10px;
        background: var(--cb-surface);
        color: var(--cb-text);
        font: inherit;
        font-size: 0.8125rem;
        line-height: 1.21;
      }
      .cb-repos-search::placeholder {
        color: var(--cb-muted);
      }
      .cb-repos-eyebrow {
        margin: 18px 0 10px;
        font-size: 0.625rem;
        font-weight: 500;
        line-height: 1.21;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-repo-list,
      .cb-repo-checks {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-repo-row {
        position: relative;
        block-size: 72px;
        padding: 14px 16px 0;
        border: 1px solid var(--repos-stroke);
        border-radius: 12px;
        background: var(--cb-surface);
      }
      .cb-repo-name {
        display: block;
        font-size: 0.875rem;
        font-weight: 600;
        line-height: 1.21;
        color: var(--cb-text);
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      .cb-repo-state {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-block-start: 6px;
        font-size: 0.625rem;
        line-height: 1.21;
        color: var(--cb-accent);
      }
      .cb-repo-state[data-state='disabled'] {
        color: var(--cb-muted);
      }
      .cb-repo-dot {
        inline-size: 5px;
        block-size: 5px;
        border-radius: 50%;
        background: currentColor;
      }
      .cb-repo-counts {
        display: block;
        margin-block-start: 5px;
        font-size: 0.625rem;
        line-height: 1.21;
        color: var(--cb-muted);
      }
      .cb-repo-chev {
        position: absolute;
        inset-block-start: 30px;
        inset-inline-end: 16px;
        font-size: 1rem;
        line-height: 1.21;
        color: var(--cb-muted);
      }
      .cb-repo-attention {
        position: absolute;
        inset-block-start: 19px;
        inset-inline-end: 32px;
        inline-size: 8px;
        block-size: 8px;
        border-radius: 50%;
        background: var(--cb-warn);
      }
      .cb-repo-verify {
        position: absolute;
        inset-block-end: 16px;
        inset-inline-end: 32px;
        padding: 6px 0;
        border: 0;
        background: none;
        color: var(--cb-accent);
        font: inherit;
        font-size: 0.625rem;
        line-height: 1.21;
        cursor: pointer;
      }
      .cb-repo-verify:disabled {
        opacity: 0.6;
        cursor: progress;
      }
      .cb-repos-add {
        display: flex;
        align-items: center;
        gap: 8px;
        inline-size: 100%;
        block-size: 48px;
        margin-block-start: 12px;
        padding-inline: 16px;
        border: 1px solid var(--repos-stroke);
        border-radius: var(--cb-radius);
        background: var(--cb-bg);
        color: var(--cb-accent);
        font: inherit;
        font-size: 0.75rem;
        line-height: 1.21;
        text-align: start;
        cursor: pointer;
      }
      .cb-repos-add-plus {
        font-size: 0.875rem;
        line-height: 1;
      }
      .cb-repos-note {
        margin: 20px 0 0;
        font-size: 0.625rem;
        line-height: 1.21;
        color: var(--cb-muted);
      }
      .cb-repos-form {
        margin-block-start: 16px;
        padding: 16px;
        border: 1px solid var(--repos-stroke);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
      }
      .cb-repos-form[hidden] {
        display: none;
      }
      .cb-repo-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .cb-repo-form label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 0.75rem;
        line-height: 1.21;
        color: var(--cb-muted);
      }
      .cb-repo-form input,
      .cb-repo-form textarea {
        font: inherit;
        font-size: 0.8125rem;
        line-height: 1.21;
        color: var(--cb-text);
        background: var(--cb-bg);
        border: 1px solid var(--repos-stroke);
        border-radius: 10px;
        padding: 10px 12px;
      }
      .cb-repo-form button[type='submit'] {
        block-size: 44px;
        border: 0;
        border-radius: var(--cb-radius);
        background: var(--cb-accent);
        color: var(--cb-bg);
        font: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
      }
      .cb-repo-form button[type='submit']:disabled {
        opacity: 0.6;
        cursor: progress;
      }
      .cb-field-error {
        margin: 0;
        font-size: 0.75rem;
        color: var(--cb-danger);
      }
      .cb-state-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-block-start: 22px;
        padding: 16px;
        border: 1px solid var(--repos-stroke);
        border-radius: 16px;
        background: var(--cb-surface);
      }
      .cb-state-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        line-height: 1.21;
        color: var(--cb-text);
      }
      .cb-state-line {
        margin: 0;
        font-size: 0.75rem;
        line-height: 1.21;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-state-action {
        block-size: 44px;
        border: 0;
        border-radius: var(--cb-radius);
        background: var(--cb-accent);
        color: var(--cb-bg);
        font: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
      }
      .cb-skeleton {
        block-size: 12px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--cb-muted) 22%, transparent);
      }
      .cb-verify {
        margin-block-start: 24px;
        border: 1px solid var(--repos-stroke);
        border-radius: var(--cb-radius);
        padding: 16px;
      }
      .cb-verify[data-ok='true'] {
        border-color: var(--cb-accent);
      }
      .cb-verify[data-ok='false'] {
        border-color: var(--cb-danger);
      }
      .cb-verify h2 {
        margin: 0;
        font-size: 0.75rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-repo-check {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        overflow-wrap: anywhere;
      }
    `,
  ],
  template: `
    <ion-content>
      <div class="cb-repos" data-testid="page-repos">
        <header class="cb-repos-head">
          <h1 class="cb-repos-title">{{ t('repos.title') }}</h1>
          <button
            type="button"
            class="cb-repos-new"
            data-testid="repos-action-new"
            [attr.aria-label]="t('repos.action.new')"
            [attr.aria-expanded]="formOpen()"
            (click)="toggleForm()"
          >
            <span aria-hidden="true">+</span>
          </button>
        </header>

        <input
          class="cb-repos-search"
          data-testid="repos-search"
          type="search"
          autocomplete="off"
          spellcheck="false"
          [attr.placeholder]="t('repos.search.placeholder')"
          [attr.aria-label]="t('repos.search.placeholder')"
          [value]="searchQuery()"
          (input)="setSearch($event)"
        />

        <p class="cb-repos-eyebrow" data-testid="repos-count">
          {{ t('repos.count') }} · {{ rows().length }}
        </p>

        @if (store.loading()) {
          <div class="cb-state-card" data-testid="repos-loading" role="status">
            <h2 class="cb-state-title">{{ t('common.loading') }}</h2>
            @for (bar of skeletonBars; track bar) {
              <span class="cb-skeleton" aria-hidden="true"></span>
            }
          </div>
        }

        @if (store.error(); as failure) {
          <div
            class="cb-state-card"
            data-testid="repos-error"
            role="alert"
            [attr.data-code]="failure.code"
          >
            <h2 class="cb-state-title">{{ t('common.error') }}</h2>
            <p class="cb-state-line cb-mono">{{ failure.code }}</p>
            <button
              type="button"
              class="cb-state-action"
              data-testid="repos-retry"
              (click)="store.load()"
            >
              {{ t('repos.action.retry') }}
            </button>
          </div>
        }

        @if (rows().length === 0) {
          @if (!store.loading() && store.error() === null) {
            @if (store.repos().length === 0) {
              <div class="cb-state-card" data-testid="repos-empty">
                <h2 class="cb-state-title">{{ t('repos.empty') }}</h2>
                <p class="cb-state-line">{{ t('repos.note') }}</p>
              </div>
            } @else {
              <p class="cb-state-line">{{ t('repos.empty.filter') }}</p>
            }
          }
        } @else {
          <ul class="cb-repo-list">
            @for (repo of rows(); track repo.id) {
              <li class="cb-repo-row" data-testid="repo-row" [attr.data-repo-id]="repo.id">
                <a
                  class="cb-repo-name"
                  [routerLink]="['/repos', repo.id]"
                  [attr.data-testid]="'repo-link-' + repo.id"
                >
                  {{ repo.slug }}
                </a>
                <span
                  class="cb-repo-state"
                  data-testid="repo-row-state"
                  [attr.data-state]="repo.enabled ? 'enabled' : 'disabled'"
                >
                  <span class="cb-repo-dot" aria-hidden="true"></span>
                  <span class="cb-mono">{{ repo.defaultBranch }}</span>
                </span>
                @if (repo.counts; as counts) {
                  <span
                    class="cb-repo-counts"
                    data-testid="repo-row-counts"
                    [attr.data-pending]="counts.pending"
                    [attr.data-running]="counts.running"
                    [attr.data-merged]="counts.merged"
                  >
                    {{ counts.pending }} {{ t('repos.counts.pending') }} ·
                    {{ counts.running }} {{ t('repos.counts.running') }} ·
                    {{ counts.merged }} {{ t('repos.counts.merged') }}
                  </span>
                }
                @if (repo.counts && repo.counts.pending > 0) {
                  <span
                    class="cb-repo-attention"
                    data-testid="repo-row-attention"
                    role="img"
                    [attr.aria-label]="t('repos.row.attention')"
                  ></span>
                }
                <span class="cb-repo-chev" aria-hidden="true">›</span>
                <button
                  type="button"
                  class="cb-repo-verify"
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

        @if (!store.loading()) {
          <button type="button" class="cb-repos-add" data-testid="repos-add" (click)="toggleForm()">
            <span class="cb-repos-add-plus" aria-hidden="true">+</span>
            {{ t('repos.action.add') }}
          </button>
        }

        <div
          class="cb-repos-form"
          data-testid="repos-form"
          [attr.data-open]="formOpen()"
          [hidden]="!formOpen()"
        >
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
        </div>

        <p class="cb-repos-note" data-testid="repos-note">{{ t('repos.note') }}</p>

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
  readonly searchQuery = signal('');
  readonly formOpen = signal(false);
  readonly skeletonBars: readonly number[] = SKELETON_BARS;

  private readonly i18n = inject(I18nService);

  readonly rows = computed<readonly Repo[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const repos = this.store.repos();
    if (query === '') return repos;
    return repos.filter((repo) => repo.slug.toLowerCase().includes(query));
  });

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

  setSearch(event: Event): void {
    this.searchQuery.set(fieldValue(event));
  }

  toggleForm(): void {
    this.formOpen.update((open) => !open);
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
