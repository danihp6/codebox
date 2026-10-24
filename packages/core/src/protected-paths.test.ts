import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROTECTED_PATHS,
  globToRegExp,
  matchesGlob,
  normaliseRepoPath,
  scanProtectedPaths,
} from './protected-paths.js';

describe('protected paths', () => {
  it('ships the D26 default list', () => {
    expect([...DEFAULT_PROTECTED_PATHS]).toEqual([
      '.github/**',
      'ops/**',
      'infra/**',
      '**/*.env',
      'CODEOWNERS',
      '.gitmodules',
    ]);
  });

  it('matches the pinned paths against the default list', () => {
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      ['.github/workflows/x.yml', true],
      ['ops/vm/install.sh', true],
      ['infra/main.tf', true],
      ['src/.env', true],
      ['.env', true],
      ['CODEOWNERS', true],
      ['.gitmodules', true],
      ['src/index.ts', false],
      ['ops', false],
      ['.github', false],
      ['docs/ops/readme.md', false],
      ['src/env.ts', false],
      ['CODEOWNERS.md', false],
    ];
    for (const [path, expected] of cases) {
      expect(scanProtectedPaths([path], DEFAULT_PROTECTED_PATHS)).toHaveLength(expected ? 1 : 0);
    }
  });

  it('reads the glob operators of the spec', () => {
    const cases: ReadonlyArray<readonly [string, string, boolean]> = [
      ['*', 'file.ts', true],
      ['*', 'dir/file.ts', false],
      ['*.env', 'config/.env', false],
      ['**/*.env', 'config/.env', true],
      ['**/*.env', '.env', true],
      ['**/*.env', 'a/b/c/.env', true],
      ['?.ts', 'a.ts', true],
      ['?.ts', 'ab.ts', false],
      ['?.ts', 'a/t.ts', false],
      ['src/**', 'src/a/b/c.ts', true],
      ['src/**', 'src', false],
      ['src/*.ts', 'src/a.ts', true],
      ['src/*.ts', 'src/a/b.ts', false],
      ['a.b', 'axb', false],
      ['a+b', 'a+b', true],
      ['[ab]', '[ab]', true],
      ['src/index.ts', 'src/index.ts', true],
      ['src/index.ts', 'src/index.tsx', false],
    ];
    for (const [pattern, path, expected] of cases) {
      expect(matchesGlob(pattern, path)).toBe(expected);
    }
  });

  it('anchors the compiled expression at both ends', () => {
    const compiled = globToRegExp('ops/**');
    expect(compiled.source.startsWith('^')).toBe(true);
    expect(compiled.source.endsWith('$')).toBe(true);
    expect(compiled.test('ops/a.sh')).toBe(true);
    expect(compiled.test('x/ops/a.sh')).toBe(false);
  });

  it('throws only for a pattern that is not a string', () => {
    expect(() => globToRegExp(42 as unknown as string)).toThrow(TypeError);
    expect(() => globToRegExp('')).not.toThrow();
  });

  it('normalises a repo path without resolving parents', () => {
    expect(normaliseRepoPath('./src/index.ts')).toBe('src/index.ts');
    expect(normaliseRepoPath('././src/index.ts')).toBe('src/index.ts');
    expect(normaliseRepoPath('src//index.ts')).toBe('src/index.ts');
    expect(normaliseRepoPath('src/index.ts')).toBe('src/index.ts');
    expect(normaliseRepoPath('../src/index.ts')).toBe('../src/index.ts');
    expect(normaliseRepoPath('src/../index.ts')).toBe('src/../index.ts');
  });

  it('matches a normalised path', () => {
    expect(matchesGlob('ops/**', './ops/vm/install.sh')).toBe(true);
    expect(matchesGlob('src/*.ts', 'src//index.ts')).toBe(true);
  });

  it('reports one hit per path and pattern, in input order, without duplicates', () => {
    const hits = scanProtectedPaths(
      ['.github/workflows/ci.yml', 'ops/vm/install.sh', '.github/workflows/ci.yml', 'src/a.ts'],
      ['ops/**', '.github/**', '**/*.env', '.github/**'],
    );
    expect(hits).toEqual([
      { path: '.github/workflows/ci.yml', pattern: '.github/**' },
      { path: 'ops/vm/install.sh', pattern: 'ops/**' },
    ]);
  });

  it('returns nothing for an empty list on either side', () => {
    expect(scanProtectedPaths([], DEFAULT_PROTECTED_PATHS)).toEqual([]);
    expect(scanProtectedPaths(['.github/workflows/ci.yml'], [])).toEqual([]);
  });
});
