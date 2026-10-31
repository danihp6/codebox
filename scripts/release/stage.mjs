#!/usr/bin/env node

// The payload of a release: what the installer unpacks under `/opt/codebox/releases/<version>`
// and what the daemon then runs. The plan is a list of trees and files, never a copy of the
// repository, so `src/`, `.git`, `coverage` and the agent's specs cannot reach an archive.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = `usage: node scripts/release/stage.mjs --out DIR [--root DIR] [--help]

  --out DIR    the staged payload to write (created if absent)
  --root DIR   the repository to read (default '.')
  --help       this text
`;

const PACKAGES = 'packages';
const NODE_MODULES = 'node_modules';

/** A missing build output or an unusable flag: the CLI exits with `exitCode`. */
export class ReleaseStageError extends Error {
  /**
   * @param {string} message
   * @param {number} exitCode
   */
  constructor(message, exitCode) {
    super(message);
    this.name = 'ReleaseStageError';
    this.exitCode = exitCode;
  }
}

/** @typedef {{ from: string, to: string }} StageEntry */

/**
 * The copy plan, in order. `from` is relative to `root`, `to` is relative to the staged tree.
 * An entry whose source is absent is skipped; `node_modules` is the one that normally is, but
 * every entry follows the rule so a partial build never becomes a broken copy.
 * @param {string} root
 * @returns {StageEntry[]}
 */
export function stagePlan(root) {
  const base = resolve(root);
  /** @type {StageEntry[]} */
  const plan = [];
  /** @param {string} from @param {string} to */
  const add = (from, to) => {
    if (existsSync(join(base, from))) plan.push({ from, to });
  };
  add('apps/daemon/dist', 'apps/daemon/dist');
  add('apps/daemon/bin', 'apps/daemon/bin');
  add('apps/daemon/package.json', 'apps/daemon/package.json');
  for (const name of packageNames(base)) {
    add(`${PACKAGES}/${name}/dist`, `${PACKAGES}/${name}/dist`);
    add(`${PACKAGES}/${name}/package.json`, `${PACKAGES}/${name}/package.json`);
  }
  // The SPA is served from `<CB_INSTALL_DIR>/app`, so the Angular browser bundle is renamed.
  add('apps/app/dist/browser', 'app');
  add(NODE_MODULES, NODE_MODULES);
  add('package.json', 'package.json');
  return plan;
}

/** @param {string} base @returns {string[]} */
function packageNames(base) {
  const dir = join(base, PACKAGES);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Copy the plan into `out`, replacing whatever was there so a rebuild is the tree and nothing
 * else. Symlinks are copied as symlinks: `node_modules/@codebox/*` are relative links into
 * `packages/` and must keep resolving inside the staged tree.
 * @param {{ root: string, out: string }} input
 * @returns {Promise<{ files: number }>}
 */
export async function stageRelease(input) {
  const root = resolve(input.root);
  const out = resolve(input.out);
  for (const required of ['apps/daemon/dist/main.js', 'apps/app/dist/browser/index.html']) {
    if (!existsSync(join(root, required))) {
      throw new ReleaseStageError(`missing build output ${required} under ${root}`, 4);
    }
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const entry of stagePlan(root)) {
    const target = join(out, entry.to);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, entry.from), target, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      force: true,
    });
  }
  return { files: countFiles(out) };
}

/** Regular files only: a symlink is a link the archive carries, not a payload file. */
function countFiles(dir) {
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files += countFiles(join(dir, entry.name));
    else if (entry.isFile()) files += 1;
  }
  return files;
}

function parseArgs(argv) {
  const options = { out: null, root: '.', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (flag !== '--out' && flag !== '--root') {
      throw new ReleaseStageError(`unknown option '${arg}'\n\n${USAGE}`, 2);
    }
    let value;
    if (equals === -1) {
      value = argv[index + 1];
      index += 1;
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === undefined || value === '') {
      throw new ReleaseStageError(`'${flag}' needs a value\n\n${USAGE}`, 2);
    }
    if (flag === '--out') options.out = value;
    else options.root = value;
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error.exitCode;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (options.out === null) {
    process.stderr.write(`--out is required\n\n${USAGE}`);
    return 2;
  }
  try {
    const result = await stageRelease({ root: options.root, out: options.out });
    process.stdout.write(`staged ${result.files} files into ${resolve(options.out)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error instanceof ReleaseStageError ? error.exitCode : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
