import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECURE_STORE } from '../auth/secure-store';
import type { SecureStore } from '../auth/secure-store';
import { SettingsStore, initialTheme, systemPrefersLight } from './settings.store';

const SETTINGS_KEY = 'cb.settings';
const CSS = readFileSync(resolve(process.cwd(), 'src/theme/variables.css'), 'utf8');

// The needle is assembled so the repository keeps its one-line grep for the system query.
const SYSTEM_QUERY = ['prefers', 'color', 'scheme'].join('-');

const DARK_COLOURS: readonly (readonly [string, string])[] = [
  ['--cb-bg', '#0b0f14'],
  ['--cb-surface', '#121821'],
  ['--cb-text', '#e6edf3'],
  ['--cb-muted', '#8b98a5'],
  ['--cb-accent', '#22c55e'],
  ['--cb-warn', '#f59e0b'],
  ['--cb-danger', '#ef4444'],
  ['--cb-ink-accent', '#15803d'],
  ['--cb-ink-warn', '#b45309'],
];

const LIGHT_DECLARATIONS = [
  '--cb-bg: #f7f9fb',
  '--cb-surface: #ffffff',
  '--cb-text: #0b0f14',
  '--cb-muted: #5b6772',
  '--ion-background-color-rgb: 247, 249, 251',
  '--ion-text-color-rgb: 11, 15, 20',
];

const TWELVE = [
  '#0b0f14',
  '#121821',
  '#f7f9fb',
  '#ffffff',
  '#e6edf3',
  '#8b98a5',
  '#5b6772',
  '#15803d',
  '#22c55e',
  '#b45309',
  '#f59e0b',
  '#ef4444',
];

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

function blockOf(selector: string): string {
  const at = CSS.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

function declarations(block: string): string[] {
  return block
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((entry) => entry.replaceAll(/\s+/g, ' ').trim())
    .filter((entry) => entry.length > 0);
}

describe('initialTheme', () => {
  it('lets a stored preference win over every platform and system appearance', () => {
    for (const platform of ['ios', 'android', 'web']) {
      for (const prefersLight of [true, false]) {
        expect(initialTheme({ stored: 'light', platform, prefersLight })).toBe('light');
        expect(initialTheme({ stored: 'dark', platform, prefersLight })).toBe('dark');
      }
    }
  });

  it('follows the system on iOS when nothing is stored', () => {
    expect(initialTheme({ stored: null, platform: 'ios', prefersLight: true })).toBe('light');
    expect(initialTheme({ stored: null, platform: 'ios', prefersLight: false })).toBe('dark');
  });

  it('is dark on web and android even in a light-mode system', () => {
    expect(initialTheme({ stored: null, platform: 'web', prefersLight: true })).toBe('dark');
    expect(initialTheme({ stored: null, platform: 'android', prefersLight: true })).toBe('dark');
  });
});

describe('systemPrefersLight', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the media query on iOS only', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('matchMedia', matchMedia);

    expect(systemPrefersLight('web')).toBe(false);
    expect(systemPrefersLight('android')).toBe(false);
    expect(matchMedia).not.toHaveBeenCalled();

    expect(systemPrefersLight('ios')).toBe(true);
    expect(matchMedia).toHaveBeenCalledTimes(1);
  });

  it('answers dark on iOS without a media query implementation', () => {
    const matchMedia = vi.fn(() => ({ matches: false }));
    vi.stubGlobal('matchMedia', matchMedia);
    expect(systemPrefersLight('ios')).toBe(false);

    vi.stubGlobal('matchMedia', undefined);
    expect(systemPrefersLight('ios')).toBe(false);
  });
});

describe('SettingsStore', () => {
  let secure: SecureStore;

  beforeEach(() => {
    secure = memoryStore();
    TestBed.configureTestingModule({
      providers: [{ provide: SECURE_STORE, useValue: secure }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function storeOver(target: SecureStore): SettingsStore {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: SECURE_STORE, useValue: target }],
    });
    return TestBed.inject(SettingsStore);
  }

  it('loads dark from an empty store and persists nothing', async () => {
    const set = vi.spyOn(secure, 'set');
    const store = TestBed.inject(SettingsStore);

    await store.load();

    expect(store.theme()).toBe('dark');
    expect(set).not.toHaveBeenCalled();
    await expect(secure.get(SETTINGS_KEY)).resolves.toBeNull();
  });

  it('applies a stored light preference', async () => {
    await secure.set(SETTINGS_KEY, JSON.stringify({ theme: 'light', locale: 'es' }));
    const store = TestBed.inject(SettingsStore);

    await store.load();

    expect(store.theme()).toBe('light');
  });

  it('writes the picked theme through the secure store and survives a reload', async () => {
    const store = TestBed.inject(SettingsStore);

    await store.setTheme('light');

    const raw = await secure.get(SETTINGS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ theme: 'light' });

    const reloaded = storeOver(secure);
    await reloaded.load();
    expect(reloaded.theme()).toBe('light');
  });

  it('falls back to dark on a malformed payload and never throws', async () => {
    await secure.set(SETTINGS_KEY, '{not json');
    const malformed = TestBed.inject(SettingsStore);
    await expect(malformed.load()).resolves.toBeUndefined();
    expect(malformed.theme()).toBe('dark');

    const unknown = storeOver(secure);
    await secure.set(SETTINGS_KEY, JSON.stringify({ theme: 'blue', locale: 'fr' }));
    await expect(unknown.load()).resolves.toBeUndefined();
    expect(unknown.theme()).toBe('dark');
    expect(unknown.locale()).toBe('es');
  });
});

describe('variables.css theme blocks', () => {
  it('never reads the system appearance', () => {
    expect(CSS).not.toContain(SYSTEM_QUERY);
  });

  it('keeps the nine dark colour variables in the root block', () => {
    const body = declarations(blockOf(':root {'));

    for (const [name, value] of DARK_COLOURS) {
      expect(body, name).toContain(`${name}: ${value}`);
    }
  });

  it('declares exactly the six light declarations behind data-theme', () => {
    const body = declarations(blockOf(":root[data-theme='light'] {"));

    expect(body).toEqual(LIGHT_DECLARATIONS);
  });

  it('carries all twelve colour leaves and no other hex value', () => {
    const found = (CSS.match(/#[0-9a-f]{6}\b/gi) ?? []).map((value) => value.toLowerCase());

    for (const value of TWELVE) {
      expect(found, value).toContain(value);
    }
    expect(found.filter((value) => value === '#0b0f14')).toHaveLength(2);
    expect([...found].sort()).toEqual([...TWELVE, '#0b0f14'].sort());
  });
});
