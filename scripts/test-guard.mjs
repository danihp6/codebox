#!/usr/bin/env node

// The root gate's coverage check, in a file instead of a `node -e` program: npm hands a
// script to `cmd.exe` on Windows, which ignores single quotes, so the inline program only
// ever ran on POSIX. The decision is `auditWorkspaces` (pure, tested); `listWorkspaces`
// and `main` are the only parts that touch the disk.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {object} GuardWorkspace
 * @property {string} dir        repository-relative, e.g. 'apps/app'
 * @property {string} name       that workspace's package.json name, e.g. '@codebox/app'
 * @property {string | null} test its scripts.test, or null when it declares none
 */

/**
 * @param {object} input
 * @param {string} input.gate            the root `test` and `test:app` scripts, joined
 * @param {string} input.vitest          contents of vitest.config.ts
 * @param {readonly GuardWorkspace[]} input.workspaces
 * @returns {{ covered: string[], problems: string[] }}
 */
export function auditWorkspaces({ gate, vitest, workspaces }) {
  const covered = [];
  const problems = [];
  for (const workspace of workspaces) {
    if (workspace.test === null) continue;
    const { dir, name } = workspace;
    // The lookahead keeps `-w @codebox/app` from matching `@codebox/application`.
    const byNpm = new RegExp(`(?:-w|--workspace)[= ]${name}(?![\\w@/.-])`).test(gate);
    const byVitest = vitest.includes(`./${dir}`) || vitest.includes(dir);
    if (byNpm && byVitest) {
      problems.push(
        `${dir}: the gate runs its test script twice (vitest project and npm --workspace)`,
      );
    } else if (!byNpm && !byVitest) {
      problems.push(`${dir}: has a test script but the gate does not run it`);
    } else {
      covered.push(`${dir} (${byNpm ? 'npm --workspace' : 'vitest project'})`);
    }
  }
  return { covered, problems };
}

/**
 * @param {readonly string[]} patterns the root `workspaces` array
 * @returns {GuardWorkspace[]} sorted by `dir`
 */
export function listWorkspaces(patterns) {
  const dirs = patterns.flatMap((pattern) => {
    const at = pattern.indexOf('/*');
    if (at === -1) return [pattern];
    const prefix = pattern.slice(0, at);
    return readdirSync(prefix, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${prefix}/${entry.name}`)
      .filter((dir) => existsSync(`${dir}/package.json`));
  });
  return dirs
    .map((dir) => {
      const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
      return {
        dir,
        name: pkg.name,
        test: typeof pkg.scripts?.test === 'string' ? pkg.scripts.test : null,
      };
    })
    .sort((left, right) => (left.dir < right.dir ? -1 : left.dir > right.dir ? 1 : 0));
}

function main() {
  const root = JSON.parse(readFileSync('package.json', 'utf8'));
  const gate = [root.scripts?.test, root.scripts?.['test:app']].filter(Boolean).join(' ');
  const vitest = readFileSync('vitest.config.ts', 'utf8');
  const { covered, problems } = auditWorkspaces({
    gate,
    vitest,
    workspaces: listWorkspaces(root.workspaces ?? []),
  });

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`test:guard: ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `test:guard: ${covered.length} workspace(s) covered — ${covered.join(', ')}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
