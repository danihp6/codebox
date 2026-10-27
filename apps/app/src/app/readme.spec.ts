import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = resolve(process.cwd());
const SOURCE = resolve(APP, 'src/app');
const README = resolve(APP, 'README.md');

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function readmePath(path: string): string {
  return relative(APP, path).replaceAll('\\', '/');
}

describe('README file map', () => {
  it('lists every file under src/app', () => {
    const readme = readFileSync(README, 'utf8');
    const missing = walk(SOURCE)
      .map(readmePath)
      .filter((path) => !readme.includes(`\`${path}\``));

    expect(missing).toEqual([]);
  });

  it('points at files that exist', () => {
    const readme = readFileSync(README, 'utf8');
    const listed = [...readme.matchAll(/`(src\/app\/[^`]+)`/g)]
      .map((match) => match[1])
      .filter((path): path is string => path !== undefined);
    const stale = listed.filter((path) => !existsSync(resolve(APP, path)));

    expect(listed.length).toBeGreaterThan(0);
    expect(stale).toEqual([]);
  });
});
