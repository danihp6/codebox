import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nService } from '../core/i18n/i18n.service';
import { ConnectivityStore, OfflineBanner } from './offline-banner';
import { STRINGS, translate } from './offline-banner.i18n';

function stubI18n(locale: 'en' | 'es'): I18nService {
  return { locale: signal(locale), t: (key: string) => key } as unknown as I18nService;
}

function store(): ConnectivityStore {
  TestBed.configureTestingModule({ providers: [] });
  return TestBed.inject(ConnectivityStore);
}

function banner(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="offline-banner"]');
}

describe('ConnectivityStore', () => {
  let connected: ConnectivityStore | null = null;

  afterEach(() => {
    connected?.disconnect();
    connected = null;
    vi.restoreAllMocks();
  });

  it('starts online and read-write', () => {
    const connectivity = store();

    expect(connectivity.online()).toBe(true);
    expect(connectivity.stale()).toBe(false);
    expect(connectivity.readOnly()).toBe(false);
    expect(connectivity.bannerVisible()).toBe(false);
  });

  it('goes stale on a failed request and fresh on the next success', () => {
    const connectivity = store();

    connectivity.markStale();
    expect(connectivity.stale()).toBe(true);
    expect(connectivity.readOnly()).toBe(true);
    expect(connectivity.bannerVisible()).toBe(true);

    connectivity.markFresh();
    expect(connectivity.stale()).toBe(false);
    expect(connectivity.readOnly()).toBe(false);
  });

  it('follows the offline and online browser events once connected', () => {
    const connectivity = store();
    connected = connectivity;
    connectivity.connect();

    window.dispatchEvent(new Event('offline'));
    expect(connectivity.online()).toBe(false);
    expect(connectivity.readOnly()).toBe(true);

    connectivity.markFresh();
    expect(connectivity.readOnly()).toBe(true);

    window.dispatchEvent(new Event('online'));
    expect(connectivity.online()).toBe(true);
    expect(connectivity.readOnly()).toBe(false);
  });

  it('attaches and removes the listeners exactly once when called twice', () => {
    const connectivity = store();
    connected = connectivity;
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    connectivity.connect();
    connectivity.connect();
    connectivity.disconnect();
    connectivity.disconnect();

    expect(add.mock.calls.filter(([type]) => type === 'online')).toHaveLength(1);
    expect(add.mock.calls.filter(([type]) => type === 'offline')).toHaveLength(1);
    expect(remove.mock.calls.filter(([type]) => type === 'online')).toHaveLength(1);
    expect(remove.mock.calls.filter(([type]) => type === 'offline')).toHaveLength(1);
  });
});

describe('OfflineBanner', () => {
  it('renders exactly one banner while stale and removes it when fresh', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: I18nService, useValue: stubI18n('en') }],
    });
    const fixture = TestBed.createComponent(OfflineBanner);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(banner(element)).toBeNull();

    const connectivity = TestBed.inject(ConnectivityStore);
    connectivity.markStale();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-testid="offline-banner"]')).toHaveLength(1);
    expect(banner(element)?.getAttribute('role')).toBe('status');
    expect(element.textContent).toContain('Offline — showing the last synced data.');
    expect(element.textContent).toContain('Changes are disabled until the box answers.');

    connectivity.markFresh();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(banner(element)).toBeNull();
    expect(element.querySelectorAll('[data-testid="offline-banner"]')).toHaveLength(0);
  });

  it('renders the Spanish copy when the locale is es', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: I18nService, useValue: stubI18n('es') }],
    });
    const fixture = TestBed.createComponent(OfflineBanner);
    TestBed.inject(ConnectivityStore).markStale();
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain(
      'Sin conexión: mostrando los últimos datos sincronizados.',
    );
    expect(element.textContent).toContain(
      'Los cambios están desactivados hasta que la caja responda.',
    );
  });
});

describe('offline copy', () => {
  it('keeps the two dictionaries in step', () => {
    expect(Object.keys(STRINGS.es).sort()).toEqual(Object.keys(STRINGS.en).sort());
    const values = [...Object.values(STRINGS.en), ...Object.values(STRINGS.es)];
    expect(values).toHaveLength(4);
    for (const value of values) expect(value.length).toBeGreaterThan(0);
  });

  it('translates both keys and both locales', () => {
    expect(translate('en', 'offline.banner')).toBe('Offline — showing the last synced data.');
    expect(translate('en', 'offline.readOnly')).toBe('Changes are disabled until the box answers.');
    expect(translate('es', 'offline.banner')).toBe(
      'Sin conexión: mostrando los últimos datos sincronizados.',
    );
    expect(translate('es', 'offline.readOnly')).toBe(
      'Los cambios están desactivados hasta que la caja responda.',
    );
  });

  it('falls back to the English string for an unknown locale', () => {
    const unknown = 'fr' as unknown as 'en';
    expect(translate(unknown, 'offline.banner')).toBe('Offline — showing the last synced data.');
  });
});
