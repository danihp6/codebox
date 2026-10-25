import { readFile, stat } from 'node:fs/promises';
import { extname, join, posix, resolve, sep } from 'node:path';

export interface StaticOptions {
  readonly root: string;
  readonly index?: string;
}

export type StaticHit =
  | { readonly kind: 'file'; readonly body: Uint8Array; readonly contentType: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'not_built' };

export const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
});

const FALLBACK_CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_INDEX = 'index.html';

/** null when the path escapes the root or contains a NUL byte. */
export function resolveStaticPath(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  if (decoded.split('/').includes('..')) return null;
  const base = resolve(root);
  const relative = posix.normalize(decoded).replace(/^\/+/, '');
  const candidate = join(base, relative);
  return candidate === base || candidate.startsWith(`${base}${sep}`) ? candidate : null;
}

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? FALLBACK_CONTENT_TYPE;
}

export function createStaticHandler(
  options: StaticOptions,
): (requestPath: string) => Promise<StaticHit> {
  const index = options.index ?? DEFAULT_INDEX;
  return async (requestPath: string): Promise<StaticHit> => {
    const candidate = resolveStaticPath(options.root, requestPath);
    if (candidate === null) return { kind: 'missing' };
    const hit = await readFileHit(candidate);
    if (hit !== null) return hit;
    const lastSegment = requestPath.split('/').at(-1) ?? '';
    if (lastSegment.includes('.')) return { kind: 'missing' };
    const indexPath = join(resolve(options.root), index);
    const fallback = await readFileHit(indexPath);
    return fallback ?? { kind: 'not_built' };
  };
}

async function readFileHit(file: string): Promise<StaticHit | null> {
  try {
    const info = await stat(file);
    if (!info.isFile()) return null;
    return { kind: 'file', body: await readFile(file), contentType: contentTypeFor(file) };
  } catch {
    return null;
  }
}
