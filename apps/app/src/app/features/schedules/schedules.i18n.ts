export type Locale = 'en' | 'es';

export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'schedules.title': 'Schedules',
    'schedules.loading': 'Loading schedules…',
    'schedules.error': 'The schedules could not be loaded.',
    'schedules.retry': 'Retry',
    'schedules.empty': 'No schedules yet.',
    'schedules.mode.once': 'Once',
    'schedules.mode.every': 'Repeats',
    'schedules.mode.window': 'Window',
    'schedules.window.running': 'Window open',
    'schedules.next': 'Next fire',
    'schedules.next.none': 'Not scheduled',
    'schedules.fires': 'Fires',
    'schedules.spend': 'Spend',
    'schedules.unreviewed': 'Delivered, not reviewed',
  }),
  es: Object.freeze({
    'schedules.title': 'Horarios',
    'schedules.loading': 'Cargando horarios…',
    'schedules.error': 'No se han podido cargar los horarios.',
    'schedules.retry': 'Reintentar',
    'schedules.empty': 'Todavía no hay horarios.',
    'schedules.mode.once': 'Una vez',
    'schedules.mode.every': 'Se repite',
    'schedules.mode.window': 'Ventana',
    'schedules.window.running': 'Ventana abierta',
    'schedules.next': 'Próximo disparo',
    'schedules.next.none': 'Sin programar',
    'schedules.fires': 'Disparos',
    'schedules.spend': 'Gasto',
    'schedules.unreviewed': 'Entregado, sin revisar',
  }),
});

export function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? key;
}
