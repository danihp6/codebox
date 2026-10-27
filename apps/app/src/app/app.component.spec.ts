import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';
import { AuthStore } from './core/auth/auth.store';
import { SECURE_STORE } from './core/auth/secure-store';
import type { SecureStore } from './core/auth/secure-store';
import { SseService } from './core/events/sse.service';
import { I18nService } from './core/i18n/i18n.service';
import { ConnectivityStore } from './shared/offline-banner';

function memoryStore(): SecureStore {
  const values = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      values.clear();
      return Promise.resolve();
    },
  };
}

function stubAuth(): AuthStore {
  return { signedIn: () => false } as unknown as AuthStore;
}

function stubSse(): SseService {
  return {
    state: signal<'closed'>('closed'),
    start: () => undefined,
    stop: () => undefined,
  } as unknown as SseService;
}

function stubI18n(): I18nService {
  return {
    locale: signal<'en'>('en'),
    t: (key: string) => key,
  } as unknown as I18nService;
}

async function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      { provide: SECURE_STORE, useValue: memoryStore() },
      { provide: AuthStore, useValue: stubAuth() },
      { provide: SseService, useValue: stubSse() },
      { provide: I18nService, useValue: stubI18n() },
    ],
  });
  const fixture = TestBed.createComponent(AppComponent);
  await fixture.whenStable();
  return fixture;
}

describe('AppComponent', () => {
  it('renders the offline banner inside the shell while the connection is stale', async () => {
    const fixture = await mount();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-offline-banner')).not.toBeNull();
    expect(element.querySelector('[data-testid="offline-banner"]')).toBeNull();

    TestBed.inject(ConnectivityStore).markStale();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element.querySelector('app-offline-banner')).not.toBeNull();
    expect(element.querySelector('[data-testid="offline-banner"]')).not.toBeNull();
  });

  it('drops the banner again on the first fresh response', async () => {
    const fixture = await mount();
    const element = fixture.nativeElement as HTMLElement;
    const connectivity = TestBed.inject(ConnectivityStore);

    connectivity.markStale();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(element.querySelector('[data-testid="offline-banner"]')).not.toBeNull();

    connectivity.markFresh();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(element.querySelector('[data-testid="offline-banner"]')).toBeNull();
  });
});
