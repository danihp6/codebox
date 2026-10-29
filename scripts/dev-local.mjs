#!/usr/bin/env node

// The local loop in one command: build the app and the daemon, point the daemon at the
// bundle, start it and mint a pairing code. There is no dev-server proxy — the app asks
// `/v1` on its own origin (`src/app/core/api/http.ts`), so the daemon is what serves the
// build, from `<CB_INSTALL_DIR>/app` (`apps/daemon/src/main.ts`).
//
// Configuration is `.env` at the repository root, read the way Node reads an env file: a
// variable already present in the environment wins over the file. Neither `.env` nor
// `.state/` is committed.
//
// Usage:
//   node scripts/dev-local.mjs                 build, start, print a pairing code
//   node scripts/dev-local.mjs --no-build      start what is already built
//   node scripts/dev-local.mjs --fresh         wipe CB_STATE_DIR first (devices, runs, chats)
//   node scripts/dev-local.mjs --port 8790     listen somewhere else
//   node scripts/dev-local.mjs --open          open the browser on the pairing screen
//   node scripts/dev-local.mjs --no-pair       skip the pairing code

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_BROWSER_DIR = join(ROOT, 'apps', 'app', 'dist', 'browser');
const DAEMON_ENTRY = join(ROOT, 'apps', 'daemon', 'dist', 'main.js');
const CB_ENTRY = join(ROOT, 'apps', 'daemon', 'bin', 'cb.mjs');
const HEALTH_TIMEOUT_MS = 40_000;
const HEALTH_POLL_MS = 400;

const USAGE = `usage: node scripts/dev-local.mjs [options]

  --no-build        skip the app and daemon builds
  --fresh           wipe CB_STATE_DIR before starting (devices, chats and runs go too)
  --no-pair         do not mint a pairing code
  --open            open the browser on the pairing screen
  --port <number>   listen on this port instead of CB_BIND's
  --help            this text
`;

export class UsageError extends Error {}

/** Flags only: every value comes from `.env` or its default. Throws on unknown input. */
export function parseArgs(argv) {
  const options = { build: true, fresh: false, pair: true, open: false, port: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-build') options.build = false;
    else if (arg === '--fresh') options.fresh = true;
    else if (arg === '--no-pair') options.pair = false;
    else if (arg === '--open') options.open = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--port') {
      options.port = parsePort(argv[index + 1], '--port');
      index += 1;
    } else if (arg.startsWith('--port=')) options.port = parsePort(arg.slice(7), '--port');
    else throw new UsageError(`unknown option '${arg}'`);
  }
  return options;
}

function parsePort(value, flag) {
  if (value === undefined || !/^\d{1,5}$/.test(value)) {
    throw new UsageError(`${flag} needs a numeric port, got '${value ?? ''}'`);
  }
  const port = Number(value);
  if (port < 1 || port > 65535) throw new UsageError(`${flag} is out of range: ${port}`);
  return port;
}

/** The port half of `127.0.0.1:8787`, `[::1]:8787` or the default. */
export function bindPort(bind) {
  const text = bind === undefined || bind === '' ? '127.0.0.1:8787' : bind;
  const index = text.lastIndexOf(':');
  const raw = index === -1 ? '' : text.slice(index + 1);
  if (!/^\d{1,5}$/.test(raw)) throw new UsageError(`CB_BIND is not host:port: '${text}'`);
  return Number(raw);
}

/**
 * `--port` moves the listen address, the public URL and the allowed origins together: the
 * browser sends an Origin on every POST and the daemon answers 403 when it is not allowed.
 */
export function withPort(env, port) {
  if (port === null) return env;
  const base = `http://127.0.0.1:${port}`;
  return {
    ...env,
    CB_BIND: `127.0.0.1:${port}`,
    CB_PUBLIC_URL: base,
    CB_ALLOWED_ORIGINS: `${base},http://localhost:${port}`,
  };
}

/** The origin the browser opens: `CB_PUBLIC_URL`, or loopback and the listened port. */
export function baseUrlOf(env) {
  const publicUrl = env.CB_PUBLIC_URL;
  if (publicUrl !== undefined && publicUrl !== '') return publicUrl.replace(/\/+$/, '');
  return `http://127.0.0.1:${bindPort(env.CB_BIND)}`;
}

/** `<CB_INSTALL_DIR>/app`, where `apps/daemon/src/main.ts` looks for the SPA. */
export function appLinkPath(env) {
  const installDir =
    env.CB_INSTALL_DIR === undefined || env.CB_INSTALL_DIR === ''
      ? join(ROOT, '.state', 'install')
      : resolvePath(env.CB_INSTALL_DIR);
  return join(installDir, 'app');
}

function resolvePath(path) {
  return isAbsolute(path) ? path : resolve(ROOT, path);
}

function stateDirOf(env) {
  return resolvePath(env.CB_STATE_DIR ?? join('.state'));
}

function loadEnvFile() {
  try {
    process.loadEnvFile(join(ROOT, '.env'));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function run(label, args) {
  process.stdout.write(`\n> ${label}\n`);
  const [command, commandArgs] = npmInvocation(args);
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

/** `npm` is a `.cmd` shim on Windows, and `shell: true` would concatenate the arguments. */
function npmInvocation(args) {
  if (process.platform !== 'win32') return ['npm', args];
  return [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`]];
}

/**
 * A junction on Windows and a directory symlink elsewhere, so a rebuild never needs a copy.
 * A tree without symlink rights (Windows without developer mode) falls back to copying.
 */
function linkApp(installDir) {
  mkdirSync(installDir, { recursive: true });
  const link = join(installDir, 'app');
  removeLink(link);
  try {
    symlinkSync(APP_BROWSER_DIR, link, process.platform === 'win32' ? 'junction' : 'dir');
    return 'linked';
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES' && error.code !== 'ENOSYS') throw error;
    cpSync(APP_BROWSER_DIR, link, { recursive: true });
    return 'copied';
  }
}

function removeLink(link) {
  try {
    const stats = lstatSync(link);
    if (stats.isSymbolicLink()) unlinkSync(link);
    else rmSync(link, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function isListening(base) {
  try {
    await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(base, child) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the daemon exited with code ${child.exitCode} before answering`);
    }
    if (await isListening(base)) return;
    await sleep(HEALTH_POLL_MS);
  }
  throw new Error(`the daemon did not answer ${base}/v1/health in ${HEALTH_TIMEOUT_MS} ms`);
}

function mintPairingCode(base) {
  const result = spawnSync(process.execPath, [CB_ENTRY, 'pair', '--name', 'Local dev'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CODEBOX_URL: base },
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const loaded = loadEnvFile();
  const env = withPort({ ...process.env }, options.port);
  const base = baseUrlOf(env);
  const stateDir = stateDirOf(env);
  const linkPath = appLinkPath(env);

  process.stdout.write(`codebox local\n`);
  process.stdout.write(`  root    ${ROOT}\n`);
  process.stdout.write(`  env     ${loaded ? '.env' : 'none (.env is missing)'}\n`);
  process.stdout.write(`  state   ${stateDir}\n`);
  process.stdout.write(`  url     ${base}\n`);

  if (await isListening(base)) {
    throw new Error(`${base} already answers; stop that daemon or pass --port`);
  }

  if (options.fresh) {
    if (resolve(stateDir) === ROOT) throw new Error('refusing to wipe the repository root');
    process.stdout.write(`  fresh   removing ${stateDir}\n`);
    rmSync(stateDir, { recursive: true, force: true });
  }

  if (options.build) {
    run('building the app', ['run', 'build', '-w', '@codebox/app']);
    run('building the daemon', ['run', 'build', '-w', '@codebox/daemon']);
  }

  const link = linkApp(dirname(linkPath));
  process.stdout.write(`  served  ${linkPath} (${link})\n`);

  process.stdout.write(`\n> starting the daemon\n`);
  const child = spawn(process.execPath, [DAEMON_ENTRY], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  const exited = new Promise((resolveExit) => {
    process.once('SIGINT', () => child.kill());
    process.once('SIGTERM', () => child.kill());
    child.once('error', (error) => {
      process.stderr.write(`${error.message}\n`);
      resolveExit(1);
    });
    child.once('exit', (code) => resolveExit(code ?? 0));
  });

  try {
    await waitForHealth(base, child);
  } catch (error) {
    child.kill();
    throw error;
  }

  process.stdout.write(`\n  ready   ${base}\n`);
  if (options.pair) printPairing(base);
  if (options.open) openBrowser(`${base}/pair`);
  process.stdout.write('\n  Ctrl+C stops it.\n');

  return await exited;
}

function printPairing(base) {
  const pairing = mintPairingCode(base);
  if (pairing === null) {
    process.stderr.write('  pair    could not mint a code (see the error above)\n');
    return;
  }
  process.stdout.write(`${pairing}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (error instanceof UsageError) {
        process.stderr.write(`${error.message}\n\n${USAGE}`);
        process.exitCode = 2;
        return;
      }
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
