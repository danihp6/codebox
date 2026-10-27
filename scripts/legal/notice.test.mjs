import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  COPYLEFT_EXCEPTIONS,
  checkNotice,
  collectProductionPackages,
  isCopyleftOnly,
  renderNotice,
} from './notice.mjs';

const rootPath = fileURLToPath(new URL('../../', import.meta.url));
const lockfile = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
const packages = collectProductionPackages(lockfile);
const notice = readFileSync(new URL('../../NOTICE', import.meta.url), 'utf8');

const BLOCK_START = 'This distribution includes the following third-party packages:';
const BLOCK_END = 'Copyleft exceptions';
const packageBlock = () => {
  const lines = notice.split('\n');
  const start = lines.indexOf(BLOCK_START);
  const end = lines.indexOf(BLOCK_END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start + 1, end).filter((line) => line.startsWith('- '));
};

describe('NOTICE', () => {
  it('NOTICE matches the lockfile', () => {
    expect(notice).toBe(renderNotice(collectProductionPackages(lockfile)));
  });

  it('every production package appears exactly once', () => {
    const lines = packageBlock();
    for (const pkg of packages) {
      const marker = `- ${pkg.name}@${pkg.version} — `;
      const occurrences = lines.filter((line) => line.startsWith(marker)).length;
      expect(occurrences, `${pkg.name}@${pkg.version}`).toBe(1);
    }
    expect(lines).toHaveLength(packages.length);
  });

  it('the production tree carries the shipped roots', () => {
    const ids = new Set(packages.map((pkg) => `${pkg.name}@${pkg.version}`));
    for (const id of [
      '@angular/core@22.2.3',
      '@ionic/angular@9.0.9',
      '@capacitor/core@8.5.3',
      '@hono/node-server@2.1.5',
      'hono@4.13.13',
      'zod@4.6.7',
      'rxjs@7.8.2',
      'tslib@2.8.1',
      'ionicons@8.1.0',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('no production package has an unknown licence', () => {
    for (const pkg of packages) {
      expect(typeof pkg.license, pkg.name).toBe('string');
      expect(pkg.license.trim().length, pkg.name).toBeGreaterThan(0);
      expect(pkg.license, pkg.name).not.toBe('UNKNOWN');
    }
  });

  it('no copyleft-only package ships without a written exception', () => {
    const lines = packageBlock();
    for (const pkg of packages) {
      if (!isCopyleftOnly(pkg.license)) continue;
      const reason = COPYLEFT_EXCEPTIONS[pkg.name];
      expect(typeof reason, pkg.name).toBe('string');
      expect(reason.trim().length, pkg.name).toBeGreaterThan(0);
      expect(reason, pkg.name).toBe(reason.trim());
      const line = lines.find((candidate) => candidate.startsWith(`- ${pkg.name}@${pkg.version} — `));
      expect(line, pkg.name).toBeDefined();
      expect(line, pkg.name).toContain(` — exception: ${reason}`);
    }
    const names = new Set(packages.map((pkg) => pkg.name));
    for (const name of Object.keys(COPYLEFT_EXCEPTIONS)) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it('the generator is deterministic', () => {
    expect(collectProductionPackages(lockfile)).toEqual(collectProductionPackages(lockfile));
    expect(renderNotice(packages)).toBe(renderNotice(packages));
  });

  it('--check detects drift', () => {
    expect(checkNotice(packages, renderNotice(packages))).toBe(true);
    expect(checkNotice(packages, `${renderNotice(packages)}\n`)).toBe(false);
    expect(() =>
      execFileSync(process.execPath, ['scripts/legal/notice.mjs', '--check'], {
        cwd: rootPath,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
