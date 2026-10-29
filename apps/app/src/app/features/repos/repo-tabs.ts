import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './repo-chrome.i18n';

export type RepoTabId = 'backlog' | 'workers' | 'schedule' | 'design';

export interface RepoTab {
  readonly id: RepoTabId;
  readonly link: (repoId: string) => readonly string[];
  readonly labelKey:
    | 'repoTabs.backlog'
    | 'repoTabs.workers'
    | 'repoTabs.schedule'
    | 'repoTabs.design';
}

/** One source of truth for the four repository tabs. Exactly these four, in this order. */
export const REPO_TABS: readonly RepoTab[] = Object.freeze([
  {
    id: 'backlog',
    link: (repoId) => ['/repos', repoId],
    labelKey: 'repoTabs.backlog',
  },
  {
    id: 'workers',
    link: (repoId) => ['/repos', repoId, 'workers'],
    labelKey: 'repoTabs.workers',
  },
  {
    id: 'schedule',
    link: (repoId) => ['/repos', repoId, 'schedule'],
    labelKey: 'repoTabs.schedule',
  },
  {
    id: 'design',
    link: (repoId) => ['/repos', repoId, 'design'],
    labelKey: 'repoTabs.design',
  },
]);

@Component({
  selector: 'app-repo-tabs',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-repo-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        margin-block: calc(var(--cb-space) * 3);
      }
      .cb-repo-tab {
        display: inline-flex;
        align-items: center;
        min-block-size: 44px;
        padding-block: calc(var(--cb-space) * 1);
        padding-inline: calc(var(--cb-space) * 2);
        color: var(--cb-muted);
        text-decoration: none;
        border-block-end: 2px solid transparent;
        overflow-wrap: anywhere;
      }
      .cb-repo-tab[data-active='true'],
      .cb-repo-tab.cb-tab-active {
        color: var(--cb-text);
        border-block-end-color: var(--cb-accent);
      }
    `,
  ],
  template: `
    <nav class="cb-repo-tabs" [attr.aria-label]="t('repoTabs.aria')" data-testid="repo-tabs">
      @for (tab of tabs; track tab.id) {
        <a
          class="cb-repo-tab"
          [routerLink]="tab.link(repoId())"
          routerLinkActive="cb-tab-active"
          [routerLinkActiveOptions]="{ exact: true }"
          #link="routerLinkActive"
          [attr.data-testid]="'repo-tab-' + tab.id"
          [attr.data-active]="link.isActive"
        >
          {{ t(tab.labelKey) }}
        </a>
      }
    </nav>
  `,
})
export class RepoTabs {
  readonly repoId = input.required<string>();
  readonly tabs = REPO_TABS;

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);
}
