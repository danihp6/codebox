import type { ErrorEnvelope } from '@codebox/contracts';

export const REDACTED = '<redacted>';
export const COLUMN_SEPARATOR = '  ';

const BEARER_VALUE = /\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi;

export interface CliWriter {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export function redactToken(text: string, token: string | null): string {
  let redacted = text.replace(BEARER_VALUE, REDACTED);
  if (token !== null && token.length > 0) redacted = redacted.split(token).join(REDACTED);
  return redacted;
}

export function createRedactingIo(io: CliWriter, token: string | null): CliWriter {
  return {
    out: (line: string): void => {
      io.out(redactToken(line, token));
    },
    err: (line: string): void => {
      io.err(redactToken(line, token));
    },
  };
}

export function formatApiError(envelope: ErrorEnvelope): string {
  const { code, message, requestId } = envelope.error;
  return `${code}: ${message} (requestId ${requestId})`;
}

export function jsonLine(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

export function formatTable(
  rows: readonly (readonly string[])[],
  headers?: readonly string[],
): string[] {
  const all = headers === undefined ? rows : [headers, ...rows];
  const widths: number[] = [];
  for (const row of all) {
    for (const [index, cell] of row.entries()) {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    }
  }
  return all.map((row) =>
    row
      .map((cell, index) =>
        index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? cell.length),
      )
      .join(COLUMN_SEPARATOR),
  );
}
