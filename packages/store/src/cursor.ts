import { StoreError } from './errors.js';

export interface PageQuery {
  readonly limit: number;
  readonly cursor: string | null;
}

export interface PageResult<T> {
  readonly data: T[];
  readonly nextCursor: string | null;
}

const SEPARATOR = '\u0000';
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}${SEPARATOR}${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  let decoded: string;
  try {
    decoded = decoder.decode(Buffer.from(cursor, 'base64url'));
  } catch {
    throw invalidCursor();
  }
  const index = decoded.indexOf(SEPARATOR);
  if (index <= 0 || index === decoded.length - 1) throw invalidCursor();
  const createdAt = decoded.slice(0, index);
  const id = decoded.slice(index + 1);
  if (createdAt.length === 0 || id.length === 0) throw invalidCursor();
  return { createdAt, id };
}

function invalidCursor(): StoreError {
  return new StoreError('invalid_row', 'invalid cursor');
}
