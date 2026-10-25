import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  IonLabel,
  IonRouterLink,
  IonTabBar,
  IonTabButton,
} from '@ionic/angular';
import { I18nService } from '../core/i18n/i18n.service';

interface Tab {
  readonly id: string;
  readonly path: string;
  readonly labelKey: string;
}

export const SHELL_TABS: readonly Tab[] = Object.freeze([
  { id: 'dashboard', path: '/dashboard', labelKey: 'tabs.dashboard' },
  { id: 'chat', path: '/chat', labelKey: 'tabs.chat' },
  { id: 'jobs', path: '/jobs', labelKey: 'tabs.jobs' },
  { id: 'runs', path: '/runs', labelKey: 'tabs.runs' },
  { id: 'settings', path: '/settings', labelKey: 'tabs.settings' },
]);

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IonLabel, IonRouterLink, IonTabBar, IonTabButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-tab-bar slot="bottom">
      @for (tab of tabs; track tab.id) {
        <ion-tab-button
          [routerLink]="tab.path"
          routerLinkActive="cb-tab-active"
          [attr.data-testid]="'tab-' + tab.id"
        >
          <ion-label>{{ i18n.t(tab.labelKey) }}</ion-label>
        </ion-tab-button>
      }
    </ion-tab-bar>
  `,
})
export class TabsPage {
  readonly i18n = inject(I18nService);
  readonly tabs = SHELL_TABS;
}
