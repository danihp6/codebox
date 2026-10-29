import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import type { Repo } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';

export type RepoPickerState = 'connected' | 'cloning' | 'unavailable';

/** `busyRepoId` is the repository a create/bind request is in flight for. */
export function pickerState(repo: Repo, busyRepoId: string | null): RepoPickerState {
  if (repo.id === busyRepoId) return 'cloning';
  if (repo.enabled === false) return 'unavailable';
  return 'connected';
}

@Component({
  selector: 'app-repo-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-repo-picker-list {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
        inline-size: 100%;
      }
      .cb-repo-picker-row {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        justify-content: space-between;
        inline-size: 100%;
        min-block-size: 44px;
        font: inherit;
        color: inherit;
        text-align: start;
        background: var(--cb-surface);
        border: 1px solid var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
        cursor: pointer;
      }
      .cb-repo-picker-row[data-state='cloning'] {
        border-color: var(--cb-accent);
        cursor: progress;
      }
      .cb-repo-picker-row[data-state='unavailable'] {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .cb-repo-picker-state {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <div class="cb-repo-picker" data-testid="repo-picker" [attr.data-count]="repos().length">
      <ul class="cb-repo-picker-list" [attr.aria-label]="t('repoPicker.aria')">
        @for (repo of repos(); track repo.id) {
          <li>
            <button
              type="button"
              class="cb-repo-picker-row"
              data-testid="repo-picker-row"
              [attr.data-repo-id]="repo.id"
              [attr.data-state]="state(repo)"
              [attr.aria-disabled]="state(repo) === 'unavailable'"
              (click)="onPick(repo)"
            >
              <span class="cb-mono">{{ repo.slug }}</span>
              <span class="cb-repo-picker-state">{{ t('repoPicker.state.' + state(repo)) }}</span>
            </button>
          </li>
        }
      </ul>
    </div>
  `,
})
export class RepoPicker {
  readonly repos = input.required<readonly Repo[]>();
  readonly busyRepoId = input<string | null>(null);
  readonly picked = output<string>();

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  state(repo: Repo): RepoPickerState {
    return pickerState(repo, this.busyRepoId());
  }

  onPick(repo: Repo): void {
    if (this.state(repo) === 'unavailable') return;
    this.picked.emit(repo.id);
  }
}
