import { describe, expect, it } from 'vitest';
import {
  SECRET_PATTERN_NAMES,
  SECRET_PATTERN_SOURCES,
  SECRET_SCAN_ALLOW_MARKER,
  formatSecretFinding,
  scanPatchForSecrets,
} from './secret-scan.js';

const GHP = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';
const PAT = 'github_pat_11ABCDEFG0123456789ABCDEFG';
const AWS = 'AKIA1234567890ABCDEF';

function singleFilePatch(path: string, added: readonly string[], startLine = 1): string {
  const body = added.map((line) => `+${line}`).join('\n');
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,0 +${startLine},${added.length} @@`,
    body,
    '',
  ].join('\n');
}

describe('secret pattern vocabulary', () => {
  it('pins the nine names in order', () => {
    expect([...SECRET_PATTERN_NAMES]).toEqual([
      'private_key',
      'github_pat',
      'github_token',
      'anthropic_key',
      'openai_key',
      'aws_access_key',
      'jwt',
      'slack_token',
      'generic_secret',
    ]);
  });

  it('pins every pattern source', () => {
    expect(SECRET_PATTERN_SOURCES).toEqual({
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
    expect(SECRET_SCAN_ALLOW_MARKER).toBe('codebox-secret-scan: allow');
  });
});

describe('scanPatchForSecrets', () => {
  const cases: readonly { pattern: (typeof SECRET_PATTERN_NAMES)[number]; line: string }[] = [
    { pattern: 'private_key', line: "const privateKey = '-----BEGIN RSA PRIVATE KEY-----';" },
    { pattern: 'github_pat', line: `const pat = '${PAT}';` },
    { pattern: 'github_token', line: `const gh = '${GHP}';` },
    { pattern: 'anthropic_key', line: "const anthropic = 'sk-ant-api03-abcdefghijklmnopqrst';" },
    { pattern: 'openai_key', line: "const openai = 'sk-proj-abcdefghijklmnopqrstuvwx';" },
    { pattern: 'aws_access_key', line: `const aws = '${AWS}';` },
    {
      pattern: 'jwt',
      line: "const bearer = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';",
    },
    { pattern: 'slack_token', line: "const slack = 'xoxb-1234567890-abcdefghijkl';" },
    { pattern: 'generic_secret', line: 'password = "s3cretValueLongEnough1"' },
  ];

  for (const entry of cases) {
    it(`finds ${entry.pattern} on its own added line`, () => {
      const findings = scanPatchForSecrets(singleFilePatch('src/keys.ts', ['const a = 1;', entry.line], 3));

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({ path: 'src/keys.ts', line: 4, pattern: entry.pattern });
      expect(JSON.stringify(findings)).not.toContain(entry.line);
    });
  }

  it('scans only added lines, never a context or a removed line', () => {
    const patch = [
      'diff --git a/src/x.ts b/src/x.ts',
      'index 1111111..2222222 100644',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,3 +1,3 @@',
      ` context ${GHP}`,
      `-removed ${GHP}`,
      '+const ok = 1;',
      '',
    ].join('\n');

    expect(scanPatchForSecrets(patch)).toEqual([]);
  });

  it('honours the allow marker and skips placeholder values', () => {
    const allow = singleFilePatch('src/x.ts', [
      `const gh = '${GHP}'; // ${SECRET_SCAN_ALLOW_MARKER}`,
    ]);
    expect(scanPatchForSecrets(allow)).toEqual([]);

    for (const value of [
      `const gh = 'ghp_example${'A'.repeat(29)}';`,
      "const anthropic = 'sk-ant-[redacted]AAAAAAAAAAAA';",
      "const aws = 'AKIACHANGEME00000000A';",
      `const pat = 'github_pat_placeholder${'A'.repeat(15)}';`,
    ]) {
      expect(scanPatchForSecrets(singleFilePatch('src/x.ts', [value])), value).toEqual([]);
    }
  });

  it('keeps every pattern that fires on one line, deduped and sorted', () => {
    const patch = [
      'diff --git a/src/z.ts b/src/z.ts',
      'index 1111111..2222222 100644',
      '--- a/src/z.ts',
      '+++ b/src/z.ts',
      '@@ -0,0 +5,2 @@',
      `+const both = '${GHP}' + '${AWS}';`,
      `+const twice = '${GHP}' + '${GHP}';`,
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +2,1 @@',
      `+const gh = '${GHP}';`,
      '',
    ].join('\n');

    const findings = scanPatchForSecrets(patch);

    expect(findings).toEqual([
      { path: 'src/a.ts', line: 2, pattern: 'github_token' },
      { path: 'src/z.ts', line: 5, pattern: 'aws_access_key' },
      { path: 'src/z.ts', line: 5, pattern: 'github_token' },
      { path: 'src/z.ts', line: 6, pattern: 'github_token' },
    ]);
  });

  it('skips a hunk whose new side is /dev/null, and strips a trailing carriage return', () => {
    const deleted = [
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,0 +0,1 @@',
      `+const gh = '${GHP}';`,
      '',
    ].join('\n');
    expect(scanPatchForSecrets(deleted)).toEqual([]);

    const crlf = `diff --git a/src/c.ts b/src/c.ts\r\n+++ b/src/c.ts\r\n@@ -0,0 +1,1 @@\r\n+const gh = '${GHP}';\r\n`;
    expect(scanPatchForSecrets(crlf)).toEqual([
      { path: 'src/c.ts', line: 1, pattern: 'github_token' },
    ]);
  });

  it('returns nothing for an empty patch or a patch without a hunk', () => {
    expect(scanPatchForSecrets('')).toEqual([]);
    expect(
      scanPatchForSecrets('diff --git a/x b/x\nold mode 100644\nnew mode 100755\n'),
    ).toEqual([]);
  });
});

describe('formatSecretFinding', () => {
  it('renders path, line and pattern and never the value', () => {
    expect(formatSecretFinding({ path: 'src/a.ts', line: 3, pattern: 'jwt' })).toBe('src/a.ts:3 jwt');
    expect(formatSecretFinding({ path: '', line: 1, pattern: 'jwt' })).toBe('(unknown):1 jwt');
  });
});
