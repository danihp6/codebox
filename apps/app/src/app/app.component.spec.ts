import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';
import { AuthStore } from './core/auth/auth.store';
import { SECURE_STORE } from './core/auth/secure-store';
import type { SecureStore } from './core/auth/secure-store';
import { SseService } from './core/events/sse.service';
import { I18nService } from './core/i18n/i18n.service';
import { SettingsStore } from './core/settings/settings.store';
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

async function mount(secure: SecureStore) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      { provide: SECURE_STORE, useValue: secure },
      { provide: AuthStore, useValue: stubAuth() },
      { provide: SseService, useValue: stubSse() },
      { provide: I18nService, useValue: stubI18n() },
    ],
  });
  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function themeAttribute(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

describe('AppComponent', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the offline banner inside the shell while the connection is stale', async () => {
    const fixture = await mount(memoryStore());
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
    const fixture = await mount(memoryStore());
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

  it('writes dark on the document with nothing stored', async () => {
    await mount(memoryStore());

    expect(themeAttribute()).toBe('dark');
  });

  it('repaints the document when the operator picks light', async () => {
    const fixture = await mount(memoryStore());

    await TestBed.inject(SettingsStore).setTheme('light');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(themeAttribute()).toBe('light');
  });

  it('boots light again from the same secure store', async () => {
    const secure = memoryStore();
    const first = await mount(secure);
    await TestBed.inject(SettingsStore).setTheme('light');
    first.detectChanges();
    await first.whenStable();

    TestBed.resetTestingModule();
    document.documentElement.removeAttribute('data-theme');

    await mount(secure);

    expect(themeAttribute()).toBe('light');
  });
});
