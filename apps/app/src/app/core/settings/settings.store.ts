import { Injectable, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SECURE_STORE } from '../auth/secure-store';

export type Theme = 'dark' | 'light';
export type LocaleCode = 'en' | 'es';

export interface InitialThemeInput {
  readonly stored: Theme | null;
  readonly platform: string;
  readonly prefersLight: boolean;
}

/** The one rule: stored wins, iOS follows the system once, everything else is dark. */
export function initialTheme(input: InitialThemeInput): Theme {
  if (input.stored !== null) return input.stored;
  if (input.platform === 'ios') return input.prefersLight ? 'light' : 'dark';
  return 'dark';
}

/** Reads the media query only on iOS; every other platform answers false without reading it. */
export function systemPrefersLight(platform: string): boolean {
  if (platform !== 'ios') return false;
  return globalThis.matchMedia?.('(prefers-color-scheme: light)')?.matches === true;
}

interface StoredSettings {
  readonly theme?: Theme;
  readonly locale?: LocaleCode;
}

const SETTINGS_KEY = 'cb.settings';

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly secure = inject(SECURE_STORE);
  private loaded: Promise<void> | null = null;

  readonly theme = signal<Theme>('dark');
  readonly locale = signal<LocaleCode>('es');

  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  async setTheme(theme: Theme): Promise<void> {
    this.theme.set(theme);
    await this.persist();
  }

  async setLocale(locale: LocaleCode): Promise<void> {
    this.locale.set(locale);
    await this.persist();
  }

  private async read(): Promise<void> {
    const stored = await this.secure.get(SETTINGS_KEY);
    const parsed = stored === null ? {} : parseStoredSettings(stored);
    const platform = Capacitor.getPlatform();
    this.theme.set(
      initialTheme({
        stored: parsed.theme ?? null,
        platform,
        prefersLight: systemPrefersLight(platform),
      }),
    );
    if (parsed.locale !== undefined) this.locale.set(parsed.locale);
  }

  private async persist(): Promise<void> {
    const value = JSON.stringify({ theme: this.theme(), locale: this.locale() });
    await this.secure.set(SETTINGS_KEY, value);
  }
}

function parseStoredSettings(value: string): StoredSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const record = parsed as { theme?: unknown; locale?: unknown };
  const result: { theme?: Theme; locale?: LocaleCode } = {};
  if (record.theme === 'dark' || record.theme === 'light') result.theme = record.theme;
  if (record.locale === 'en' || record.locale === 'es') result.locale = record.locale;
  return result;
}
