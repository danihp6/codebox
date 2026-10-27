export type Locale = 'en' | 'es';

/** The notification panel's own dictionary; the settings dictionary keeps its legacy keys. */
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'notifications.title': 'Notifications',
    'notifications.locked.title': 'Credential changed',
    'notifications.locked.hint':
      'Always on: a credential change is never silenced and has no toggle.',
    'notifications.quiet.title': 'Quiet hours',
    'notifications.quiet.hint': 'HH:MM-HH:MM, half-open; leave it empty to clear the window.',
    'notifications.quiet.none': 'No quiet hours.',
    'notifications.quiet.save': 'Save quiet hours',
    'notifications.quiet.saved': 'Quiet hours saved.',
    'notifications.quiet.absent': 'Saved here; this build has no settings route to mirror it to.',
    'notifications.quiet.failed': 'Saved here; mirroring the window to settings failed.',
    'notifications.close': 'Close',
    'notifications.retry': 'Retry',
    'notifications.title.run.finished': 'A run finished',
    'notifications.title.run.failed': 'A run failed',
    'notifications.title.run.merged': 'A run merged',
    'notifications.title.approval.created': 'An approval is waiting',
    'notifications.title.routine.fired': 'A routine fired',
  }),
  es: Object.freeze({
    'notifications.title': 'Notificaciones',
    'notifications.locked.title': 'Credencial cambiada',
    'notifications.locked.hint':
      'Siempre activa: un cambio de credencial nunca se silencia y no tiene interruptor.',
    'notifications.quiet.title': 'Horas de silencio',
    'notifications.quiet.hint':
      'HH:MM-HH:MM, intervalo semiabierto; déjalo vacío para borrar la ventana.',
    'notifications.quiet.none': 'Sin horas de silencio.',
    'notifications.quiet.save': 'Guardar horas de silencio',
    'notifications.quiet.saved': 'Horas de silencio guardadas.',
    'notifications.quiet.absent':
      'Guardado aquí; esta compilación no tiene ruta de ajustes donde espejarlo.',
    'notifications.quiet.failed': 'Guardado aquí; el espejo de la ventana a ajustes ha fallado.',
    'notifications.close': 'Cerrar',
    'notifications.retry': 'Reintentar',
    'notifications.title.run.finished': 'Una ejecución ha terminado',
    'notifications.title.run.failed': 'Una ejecución ha fallado',
    'notifications.title.run.merged': 'Una ejecución se ha fusionado',
    'notifications.title.approval.created': 'Hay una aprobación pendiente',
    'notifications.title.routine.fired': 'Una rutina se ha disparado',
  }),
});

export function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? key;
}
