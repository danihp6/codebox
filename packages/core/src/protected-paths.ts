export const DEFAULT_PROTECTED_PATHS: readonly string[] = Object.freeze([
  '.github/**',
  'ops/**',
  'infra/**',
  '**/*.env',
  'CODEOWNERS',
  '.gitmodules',
] as const);

export interface ProtectedPathHit {
  readonly path: string;
  readonly pattern: string;
}

const REGEXP_SPECIAL = new Set(['\\', '^', '$', '.', '|', '+', '(', ')', '[', ']', '{', '}']);

function escapeRegExpChar(character: string): string {
  return REGEXP_SPECIAL.has(character) ? `\\${character}` : character;
}

export function globToRegExp(pattern: string): RegExp {
  if (typeof pattern !== 'string') {
    throw new TypeError('globToRegExp expects a string pattern');
  }
  let source = '^';
  let index = 0;
  while (index < pattern.length) {
    const character = pattern.charAt(index);
    if (character === '*') {
      if (pattern.charAt(index + 1) === '*') {
        if (pattern.charAt(index + 2) === '/') {
          source += '(?:.*/)?';
          index += 3;
        } else {
          source += '.*';
          index += 2;
        }
      } else {
        source += '[^/]*';
        index += 1;
      }
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      index += 1;
      continue;
    }
    source += escapeRegExpChar(character);
    index += 1;
  }
  return new RegExp(`${source}$`);
}

export function normaliseRepoPath(path: string): string {
  let normalised = path;
  while (normalised.startsWith('./')) {
    normalised = normalised.slice(2);
  }
  return normalised.replace(/\/{2,}/g, '/');
}

export function matchesGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(normaliseRepoPath(path));
}

export function scanProtectedPaths(
  paths: readonly string[],
  patterns: readonly string[],
): readonly ProtectedPathHit[] {
  const hits: ProtectedPathHit[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const normalised = normaliseRepoPath(path);
    for (const pattern of patterns) {
      if (!matchesGlob(pattern, normalised)) continue;
      const key = `${pattern}\u0000${normalised}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ path: normalised, pattern });
    }
  }
  return hits;
}
