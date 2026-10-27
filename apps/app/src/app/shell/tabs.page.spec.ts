import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { describe, expect, it } from 'vitest';
import { SHELL_TABS } from '../app.routes';
import { I18nService } from '../core/i18n/i18n.service';
import { TabsPage } from './tabs.page';

const LABELS: Readonly<Record<string, string>> = {
  'tabs.dashboard': 'Dashboard',
  'tabs.chat': 'Chat',
  'tabs.settings': 'Settings',
};

const i18nStub = { t: (key: string): string => LABELS[key] ?? `missing:${key}` };

type Json = string | number | boolean | null | Json[] | { readonly [key: string]: Json };

function readDictionary(locale: 'en' | 'es'): Json {
  const path = resolve(process.cwd(), 'src/assets/i18n', `${locale}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

function keysOf(value: Json, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('TabsPage', () => {
  it('renders exactly three bottom tabs in order, labelled through I18nService', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        { provide: I18nService, useValue: i18nStub },
      ],
    });
    const fixture = TestBed.createComponent(TabsPage);
    await fixture.whenStable();

    expect(SHELL_TABS.map((tab) => tab.id)).toEqual(['dashboard', 'chat', 'settings']);

    const element = fixture.nativeElement as HTMLElement;
    const buttons = element.querySelectorAll<HTMLElement>('[data-testid^="tab-"]');
    expect(buttons).toHaveLength(3);
    expect([...buttons].map((button) => button.getAttribute('data-testid'))).toEqual([
      'tab-dashboard',
      'tab-chat',
      'tab-settings',
    ]);
    expect([...buttons].map((button) => button.textContent?.trim())).toEqual([
      'Dashboard',
      'Chat',
      'Settings',
    ]);
  });
});

describe('shared dictionaries', () => {
  it('keeps EN and ES key-for-key identical, in the same order', () => {
    const en = keysOf(readDictionary('en'));
    const es = keysOf(readDictionary('es'));

    expect(es).toEqual(en);
  });

  it('keeps only the three live tab labels', () => {
    for (const locale of ['en', 'es'] as const) {
      const keys = keysOf(readDictionary(locale));
      expect(keys.filter((key) => key.startsWith('tabs.'))).toEqual([
        'tabs.dashboard',
        'tabs.chat',
        'tabs.settings',
      ]);
    }
  });
});
