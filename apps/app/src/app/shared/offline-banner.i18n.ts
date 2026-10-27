export type Locale = 'en' | 'es';

/** `offline.*` is duplicated here so the banner renders without the shared dictionary. */
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    'offline.banner': 'Offline — showing the last synced data.',
    'offline.readOnly': 'Changes are disabled until the box answers.',
  }),
  es: Object.freeze({
    'offline.banner': 'Sin conexión: mostrando los últimos datos sincronizados.',
    'offline.readOnly': 'Los cambios están desactivados hasta que la caja responda.',
  }),
});

export function translate(locale: Locale, key: string): string {
  const dictionary = STRINGS[locale] ?? STRINGS.en;
  return dictionary[key] ?? STRINGS.en[key] ?? key;
}
