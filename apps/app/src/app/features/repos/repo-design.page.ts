import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Session } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { NewSessionSheet } from '../backlog/new-session.sheet';
import { RepoTabs } from './repo-tabs';
import { translate } from './repo-chrome.i18n';

/**
 * No route on `main` answers `design/` artifacts yet, so the tab shows an honest unavailable
 * block instead of a preview; Task-79 owns the projection.
 */
@Component({
  selector: 'app-repo-design-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, RepoTabs, NewSessionSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-unavailable {
        border: 1px dashed var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        color: var(--cb-muted);
      }
      .cb-design-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        margin-block: calc(var(--cb-space) * 3);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('repoTabs.design') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-repo-design" [attr.data-repo-id]="id()">
        <app-repo-tabs [repoId]="id()" />

        <div class="cb-unavailable" data-testid="repo-design-unavailable">
          <p>{{ t('repoDesign.unavailable.title') }}</p>
          <p>{{ t('repoDesign.unavailable.body') }}</p>
        </div>

        <div class="cb-design-actions">
          <button type="button" data-testid="repo-design-new-session" (click)="openSheet()">
            {{ t('repoDesign.newSession') }}
          </button>
        </div>

        @if (sheetOpen()) {
          <app-new-session
            [repoId]="id()"
            target="design"
            (created)="onSessionCreated($event)"
            (cancelled)="closeSheet()"
          />
        }
      </div>
    </ion-content>
  `,
})
export class RepoDesignPage {
  readonly id = input.required<string>();
  readonly sheetOpen = signal(false);

  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  openSheet(): void {
    this.sheetOpen.set(true);
  }

  closeSheet(): void {
    this.sheetOpen.set(false);
  }

  onSessionCreated(session: Session): void {
    this.sheetOpen.set(false);
    void this.router.navigate(['/sessions', session.id]);
  }
}
