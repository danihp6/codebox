import { Injectable, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { SettingsStore } from '../settings/settings.store';
import type { LocaleCode } from '../settings/settings.store';

export type Locale = LocaleCode;

const DICTIONARY_ROOT = 'assets/i18n';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly settings = inject(SettingsStore);
  private readonly dictionaries = new Map<Locale, Dictionary>();
  private readonly localeSignal = signal<Locale>('es');

  readonly locale: Signal<Locale> = this.localeSignal.asReadonly();
  readonly available: readonly Locale[] = ['en', 'es'];
  readonly t: (key: string) => string = (key) => {
    const dictionary = this.dictionaries.get(this.localeSignal());
    if (dictionary === undefined) return `missing:${key}`;
    return lookup(dictionary, key) ?? `missing:${key}`;
  };

  constructor() {
    void this.hydrate().catch(() => undefined);
  }

  async set(locale: Locale): Promise<void> {
    await this.ensure(locale);
    this.localeSignal.set(locale);
    await this.settings.setLocale(locale);
  }

  private async hydrate(): Promise<void> {
    await this.settings.load();
    const locale = this.settings.locale();
    await this.ensure(locale);
    this.localeSignal.set(locale);
  }

  private async ensure(locale: Locale): Promise<void> {
    if (this.dictionaries.has(locale)) return;
    const response = await fetch(`${DICTIONARY_ROOT}/${locale}.json`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`i18n dictionary ${locale} failed to load`);
    const body: unknown = await response.json();
    if (!isDictionary(body)) throw new Error(`i18n dictionary ${locale} is malformed`);
    this.dictionaries.set(locale, body);
  }
}

type Dictionary = { readonly [key: string]: string | Dictionary };

function isDictionary(value: unknown): value is Dictionary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const entry of Object.values(value)) {
    if (typeof entry === 'string') continue;
    if (!isDictionary(entry)) return false;
  }
  return true;
}

function lookup(dictionary: Dictionary, key: string): string | null {
  let current: string | Dictionary | undefined = dictionary;
  for (const segment of key.split('.')) {
    if (typeof current === 'string') return null;
    current = current[segment];
    if (current === undefined) return null;
  }
  return typeof current === 'string' ? current : null;
}
