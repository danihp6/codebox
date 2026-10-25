export type Locale = 'en' | 'es';

export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'runs.title': 'Runs',
    'runs.loading': 'Loading runs',
    'runs.error': 'The runs could not be loaded.',
    'runs.retry': 'Retry',
    'runs.empty': 'No runs yet.',
    'runs.more': 'Load more',
    'runs.filter.all': 'All',
    'runs.cost': 'Cost',
    'runs.state.queued': 'Queued',
    'runs.state.preparing': 'Preparing',
    'runs.state.running': 'Running',
    'runs.state.gating': 'Gating',
    'runs.state.pr_open': 'Pull request open',
    'runs.state.merging': 'Merging',
    'runs.state.succeeded': 'Succeeded',
    'runs.state.failed': 'Failed',
    'runs.state.cancelled': 'Cancelled',
  }),
  es: Object.freeze({
    'runs.title': 'Ejecuciones',
    'runs.loading': 'Cargando ejecuciones',
    'runs.error': 'No se han podido cargar las ejecuciones.',
    'runs.retry': 'Reintentar',
    'runs.empty': 'Todavía no hay ejecuciones.',
    'runs.more': 'Cargar más',
    'runs.filter.all': 'Todas',
    'runs.cost': 'Coste',
    'runs.state.queued': 'En cola',
    'runs.state.preparing': 'Preparando',
    'runs.state.running': 'Ejecutando',
    'runs.state.gating': 'Pasando la puerta',
    'runs.state.pr_open': 'Pull request abierta',
    'runs.state.merging': 'Fusionando',
    'runs.state.succeeded': 'Correcta',
    'runs.state.failed': 'Fallida',
    'runs.state.cancelled': 'Cancelada',
  }),
});

export function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? key;
}
