import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECURE_STORE } from '../auth/secure-store';
import type { SecureStore } from '../auth/secure-store';
import { I18nService } from './i18n.service';

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

function readDictionary(locale: 'en' | 'es'): unknown {
  const file = resolve(process.cwd(), 'src/assets/i18n', `${locale}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof child === 'string') keys.push(path);
    else keys.push(...flattenKeys(child, path));
  }
  return keys.sort();
}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [{ provide: SECURE_STORE, useValue: memoryStore() }],
  });
}

describe('I18nService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('en and es share one key set', () => {
    const english = flattenKeys(readDictionary('en'));
    const spanish = flattenKeys(readDictionary('es'));

    expect(english.length).toBeGreaterThan(0);
    expect(spanish).toEqual(english);
  });

  it('returns missing:<key> instead of throwing', () => {
    configure();
    const i18n = TestBed.inject(I18nService);

    expect(i18n.t('missing.key')).toBe('missing:missing.key');
    expect(i18n.available).toEqual(['en', 'es']);
  });

  it('loads a dictionary once through set and switches the locale', async () => {
    const dictionary = {
      app: { title: 'Codebox' },
      tabs: { dashboard: 'Dashboard', chat: 'Chat', jobs: 'Jobs', runs: 'Runs', settings: 'Settings' },
      pair: {
        title: 'Pair',
        code: 'Code',
        deviceName: 'Device',
        submit: 'Submit',
        error: 'Error',
      },
      common: {
        retry: 'Retry',
        cancel: 'Cancel',
        loading: 'Loading',
        error: 'Error',
        empty: 'Empty',
      },
    };
    const fetchStub = vi.fn(async (input: string | URL | Request) => {
      void input;
      return new Response(JSON.stringify(dictionary), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchStub);

    configure();
    const i18n = TestBed.inject(I18nService);
    await vi.waitFor(() => expect(i18n.locale()).toBe('es'), { timeout: 5000 });

    await i18n.set('en');
    await i18n.set('en');

    expect(i18n.locale()).toBe('en');
    expect(i18n.t('tabs.dashboard')).toBe('Dashboard');
    const englishLoads = fetchStub.mock.calls.filter(([input]) =>
      String(input).endsWith('/en.json'),
    );
    expect(englishLoads).toHaveLength(1);
  });
});
