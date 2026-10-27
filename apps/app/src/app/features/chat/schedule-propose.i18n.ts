export type Locale = 'en' | 'es';

export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'propose.title': 'Proposed schedule',
    'propose.mode.once': 'Once',
    'propose.mode.every': 'Repeats',
    'propose.mode.window': 'Window',
    'propose.cron': 'Repeats',
    'propose.window': 'Window',
    'propose.zone': 'Timezone',
    'propose.next': 'Next fire',
    'propose.next.pending': 'Computed by the daemon once you create it',
    'propose.cost': 'Cost cap per fire',
    'propose.repo': 'Repository',
    'propose.none': 'Nothing is scheduled until you tap Create.',
    'propose.create': 'Create schedule',
    'propose.creating': 'Creating…',
    'propose.dismiss': 'Not now',
    'propose.error': 'The schedule could not be created.',
  }),
  es: Object.freeze({
    'propose.title': 'Horario propuesto',
    'propose.mode.once': 'Una vez',
    'propose.mode.every': 'Se repite',
    'propose.mode.window': 'Ventana',
    'propose.cron': 'Se repite',
    'propose.window': 'Ventana',
    'propose.zone': 'Zona horaria',
    'propose.next': 'Próximo disparo',
    'propose.next.pending': 'El daemon lo calcula cuando lo crees',
    'propose.cost': 'Tope de coste por disparo',
    'propose.repo': 'Repositorio',
    'propose.none': 'No hay nada programado hasta que pulses Crear.',
    'propose.create': 'Crear horario',
    'propose.creating': 'Creando…',
    'propose.dismiss': 'Ahora no',
    'propose.error': 'No se ha podido crear el horario.',
  }),
});

export function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? key;
}
