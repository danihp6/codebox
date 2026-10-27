import { ChangeDetectionStrategy, Component, Injectable, computed, inject } from '@angular/core';
import type { Signal } from '@angular/core';
import { signal } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { translate } from './offline-banner.i18n';

/**
 * The client's view of reachability. `online` follows the browser, `stale` follows a request
 * that got no response at all; either one makes the cache read-only and shows the banner.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityStore {
  private readonly onlineState = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  private readonly staleState = signal(false);
  private listening = false;

  private readonly onOnline = (): void => {
    this.onlineState.set(true);
  };

  private readonly onOffline = (): void => {
    this.onlineState.set(false);
  };

  readonly online: Signal<boolean> = this.onlineState.asReadonly();
  readonly stale: Signal<boolean> = this.staleState.asReadonly();
  readonly readOnly: Signal<boolean> = computed(() => !this.onlineState() || this.staleState());
  readonly bannerVisible: Signal<boolean> = computed(() => this.readOnly());

  connect(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
  }

  disconnect(): void {
    if (!this.listening || typeof window === 'undefined') return;
    this.listening = false;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }

  markStale(): void {
    this.staleState.set(true);
  }

  markFresh(): void {
    this.staleState.set(false);
  }
}

@Component({
  selector: 'app-offline-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        position: sticky;
        inset-block-start: 0;
        z-index: 11;
      }
      .cb-offline {
        display: grid;
        gap: var(--cb-space);
        margin: 0;
        padding: calc(var(--cb-space) * 3);
        border-block-end: 1px solid var(--cb-warn);
        background: var(--cb-surface);
        color: var(--cb-text);
      }
      .cb-offline p {
        margin: 0;
      }
      .cb-offline-detail {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    @if (store.bannerVisible()) {
      <aside class="cb-offline" data-testid="offline-banner" role="status">
        <p class="cb-offline-text">{{ text() }}</p>
        <p class="cb-offline-detail">{{ detail() }}</p>
      </aside>
    }
  `,
})
export class OfflineBanner {
  readonly i18n: I18nService = inject(I18nService);
  readonly store: ConnectivityStore = inject(ConnectivityStore);

  readonly text: Signal<string> = computed(() => translate(this.i18n.locale(), 'offline.banner'));
  readonly detail: Signal<string> = computed(() =>
    translate(this.i18n.locale(), 'offline.readOnly'),
  );

  constructor() {
    this.store.connect();
  }
}
