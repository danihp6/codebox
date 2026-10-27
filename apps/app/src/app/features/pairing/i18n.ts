export type Locale = 'en' | 'es';

/** `pair.*` is duplicated here so the screen renders without the shared dictionary. */
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'pair.title': 'Pair this device',
    'pair.code': 'Pairing code',
    'pair.code.hint': 'Ten characters from cb pair.',
    'pair.deviceName': 'Device name',
    'pair.deviceName.hint': 'How this device appears in Settings.',
    'pair.submit': 'Pair',
    'pair.submitting': 'Pairing…',
    'pair.error.code': 'The code is invalid or has expired.',
    'pair.error.deviceName': 'Give this device a name.',
    'pair.error.codeRejected': 'The code is invalid or has expired.',
    'pair.error.rateLimited': 'Too many attempts. Wait a minute.',
    'pair.error.offline': 'No connection to the box.',
    'pair.error.failed': 'Pairing failed. Try again.',
  }),
  es: Object.freeze({
    'pair.title': 'Empareja este dispositivo',
    'pair.code': 'Código de emparejamiento',
    'pair.code.hint': 'Diez caracteres de cb pair.',
    'pair.deviceName': 'Nombre del dispositivo',
    'pair.deviceName.hint': 'Cómo aparece este dispositivo en Ajustes.',
    'pair.submit': 'Emparejar',
    'pair.submitting': 'Emparejando…',
    'pair.error.code': 'El código no es válido o ha caducado.',
    'pair.error.deviceName': 'Ponle un nombre a este dispositivo.',
    'pair.error.codeRejected': 'El código no es válido o ha caducado.',
    'pair.error.rateLimited': 'Demasiados intentos. Espera un minuto.',
    'pair.error.offline': 'Sin conexión con la caja.',
    'pair.error.failed': 'El emparejamiento ha fallado. Inténtalo de nuevo.',
  }),
});

export function translate(locale: Locale, key: string): string {
  return STRINGS[locale][key] ?? key;
}
