export const SECRET_PATTERN_NAMES = [
  'private_key',
  'github_pat',
  'github_token',
  'anthropic_key',
  'openai_key',
  'aws_access_key',
  'jwt',
  'slack_token',
  'generic_secret',
] as const;

export type SecretPatternName = (typeof SECRET_PATTERN_NAMES)[number];

export const SECRET_PATTERN_SOURCES: Readonly<Record<SecretPatternName, string>> = Object.freeze({
  private_key: '-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----',
  github_pat: '\\bgithub_pat_[A-Za-z0-9_]{22,}\\b',
  github_token: '\\bgh[pousr]_[A-Za-z0-9]{36}\\b',
  anthropic_key: '\\bsk-ant-[A-Za-z0-9_-]{20,}\\b',
  openai_key: '\\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\\b',
  aws_access_key: '\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b',
  jwt: '\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b',
  slack_token: '\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b',
  generic_secret:
    '\\b(?:api[_-]?key|secret|token|password)\\b\\s*[:=]\\s*["\'][A-Za-z0-9_./+=-]{16,}["\']',
});

export const SECRET_SCAN_ALLOW_MARKER = 'codebox-secret-scan: allow';

export const SECRET_PLACEHOLDERS: readonly string[] = Object.freeze([
  '[redacted]',
  'example',
  'placeholder',
  'changeme',
  'dummy',
  'replace',
  'your_',
  'xxxx',
]);

export interface SecretFinding {
  readonly path: string;
  readonly line: number;
  readonly pattern: SecretPatternName;
}

const CASE_INSENSITIVE_PATTERNS: readonly SecretPatternName[] = Object.freeze(['generic_secret']);

const COMPILED: Readonly<Record<SecretPatternName, RegExp>> = Object.freeze(
  Object.fromEntries(
    SECRET_PATTERN_NAMES.map((name) => {
      const flags = CASE_INSENSITIVE_PATTERNS.includes(name) ? 'gi' : 'g';
      return [name, new RegExp(SECRET_PATTERN_SOURCES[name], flags)];
    }),
  ) as Record<SecretPatternName, RegExp>,
);

const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const DEV_NULL = '/dev/null';
const B_PREFIX = 'b/';

function stripDiffPrefix(target: string): string {
  return target.startsWith(B_PREFIX) ? target.slice(B_PREFIX.length) : target;
}

function isPlaceholder(matched: string): boolean {
  const lowered = matched.toLowerCase();
  return SECRET_PLACEHOLDERS.some((placeholder) => lowered.includes(placeholder));
}

function scanLine(
  path: string,
  line: number,
  text: string,
  found: Map<string, SecretFinding>,
): void {
  for (const name of SECRET_PATTERN_NAMES) {
    const pattern = COMPILED[name];
    pattern.lastIndex = 0;
    for (;;) {
      const match = pattern.exec(text);
      if (match === null) break;
      if (match[0] === '') {
        pattern.lastIndex += 1;
        continue;
      }
      if (isPlaceholder(match[0])) continue;
      const key = `${path}\u0000${line}\u0000${name}`;
      if (!found.has(key)) found.set(key, { path, line, pattern: name });
    }
  }
}

/**
 * Only added lines are scanned: a secret that already lived in the file is not this diff's
 * fault, and a removal is the fix.
 */
export function scanPatchForSecrets(patch: string): readonly SecretFinding[] {
  const found = new Map<string, SecretFinding>();
  let pendingPath: string | null = null;
  let currentPath: string | null = null;
  let nextLine = 0;

  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) {
      pendingPath = DIFF_HEADER.exec(line)?.[2] ?? null;
      currentPath = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      currentPath = target === DEV_NULL ? null : stripDiffPrefix(target);
      if (target === DEV_NULL) pendingPath = null;
      continue;
    }
    if (line.startsWith('@@')) {
      const header = HUNK_HEADER.exec(line);
      if (header === null) continue;
      nextLine = Number(header[1]);
      if (currentPath === null && pendingPath !== null) currentPath = pendingPath;
      continue;
    }
    if (line.startsWith('+')) {
      const text = line.slice(1);
      if (currentPath !== null && !text.includes(SECRET_SCAN_ALLOW_MARKER)) {
        scanLine(currentPath, nextLine, text, found);
      }
      nextLine += 1;
      continue;
    }
    if (line.startsWith(' ')) nextLine += 1;
  }

  return [...found.values()].sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1;
    if (left.line !== right.line) return left.line - right.line;
    if (left.pattern === right.pattern) return 0;
    return left.pattern < right.pattern ? -1 : 1;
  });
}

export function formatSecretFinding(finding: SecretFinding): string {
  return `${finding.path === '' ? '(unknown)' : finding.path}:${finding.line} ${finding.pattern}`;
}
