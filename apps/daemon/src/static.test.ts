import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT_TYPES, contentTypeFor, createStaticHandler, resolveStaticPath } from './static.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function appDirectory(files: Record<string, string> = {}): string {
  const directory = mkdtempSync(join(tmpdir(), 'cb-11-static-'));
  temporaryDirectories.push(directory);
  for (const [name, content] of Object.entries(files)) {
    const file = join(directory, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }
  return directory;
}

describe('static path resolution', () => {
  const root = '/srv/codebox/app';

  it('resolves a normal path inside the root', () => {
    expect(resolveStaticPath(root, '/main.js')).toBe('/srv/codebox/app/main.js');
    expect(resolveStaticPath(root, '/assets/logo.svg')).toBe('/srv/codebox/app/assets/logo.svg');
  });

  it('resolves the root itself', () => {
    expect(resolveStaticPath(root, '/')).toBe(root);
    expect(resolveStaticPath(root, '')).toBe(root);
    expect(resolveStaticPath(root, '/./')).toBe(root);
  });

  it('rejects traversal, encoded traversal, NUL and malformed encoding', () => {
    expect(resolveStaticPath(root, '/../package.json')).toBeNull();
    expect(resolveStaticPath(root, '/%2e%2e/package.json')).toBeNull();
    expect(resolveStaticPath(root, '/a/../../etc/passwd')).toBeNull();
    expect(resolveStaticPath(root, '/a%00b')).toBeNull();
    expect(resolveStaticPath(root, '/%2e%2e%2fpackage.json')).toBeNull();
    expect(resolveStaticPath(root, '/%zz')).toBeNull();
  });
});

describe('static content types', () => {
  it('maps every documented extension', () => {
    expect(contentTypeFor('/x/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('/x/main.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/x/main.mjs')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/x/styles.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('/x/data.json')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('/x/main.js.map')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('/x/logo.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('/x/icon.png')).toBe('image/png');
    expect(contentTypeFor('/x/favicon.ico')).toBe('image/x-icon');
    expect(contentTypeFor('/x/manifest.webmanifest')).toBe('application/manifest+json');
    expect(contentTypeFor('/x/font.woff2')).toBe('font/woff2');
    expect(contentTypeFor('/x/robots.txt')).toBe('text/plain; charset=utf-8');
  });

  it('falls back to octet-stream and is case-insensitive', () => {
    expect(Object.keys(CONTENT_TYPES)).toHaveLength(12);
    expect(contentTypeFor('/x/archive.zip')).toBe('application/octet-stream');
    expect(contentTypeFor('/x/INDEX.HTML')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('/x/noextension')).toBe('application/octet-stream');
  });
});

describe('static handler', () => {
  it('serves an existing file with its content type', async () => {
    const root = appDirectory({ 'index.html': '<!doctype html><title>cb</title>', 'main.js': 'x' });
    const handler = createStaticHandler({ root });
    const hit = await handler('/main.js');
    expect(hit.kind).toBe('file');
    if (hit.kind !== 'file') return;
    expect(new TextDecoder().decode(hit.body)).toBe('x');
    expect(hit.contentType).toBe('text/javascript; charset=utf-8');
  });

  it('falls back to the index for a dotless route', async () => {
    const root = appDirectory({ 'index.html': '<!doctype html><title>cb</title>' });
    const handler = createStaticHandler({ root });
    for (const path of ['/', '/runs', '/runs/run_000001']) {
      const hit = await handler(path);
      expect(hit.kind).toBe('file');
      if (hit.kind !== 'file') return;
      expect(new TextDecoder().decode(hit.body)).toBe('<!doctype html><title>cb</title>');
      expect(hit.contentType).toBe('text/html; charset=utf-8');
    }
  });

  it('reports not_built when the index is missing', async () => {
    const root = appDirectory();
    const handler = createStaticHandler({ root });
    expect(await handler('/')).toEqual({ kind: 'not_built' });
    expect(await handler('/runs')).toEqual({ kind: 'not_built' });
  });

  it('reports a missing file for a path with an extension', async () => {
    const root = appDirectory({ 'index.html': 'x' });
    const handler = createStaticHandler({ root });
    expect(await handler('/main.js')).toEqual({ kind: 'missing' });
    expect(await handler('/assets/app.css')).toEqual({ kind: 'missing' });
  });

  it('never serves outside the root', async () => {
    const root = appDirectory({ 'index.html': 'inside' });
    const handler = createStaticHandler({ root });
    expect(await handler('/%2e%2e/package.json')).toEqual({ kind: 'missing' });
    expect(await handler('/a/%2e%2e/%2e%2e/etc/passwd')).toEqual({ kind: 'missing' });
  });

  it('honours a custom index name', async () => {
    const root = appDirectory({ 'entry.html': 'entry' });
    const handler = createStaticHandler({ root, index: 'entry.html' });
    const hit = await handler('/runs');
    expect(hit.kind).toBe('file');
    if (hit.kind !== 'file') return;
    expect(new TextDecoder().decode(hit.body)).toBe('entry');
  });
});
