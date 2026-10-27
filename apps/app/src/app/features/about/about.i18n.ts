export type Locale = 'en' | 'es';

export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'about.title': 'About',
    'about.section.build': 'Build',
    'about.section.health': 'Server health',
    'about.section.notices': 'Third-party licences',
    'about.version': 'Version',
    'about.commit': 'Commit',
    'about.built-at': 'Built at',
    'about.node': 'Node',
    'about.health.db': 'Database',
    'about.health.opencode': 'OpenCode',
    'about.health.disk': 'Disk used',
    'about.health.queue': 'Queue',
    'about.notices.count': 'Packages',
    'about.error': 'The server did not answer.',
    'about.retry': 'Retry',
  }),
  es: Object.freeze({
    'about.title': 'Acerca de',
    'about.section.build': 'Compilación',
    'about.section.health': 'Salud del servidor',
    'about.section.notices': 'Licencias de terceros',
    'about.version': 'Versión',
    'about.commit': 'Commit',
    'about.built-at': 'Compilado el',
    'about.node': 'Node',
    'about.health.db': 'Base de datos',
    'about.health.opencode': 'OpenCode',
    'about.health.disk': 'Disco usado',
    'about.health.queue': 'Cola',
    'about.notices.count': 'Paquetes',
    'about.error': 'El servidor no ha respondido.',
    'about.retry': 'Reintentar',
  }),
});

export function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? key;
}
