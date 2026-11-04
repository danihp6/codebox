import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider, Type, WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { NotificationPreferences } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale } from '../../core/i18n/i18n.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { STRINGS, translate } from './notifications.i18n';
import { NotificationsPage, NotificationsPanel } from './notifications.page';
import { NOTIFICATION_EVENTS } from './notifications.store';

const PREFERENCES_URL = '/v1/notifications/preferences';

const PREFERENCES_BODY: NotificationPreferences = {
  events: ['run.finished'],
  quietHours: '22:00-07:00',
};

const FAILURE = {
  error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' },
};

const USED_KEYS: readonly string[] = [
  'notifications.title',
  'notifications.group.events',
  'notifications.locked.title',
  'notifications.locked.always',
  'notifications.locked.hint',
  'notifications.quiet.title',
  'notifications.quiet.hint',
  'notifications.quiet.none',
  'notifications.quiet.save',
  'notifications.quiet.saved',
  'notifications.quiet.absent',
  'notifications.quiet.failed',
  'notifications.note.1',
  'notifications.note.2',
  'notifications.close',
  'notifications.retry',
  'notifications.title.run.finished',
  'notifications.title.run.failed',
  'notifications.title.run.merged',
  'notifications.title.approval.created',
  'notifications.title.routine.fired',
];

interface MountedOf<T> {
  readonly fixture: ComponentFixture<T>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly locale: WritableSignal<Locale>;
}

type Mounted = MountedOf<NotificationsPanel>;

async function mount(locale: Locale = 'en'): Promise<Mounted> {
  return mountComponent(NotificationsPanel, locale);
}

function testProviders(localeSignal: WritableSignal<Locale>): (Provider | EnvironmentProviders)[] {
  return [
    provideRouter([]),
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: I18nService, useValue: { locale: localeSignal } },
  ];
}

async function mountComponent<T>(component: Type<T>, locale: Locale = 'en'): Promise<MountedOf<T>> {
  const localeSignal = signal<Locale>(locale);
  TestBed.configureTestingModule({ providers: testProviders(localeSignal) });
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    locale: localeSignal,
  };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function toggles(element: HTMLElement): HTMLInputElement[] {
  return [...element.querySelectorAll<HTMLInputElement>('[data-testid^="notifications-toggle-"]')];
}

async function flushPreferences<T>(
  mounted: MountedOf<T>,
  body: NotificationPreferences,
): Promise<void> {
  mounted.http.expectOne({ method: 'GET', url: PREFERENCES_URL }).flush(body);
  await mounted.fixture.whenStable();
}

describe('NotificationsPanel', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders exactly five toggles in NOTIFICATION_EVENTS order', async () => {
    const mounted = await mount();
    await flushPreferences(mounted, PREFERENCES_BODY);

    const inputs = toggles(mounted.element);
    expect(inputs).toHaveLength(5);
    expect(inputs.map((input) => input.getAttribute('data-testid'))).toEqual(
      NOTIFICATION_EVENTS.map((event) => `notifications-toggle-${event}`),
    );
    expect(inputs.map((input) => input.getAttribute('data-enabled'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(inputs.every((input) => input.type === 'checkbox')).toBe(true);
    expect(inputs[0]?.checked).toBe(true);
    expect(hook(mounted.element, 'notifications-panel')?.getAttribute('data-events')).toBe('5');
    expect(hook(mounted.element, 'notifications-panel')?.getAttribute('data-locked')).toBe(
      'credential.changed',
    );
    mounted.http.verify();
  });

  it('draws the two group headings, the five event rows and the two notes', async () => {
    const mounted = await mount();
    await flushPreferences(mounted, PREFERENCES_BODY);

    expect(
      [...mounted.element.querySelectorAll<HTMLElement>('[data-testid="notifications-group"]')].map(
        (group) => group.getAttribute('data-group'),
      ),
    ).toEqual(['events', 'quiet']);

    const rows = [...mounted.element.querySelectorAll<HTMLElement>(
      '[data-testid="notifications-ev-row"]',
    )];
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.getAttribute('data-event'))).toEqual([...NOTIFICATION_EVENTS]);
    expect(rows.map((row) => row.getAttribute('data-on'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(rows.map((row) => row.querySelector('input')?.getAttribute('data-enabled'))).toEqual(
      rows.map((row) => row.getAttribute('data-on')),
    );

    const notes = [...mounted.element.querySelectorAll<HTMLElement>(
      '[data-testid="notifications-note"]',
    )];
    expect(notes.map((note) => note.getAttribute('data-note'))).toEqual(['1', '2']);
    expect(notes[0]?.textContent).toContain(translate('en', 'notifications.note.1'));
    mounted.http.verify();
  });

  it('shows the quiet switch as a state, never a control', async () => {
    const mounted = await mount();
    await flushPreferences(mounted, PREFERENCES_BODY);

    const track = hook(mounted.element, 'notifications-quiet-track');
    expect(hook(mounted.element, 'notifications-quiet-card')).not.toBeNull();
    expect(track?.getAttribute('data-on')).toBe('true');
    expect(track?.getAttribute('aria-hidden')).toBe('true');
    expect(track?.querySelector('input')).toBeNull();
    expect(track?.tagName).toBe('SPAN');
    mounted.http.verify();
  });

  it('renders the locked credential row without a toggle in en', async () => {
    const mounted = await mount('en');
    await flushPreferences(mounted, PREFERENCES_BODY);

    const row = hook(mounted.element, 'notifications-locked-credential');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-locked')).toBe('true');
    expect(row?.querySelector('input')).toBeNull();
    expect(row?.textContent).toContain('Credential changed');
    expect(hook(mounted.element, 'notifications-locked-always')?.textContent).toContain('Always');
    mounted.http.verify();
  });

  it('renders the locked credential row in es', async () => {
    const mounted = await mount('es');
    await flushPreferences(mounted, PREFERENCES_BODY);

    const row = hook(mounted.element, 'notifications-locked-credential');
    expect(row?.getAttribute('data-locked')).toBe('true');
    expect(row?.querySelector('input')).toBeNull();
    expect(row?.textContent).toContain('Credencial cambiada');
    expect(hook(mounted.element, 'notifications-locked-always')?.textContent).toContain('Siempre');

    mounted.locale.set('en');
    await mounted.fixture.whenStable();
    expect(hook(mounted.element, 'notifications-locked-credential')?.textContent).toContain(
      'Credential changed',
    );
    expect(hook(mounted.element, 'notifications-locked-always')?.textContent).toContain('Always');
    mounted.http.verify();
  });

  it('posts the full preferences object when a toggle flips and rolls a 500 back', async () => {
    const mounted = await mount();
    await flushPreferences(mounted, { events: ['run.finished'], quietHours: null });

    hook(mounted.element, 'notifications-toggle-run.merged')?.click();
    await mounted.fixture.whenStable();

    expect(
      hook(mounted.element, 'notifications-toggle-run.merged')?.getAttribute('data-enabled'),
    ).toBe('true');

    const request = mounted.http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual({
      events: ['run.finished', 'run.merged'],
      quietHours: null,
    });
    request.flush(FAILURE, { status: 500, statusText: 'Internal Server Error' });
    await mounted.fixture.whenStable();

    expect(
      hook(mounted.element, 'notifications-toggle-run.merged')?.getAttribute('data-enabled'),
    ).toBe('false');
    expect(
      (hook(mounted.element, 'notifications-toggle-run.merged') as HTMLInputElement).checked,
    ).toBe(false);
    expect(hook(mounted.element, 'notifications-error')?.getAttribute('data-code')).toBe(
      'internal',
    );
    mounted.http.verify();
  });

  it('shows the saved quiet hours and saves a new window through both routes', async () => {
    const mounted = await mount();
    await flushPreferences(mounted, PREFERENCES_BODY);

    expect(
      hook(mounted.element, 'notifications-quiet-hours')?.getAttribute('data-quiet-hours'),
    ).toBe('22:00-07:00');
    expect(
      (hook(mounted.element, 'notifications-quiet-hours') as HTMLInputElement).placeholder,
    ).toBe('22:00-07:00');
    expect(
      hook(mounted.element, 'notifications-quiet-current')?.getAttribute('data-quiet-hours'),
    ).toBe('22:00-07:00');
    expect(hook(mounted.element, 'notifications-quiet-current')?.getAttribute('data-mirror')).toBe(
      '',
    );

    const input = hook(mounted.element, 'notifications-quiet-hours') as HTMLInputElement;
    input.value = '21:00-06:00';
    input.dispatchEvent(new Event('input'));
    await mounted.fixture.whenStable();

    hook(mounted.element, 'notifications-quiet-save')?.click();
    await mounted.fixture.whenStable();

    mounted.http
      .expectOne({ method: 'PATCH', url: PREFERENCES_URL })
      .flush({ events: ['run.finished'], quietHours: '21:00-06:00' });
    await mounted.fixture.whenStable();
    expect((hook(mounted.element, 'notifications-quiet-save') as HTMLButtonElement).disabled).toBe(
      true,
    );

    mounted.http
      .expectOne({ method: 'PATCH', url: '/v1/settings' })
      .flush('missing', { status: 404, statusText: 'Not Found' });
    await mounted.fixture.whenStable();

    expect(
      hook(mounted.element, 'notifications-quiet-current')?.getAttribute('data-quiet-hours'),
    ).toBe('21:00-06:00');
    expect(hook(mounted.element, 'notifications-quiet-current')?.getAttribute('data-mirror')).toBe(
      'absent',
    );
    expect(hook(mounted.element, 'notifications-error')).toBeNull();
    expect((hook(mounted.element, 'notifications-quiet-save') as HTMLButtonElement).disabled).toBe(
      false,
    );
    mounted.http.verify();
  });

  it('turns the quiet switch off when the window is cleared', async () => {
    const mounted = await mount();
    await flushPreferences(mounted, PREFERENCES_BODY);

    expect(hook(mounted.element, 'notifications-quiet-track')?.getAttribute('data-on')).toBe('true');

    const input = hook(mounted.element, 'notifications-quiet-hours') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await mounted.fixture.whenStable();

    hook(mounted.element, 'notifications-quiet-save')?.click();
    await mounted.fixture.whenStable();

    mounted.http
      .expectOne({ method: 'PATCH', url: PREFERENCES_URL })
      .flush({ events: ['run.finished'], quietHours: null });
    await mounted.fixture.whenStable();
    mounted.http
      .expectOne({ method: 'PATCH', url: '/v1/settings' })
      .flush('missing', { status: 404, statusText: 'Not Found' });
    await mounted.fixture.whenStable();

    expect(hook(mounted.element, 'notifications-quiet-track')?.getAttribute('data-on')).toBe(
      'false',
    );
    mounted.http.verify();
  });

  it('shows the loading line, reports a failed read and retries', async () => {
    const mounted = await mount();
    expect(hook(mounted.element, 'notifications-loading')).not.toBeNull();
    expect(toggles(mounted.element).map((input) => input.getAttribute('data-enabled'))).toEqual([
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);

    mounted.http
      .expectOne({ method: 'GET', url: PREFERENCES_URL })
      .flush(FAILURE, { status: 500, statusText: 'Internal Server Error' });
    await mounted.fixture.whenStable();

    expect(hook(mounted.element, 'notifications-error')?.getAttribute('data-code')).toBe(
      'internal',
    );
    expect(toggles(mounted.element)).toHaveLength(5);
    expect(toggles(mounted.element)[0]?.checked).toBe(false);

    hook(mounted.element, 'notifications-retry')?.click();
    await mounted.fixture.whenStable();
    await flushPreferences(mounted, PREFERENCES_BODY);

    expect(hook(mounted.element, 'notifications-error')).toBeNull();
    expect(hook(mounted.element, 'notifications-loading')).toBeNull();
    expect(toggles(mounted.element)[0]?.getAttribute('data-enabled')).toBe('true');
    mounted.http.verify();
  });

  it('emits closed when the close button is pressed', async () => {
    const mounted = await mount();
    await flushPreferences(mounted, PREFERENCES_BODY);

    let closed = 0;
    mounted.fixture.componentInstance.closed.subscribe(() => {
      closed += 1;
    });
    hook(mounted.element, 'notifications-close')?.click();

    expect(closed).toBe(1);
    mounted.http.verify();
  });

  it('mounts the panel on the routed page under its own header', async () => {
    const mounted = await mountComponent(NotificationsPage);
    await flushPreferences(mounted, PREFERENCES_BODY);

    expect(mounted.element.querySelector('h3')).toBeNull();
    expect(hook(mounted.element, 'notifications-panel')).not.toBeNull();
    expect(toggles(mounted.element)).toHaveLength(5);
    expect(hook(mounted.element, 'notifications-back')?.getAttribute('href')).toBe('/settings');
    expect(hook(mounted.element, 'notifications-title')?.textContent).toContain(
      translate('en', 'notifications.title'),
    );
    expect(hook(mounted.element, 'notifications-sub')?.getAttribute('data-count')).toBe('5');
    mounted.http.verify();
  });

  it('ships the same keys in both dictionaries and resolves every template key', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
    for (const locale of ['en', 'es'] as const) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(value, `${locale} ${key}`).not.toBe('');
        expect(translate(locale, key), `${locale} ${key}`).toBe(value);
      }
      for (const key of USED_KEYS) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
