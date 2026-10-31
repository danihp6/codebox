#!/usr/bin/env node

// One release artifact, twice the same. The archive is a function of the staged tree and the
// three inputs the workflow pins (`--version`, `--built-at`, `--commit`): entries sorted by
// name, every mtime the commit's, owner and group 0, GNU format, and gzip with no name and no
// timestamp. Two builds of the same tree therefore have the same sha256, which is what makes
// the published checksum worth signing.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = `usage: node scripts/release/build.mjs --stage DIR --out DIR --version V --built-at ISO
                               [--commit SHA] [--check-package-version] [--root DIR] [--help]

  --stage DIR    the payload to archive (the output of stage.mjs)
  --out DIR      where the artifact and its checksum are written (created if absent)
  --version V    the release version, without a leading 'v'
  --built-at ISO the archive mtime and release.json time, e.g. 2026-01-01T00:00:00Z
  --commit SHA   the commit the artifact was built from (default: none)
  --check-package-version  fail when <root>/package.json disagrees with --version
  --root DIR     the repository --check-package-version reads (default '.')
  --help         this text
`;

export const ARTIFACT_PREFIX = 'codebox-';
export const MANIFEST_NAME = 'release.json';

/** @typedef {{ readonly stage: string, readonly out: string, readonly version: string,
 *              readonly builtAt: string, readonly commit?: string | null }} BuildReleaseInput
 *  @typedef {{ readonly archive: string, readonly checksumFile: string,
 *              readonly sha256: string }} BuildReleaseResult */

/** A refusal the CLI reports itself: `exitCode` is the frozen contract. */
export class ReleaseBuildError extends Error {
  /**
   * @param {string} message
   * @param {number} exitCode
   */
  constructor(message, exitCode) {
    super(message);
    this.name = 'ReleaseBuildError';
    this.exitCode = exitCode;
  }
}

/** @param {string} version @returns {string} */
export function artifactName(version) {
  return `${ARTIFACT_PREFIX}${version}.tar.gz`;
}

/** @param {string} version @returns {string} */
export function checksumName(version) {
  return `${artifactName(version)}.sha256`;
}

/**
 * The manifest inside the archive, byte for byte: keys in the order version, commit, builtAt,
 * and a trailing newline so the file is a line like every other one we write.
 * @param {{ version: string, commit: string | null, builtAt: string }} input
 * @returns {string}
 */
export function manifestJson(input) {
  return `${JSON.stringify({
    version: input.version,
    commit: input.commit ?? null,
    builtAt: input.builtAt,
  })}\n`;
}

/**
 * Write `<out>/codebox-<version>.tar.gz` and its `sha256sum` file. `release.json` is created
 * inside the stage for the length of the archive and removed afterwards, so the caller's tree
 * is unchanged even when tar fails.
 * @param {BuildReleaseInput} input
 * @returns {Promise<BuildReleaseResult>}
 */
export async function buildRelease(input) {
  const stage = resolve(input.stage);
  const out = resolve(input.out);
  if (input.version === undefined || input.version === '') {
    throw new ReleaseBuildError('--version is empty', 2);
  }
  const epoch = epochOf(input.builtAt);
  if (epoch === null) {
    throw new ReleaseBuildError(`--built-at is not an ISO 8601 time: '${input.builtAt}'`, 2);
  }
  for (const required of ['apps/daemon/dist/main.js', 'app/index.html']) {
    if (!existsSync(join(stage, required))) {
      throw new ReleaseBuildError(`stage is missing ${required} under ${stage}`, 4);
    }
  }

  mkdirSync(out, { recursive: true });
  const manifest = join(stage, MANIFEST_NAME);
  writeFileSync(
    manifest,
    manifestJson({
      version: input.version,
      commit: input.commit ?? null,
      builtAt: input.builtAt,
    }),
  );
  try {
    const archive = join(out, artifactName(input.version));
    await writeArchive(stage, archive, epoch);
    const sha256 = hashFile(archive);
    const checksumFile = join(out, checksumName(input.version));
    writeFileSync(checksumFile, `${sha256}  ${artifactName(input.version)}\n`);
    return { archive, checksumFile, sha256 };
  } finally {
    rmSync(manifest, { force: true });
  }
}

/** @param {string} builtAt @returns {number | null} */
function epochOf(builtAt) {
  if (typeof builtAt !== 'string' || builtAt === '') return null;
  const time = Date.parse(builtAt);
  return Number.isNaN(time) ? null : Math.floor(time / 1000);
}

/** @param {string} file @returns {string} */
function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** @param {number} epoch @returns {string[]} */
function tarArgs(epoch) {
  return [
    '--sort=name',
    `--mtime=@${epoch}`,
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--format=gnu',
    '-cf',
    '-',
    '.',
  ];
}

/**
 * `tar … | gzip -n -9` into the artifact, without a shell: the arguments above are the
 * determinism and a shell would need quoting to keep them.
 * @param {string} stage @param {string} archive @param {number} epoch
 * @returns {Promise<void>}
 */
async function writeArchive(stage, archive, epoch) {
  const tar = spawn('tar', tarArgs(epoch), { cwd: stage, stdio: ['ignore', 'pipe', 'pipe'] });
  const gzip = spawn('gzip', ['-n', '-9'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const output = createWriteStream(archive);
  const tarStderr = collect(tar.stderr);
  const gzipStderr = collect(gzip.stderr);
  // tar exiting first closes gzip's stdin; that is a failure to report, not a crash to throw.
  gzip.stdin.on('error', () => {});
  tar.stdout.pipe(gzip.stdin);
  gzip.stdout.pipe(output);

  try {
    const [tarCode, gzipCode] = await Promise.all([
      waitFor(tar),
      waitFor(gzip),
      waitForStream(output),
    ]);
    if (tarCode !== 0) throw new ReleaseBuildError(`tar failed (${tarCode}): ${tarStderr()}`, 5);
    if (gzipCode !== 0)
      throw new ReleaseBuildError(`gzip failed (${gzipCode}): ${gzipStderr()}`, 5);
  } catch (error) {
    rmSync(archive, { force: true });
    throw error instanceof ReleaseBuildError
      ? error
      : new ReleaseBuildError(`cannot write ${basename(archive)}: ${error.message}`, 5);
  }
}

/** @param {import('node:stream').Readable} stream */
function collect(stream) {
  let text = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    text += chunk;
  });
  return () => text.trim();
}

/** @param {import('node:child_process').ChildProcess} child @returns {Promise<number>} */
function waitFor(child) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolvePromise(code ?? 1));
  });
}

/** @param {import('node:fs').WriteStream} stream @returns {Promise<void>} */
function waitForStream(stream) {
  return new Promise((resolvePromise, reject) => {
    stream.once('error', reject);
    stream.once('finish', () => resolvePromise());
  });
}

function parseArgs(argv) {
  const options = {
    stage: null,
    out: null,
    version: null,
    builtAt: null,
    commit: null,
    checkPackageVersion: false,
    root: '.',
    help: false,
  };
  const valued = new Set(['--stage', '--out', '--version', '--built-at', '--commit', '--root']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--check-package-version') {
      options.checkPackageVersion = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (!valued.has(flag)) {
      throw new ReleaseBuildError(`unknown option '${arg}'\n\n${USAGE}`, 2);
    }
    let value;
    if (equals === -1) {
      value = argv[index + 1];
      index += 1;
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === undefined || value === '') {
      throw new ReleaseBuildError(`'${flag}' needs a value\n\n${USAGE}`, 2);
    }
    if (flag === '--stage') options.stage = value;
    else if (flag === '--out') options.out = value;
    else if (flag === '--version') options.version = value;
    else if (flag === '--built-at') options.builtAt = value;
    else if (flag === '--commit') options.commit = value;
    else options.root = value;
  }
  return options;
}

/**
 * The tag and the tree must agree, and they must disagree loudly: a mismatch names the file
 * and both versions and exits 3 before anything is written.
 * @param {string} root @param {string} version
 */
function checkPackageVersion(root, version) {
  const file = join(resolve(root), 'package.json');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ReleaseBuildError(`cannot read ${file}: ${error.message}`, 2);
  }
  if (parsed.version !== version) {
    throw new ReleaseBuildError(
      `package.json version ${parsed.version} does not match --version ${version}`,
      3,
    );
  }
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
  if (
    options.stage === null ||
    options.out === null ||
    options.version === null ||
    options.builtAt === null
  ) {
    process.stderr.write(`--stage, --out, --version and --built-at are required\n\n${USAGE}`);
    return 2;
  }
  try {
    if (options.checkPackageVersion) checkPackageVersion(options.root, options.version);
    const result = await buildRelease({
      stage: options.stage,
      out: options.out,
      version: options.version,
      builtAt: options.builtAt,
      commit: options.commit,
    });
    process.stdout.write(`${result.archive}\n${result.sha256}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error instanceof ReleaseBuildError ? error.exitCode : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
