import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { filter, map } from 'rxjs';
import { AuthStore } from './core/auth/auth.store';
import { SseService } from './core/events/sse.service';
import { I18nService } from './core/i18n/i18n.service';
import { TabsPage } from './shell/tabs.page';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet, TabsPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-app>
      <ion-router-outlet></ion-router-outlet>
      @if (showTabs()) {
        <app-tabs />
      }
      <span
        class="cb-sse"
        data-testid="sse-connection"
        [attr.data-state]="sseState()"
        aria-hidden="true"
      ></span>
    </ion-app>
  `,
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly sse = inject(SseService);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly sseState = this.sse.state;
  readonly showTabs = computed(() => !this.url().startsWith('/pair'));

  constructor() {
    inject(I18nService);
    effect(() => {
      if (this.auth.signedIn()) this.sse.start();
      else this.sse.stop();
    });
  }
}
