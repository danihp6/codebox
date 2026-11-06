export type Locale = 'en' | 'es';

export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'about.title': 'About',
    'about.wordmark': 'codebox',
    'about.tagline': 'Control plane for OpenCode on your own VM.',
    'about.version': 'Version',
    'about.commit': 'Commit',
    'about.build': 'Build',
    'about.instance': 'Instance',
    'about.health.db': 'db',
    'about.health.opencode': 'opencode',
    'about.health.disk': 'disk',
    'about.health.ok': 'healthy',
    'about.health.degraded': 'degraded',
    'about.health.down': 'down',
    'about.licences': 'Open source licences',
    'about.footnote.licences': 'MIT · Angular 22 · Ionic 9 · Capacitor',
    'about.footnote.durability': 'The VM is disposable. The repo is durable.',
    'about.error': 'The server did not answer.',
    'about.retry': 'Retry',
  }),
  es: Object.freeze({
    'about.title': 'Acerca de',
    'about.wordmark': 'codebox',
    'about.tagline': 'Plano de control para OpenCode en tu propia VM.',
    'about.version': 'Versión',
    'about.commit': 'Commit',
    'about.build': 'Compilación',
    'about.instance': 'Instancia',
    'about.health.db': 'db',
    'about.health.opencode': 'opencode',
    'about.health.disk': 'disk',
    'about.health.ok': 'saludable',
    'about.health.degraded': 'degradado',
    'about.health.down': 'caído',
    'about.licences': 'Licencias de código abierto',
    'about.footnote.licences': 'MIT · Angular 22 · Ionic 9 · Capacitor',
    'about.footnote.durability': 'La VM es desechable. El repositorio, duradero.',
    'about.error': 'El servidor no ha respondido.',
    'about.retry': 'Reintentar',
  }),
});

export function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? key;
}
