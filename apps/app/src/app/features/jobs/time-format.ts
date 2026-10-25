export interface FireParts {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function fireParts(iso: string, timeZone: string): FireParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(iso));
  return {
    day: readPart(parts, 'day'),
    hour: readPart(parts, 'hour'),
    minute: readPart(parts, 'minute'),
  };
}

export function formatFire(iso: string, timeZone: string, locale: 'en' | 'es'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function readPart(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const found = parts.find((part) => part.type === type);
  if (found === undefined) throw new Error(`missing ${type} part`);
  return Number.parseInt(found.value, 10);
}
