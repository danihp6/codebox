import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import type { PairPlatform } from '../../core/auth/auth.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { STRINGS, translate } from './i18n';
import type { Locale } from './i18n';
import { PairingPage, pairingFailureOf, pairingProblem, platformFor } from './pairing.page';

interface PairInput {
  readonly code: string;
  readonly deviceName: string;
  readonly platform: PairPlatform;
}

const CODE = '7K3M9QXB2F';
const DEVICE_NAME = 'Dani iPhone';

const TABLE: Readonly<Record<string, readonly [string, string]>> = {
  'pair.title': ['Pair this device', 'Empareja este dispositivo'],
  'pair.code': ['Pairing code', 'Código de emparejamiento'],
  'pair.code.hint': ['Ten characters from cb pair.', 'Diez caracteres de cb pair.'],
  'pair.deviceName': ['Device name', 'Nombre del dispositivo'],
  'pair.deviceName.hint': [
    'How this device appears in Settings.',
    'Cómo aparece este dispositivo en Ajustes.',
  ],
  'pair.submit': ['Pair', 'Emparejar'],
  'pair.submitting': ['Pairing…', 'Emparejando…'],
  'pair.error.code': [
    'The code is invalid or has expired.',
    'El código no es válido o ha caducado.',
  ],
  'pair.error.deviceName': ['Give this device a name.', 'Ponle un nombre a este dispositivo.'],
  'pair.error.codeRejected': [
    'The code is invalid or has expired.',
    'El código no es válido o ha caducado.',
  ],
  'pair.error.rateLimited': [
    'Too many attempts. Wait a minute.',
    'Demasiados intentos. Espera un minuto.',
  ],
  'pair.error.offline': ['No connection to the box.', 'Sin conexión con la caja.'],
  'pair.error.failed': [
    'Pairing failed. Try again.',
    'El emparejamiento ha fallado. Inténtalo de nuevo.',
  ],
};

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function typeInto(element: HTMLElement | null, value: string): void {
  if (element === null) throw new Error('missing input');
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = value;
  }
  element.dispatchEvent(new Event('input'));
}

function submitForm(element: HTMLElement): void {
  const form = hook(element, 'pair-form');
  if (form === null) throw new Error('missing pair form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function clickSubmit(element: HTMLElement): HTMLButtonElement {
  const button = hook(element, 'pair-submit');
  if (button === null) throw new Error('missing submit button');
  button.click();
  return button as HTMLButtonElement;
}

async function settle(fixture: ComponentFixture<PairingPage>): Promise<void> {
  await fixture.whenStable();
  await fixture.whenStable();
}

function fillValid(element: HTMLElement): void {
  typeInto(hook(element, 'pair-code'), CODE);
  typeInto(hook(element, 'pair-device-name'), DEVICE_NAME);
}

function rejection(status: number, reason?: string): ApiError {
  return new ApiError({
    message: 'Rejected',
    status,
    code: status === 401 ? 'unauthorized' : 'rate_limited',
    requestId: 'req_01JABCDEFGHJKMNPQRSV',
    details: reason === undefined ? null : { reason },
  });
}

async function mount() {
  const pair = vi.fn<(input: PairInput) => Promise<void>>();
  pair.mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthStore, useValue: { pair } },
      { provide: I18nService, useValue: { locale: signal<Locale>('en') } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(PairingPage);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, pair, navigate };
}

describe('PairingPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders the frozen hooks, the labels and the input attributes', async () => {
    const { element } = await mount();

    expect(hook(element, 'page-pair')).not.toBeNull();
    expect(hook(element, 'pair-form')).not.toBeNull();
    expect(hook(element, 'pair-error')).toBeNull();

    const code = hook(element, 'pair-code') as HTMLInputElement | null;
    expect(code?.type).toBe('text');
    expect(code?.getAttribute('autocomplete')).toBe('one-time-code');
    expect(code?.getAttribute('autocapitalize')).toBe('characters');
    expect(code?.getAttribute('spellcheck')).toBe('false');
    expect(code?.getAttribute('inputmode')).toBe('text');

    const deviceName = hook(element, 'pair-device-name') as HTMLInputElement | null;
    expect(deviceName?.type).toBe('text');
    expect(deviceName?.getAttribute('autocomplete')).toBe('off');

    expect(element.querySelector('label[for="pair-code"]')?.textContent).toContain('Pairing code');
    expect(element.querySelector('label[for="pair-device-name"]')?.textContent).toContain(
      'Device name',
    );
    expect(hook(element, 'pair-submit')?.textContent).toContain('Pair');
  });

  it('rejects two empty fields with the code failure and never calls pair', async () => {
    const { fixture, element, pair } = await mount();

    submitForm(element);
    await settle(fixture);

    const error = hook(element, 'pair-error');
    expect(error?.getAttribute('data-failure')).toBe('code');
    expect(error?.textContent).toContain('The code is invalid or has expired.');
    expect(pair).not.toHaveBeenCalled();
  });

  it('rejects an empty device name with the deviceName failure and never calls pair', async () => {
    const { fixture, element, pair } = await mount();

    typeInto(hook(element, 'pair-code'), CODE);
    await settle(fixture);
    submitForm(element);
    await settle(fixture);

    const error = hook(element, 'pair-error');
    expect(error?.getAttribute('data-failure')).toBe('deviceName');
    expect(error?.textContent).toContain('Give this device a name.');
    expect(pair).not.toHaveBeenCalled();
  });

  it('trims both values and calls pair exactly once even on a double tap', async () => {
    const { fixture, element, pair, navigate } = await mount();

    typeInto(hook(element, 'pair-code'), `  ${CODE}  `);
    typeInto(hook(element, 'pair-device-name'), `  ${DEVICE_NAME}  `);
    await settle(fixture);

    let resolvePair: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      resolvePair = () => resolve();
    });
    pair.mockReturnValue(pending);

    const button = clickSubmit(element);
    await settle(fixture);
    expect(pair).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    clickSubmit(element);
    submitForm(element);
    await settle(fixture);
    expect(pair).toHaveBeenCalledTimes(1);
    expect(pair).toHaveBeenCalledWith({ code: CODE, deviceName: DEVICE_NAME, platform: 'web' });

    resolvePair();
    await settle(fixture);
    expect(button.disabled).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  for (const reason of ['used_code', 'expired_code'] as const) {
    it(`renders the ${reason} rejection as codeRejected and leaves submit enabled`, async () => {
      const { fixture, element, pair } = await mount();
      pair.mockRejectedValue(rejection(401, reason));

      fillValid(element);
      await settle(fixture);
      submitForm(element);
      await settle(fixture);

      const error = hook(element, 'pair-error');
      expect(error?.getAttribute('data-failure')).toBe('codeRejected');
      expect(error?.textContent).toContain('The code is invalid or has expired.');
      expect((hook(element, 'pair-submit') as HTMLButtonElement).disabled).toBe(false);
    });
  }

  it('renders a 429 as rateLimited and leaves submit enabled', async () => {
    const { fixture, element, pair } = await mount();
    pair.mockRejectedValue(rejection(429));

    fillValid(element);
    await settle(fixture);
    submitForm(element);
    await settle(fixture);

    const error = hook(element, 'pair-error');
    expect(error?.getAttribute('data-failure')).toBe('rateLimited');
    expect((hook(element, 'pair-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders a status 0 rejection as offline and leaves submit enabled', async () => {
    const { fixture, element, pair } = await mount();
    pair.mockRejectedValue(rejection(0));

    fillValid(element);
    await settle(fixture);
    submitForm(element);
    await settle(fixture);

    const error = hook(element, 'pair-error');
    expect(error?.getAttribute('data-failure')).toBe('offline');
    expect((hook(element, 'pair-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders any other rejection as failed and leaves submit enabled', async () => {
    const { fixture, element, pair } = await mount();
    pair.mockRejectedValue(rejection(422));

    fillValid(element);
    await settle(fixture);
    submitForm(element);
    await settle(fixture);

    expect(hook(element, 'pair-error')?.getAttribute('data-failure')).toBe('failed');
    expect((hook(element, 'pair-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('navigates to the dashboard once after a successful pair', async () => {
    const { fixture, element, pair, navigate } = await mount();

    fillValid(element);
    await settle(fixture);
    submitForm(element);
    await settle(fixture);

    expect(pair).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(hook(element, 'pair-error')).toBeNull();
    expect((hook(element, 'pair-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ships the same keys in both dictionaries and resolves every pair key', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(TABLE).sort());
    for (const locale of ['en', 'es'] as const) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(value, `${locale} ${key}`).not.toBe('');
        expect(translate(locale, key), `${locale} ${key}`).toBe(value);
      }
      for (const [key, expected] of Object.entries(TABLE)) {
        expect(translate(locale, key), `${locale} ${key}`).toBe(expected[locale === 'en' ? 0 : 1]);
      }
    }
  });
});

describe('pairingProblem', () => {
  it('trims before it measures', () => {
    expect(pairingProblem({ code: '   ', deviceName: DEVICE_NAME })).toBe('code');
    expect(pairingProblem({ code: CODE, deviceName: '  ' })).toBe('deviceName');
    expect(pairingProblem({ code: ` ${CODE} `, deviceName: ` ${DEVICE_NAME} ` })).toBeNull();
  });

  it('holds the 64-character bound of the daemon schema', () => {
    expect(pairingProblem({ code: 'x'.repeat(64), deviceName: DEVICE_NAME })).toBeNull();
    expect(pairingProblem({ code: 'x'.repeat(65), deviceName: DEVICE_NAME })).toBe('code');
    expect(pairingProblem({ code: CODE, deviceName: 'x'.repeat(64) })).toBeNull();
    expect(pairingProblem({ code: CODE, deviceName: 'x'.repeat(65) })).toBe('deviceName');
  });

  it('reports the code before the device name', () => {
    expect(pairingProblem({ code: '', deviceName: '' })).toBe('code');
  });
});

describe('pairingFailureOf', () => {
  it('maps every status the exchange can produce', () => {
    expect(pairingFailureOf(new Error('boom'))).toBe('failed');
    expect(pairingFailureOf(rejection(0))).toBe('offline');
    expect(pairingFailureOf(rejection(429))).toBe('rateLimited');
    for (const reason of ['used_code', 'expired_code', 'unknown_code']) {
      expect(pairingFailureOf(rejection(401, reason))).toBe('codeRejected');
    }
    for (const status of [400, 403, 422, 500, 502, 503]) {
      expect(pairingFailureOf(rejection(status))).toBe('failed');
    }
  });
});

describe('platformFor', () => {
  it('keeps the three known platforms and falls back to web', () => {
    expect(platformFor('ios')).toBe('ios');
    expect(platformFor('android')).toBe('android');
    expect(platformFor('web')).toBe('web');
    expect(platformFor('electron')).toBe('web');
    expect(platformFor('')).toBe('web');
  });
});
