export type Locale = 'en' | 'es';

/** The repository chrome: its two tabs. */
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'repoTabs.aria': 'Repository sections',
    'repoTabs.backlog': 'Backlog',
    'repoTabs.workers': 'Workers',
  }),
  es: Object.freeze({
    'repoTabs.aria': 'Secciones del repositorio',
    'repoTabs.backlog': 'Backlog',
    'repoTabs.workers': 'Trabajadores',
  }),
});

export function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? key;
}
