import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', '..', 'image', 'scripts', '90-verify.sh');

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-vm-'));
  tempDirs.push(dir);
  return dir;
}

function isolatedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ROOT') continue;
    env[key] = value;
  }
  return env;
}

function stubRoot() {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'etc', 'codebox'), { recursive: true });
  fs.mkdirSync(path.join(root, 'opt'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'etc', 'codebox', 'instance.env'),
    'CB_SESSION_SECRET=[redacted]\n',
  );
  return root;
}

function run(args, extraEnv = {}) {
  return spawnSync('bash', [script, ...args], {
    env: { ...isolatedEnv(), ...extraEnv },
    encoding: 'utf8',
  });
}

function stubBrowser(root, { exitCode = 0, library = '' } = {}) {
  const dir = path.join(root, 'opt', 'ms-playwright', 'chromium-1248', 'chrome-linux64');
  fs.mkdirSync(dir, { recursive: true });
  const binary = path.join(dir, 'chrome');
  fs.writeFileSync(binary, `#!/bin/sh\nexit ${exitCode}\n`, { mode: 0o755 });
  fs.writeFileSync(
    path.join(root, 'etc', 'environment'),
    'PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright\n',
  );
  const shims = path.join(root, 'shims');
  fs.mkdirSync(shims, { recursive: true });
  fs.writeFileSync(
    path.join(shims, 'ldd'),
    library === ''
      ? '#!/bin/sh\nexit 1\n'
      : `#!/bin/sh\nprintf '\\t%s => not found\\n' '${library}'\n`,
    { mode: 0o755 },
  );
  return { binary, shims };
}

describe('90-verify.sh', () => {
  it('accepts a root whose only secret line is a placeholder', () => {
    const root = stubRoot();

    const result = run(['--root', root, '--only', 'secrets']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ok secrets\n');
  });

  it('reports the file and the pattern of a token-shaped string', () => {
    const root = stubRoot();
    // Assembled, so this file is not itself a hit for the grep it exercises.
    const pattern = ['ghp', '_'].join('');
    const leak = path.join(root, 'etc', 'leak.txt');
    fs.writeFileSync(leak, `helper --token ${pattern}AAAABBBBCCCC\n`);

    const result = run(['--root', root, '--only', 'secrets']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`fail secrets ${leak}:${pattern}\n`);
  });

  it('skips a directory that does not exist', () => {
    const root = tempDir();

    const result = run(['--root', root, '--only', 'secrets']);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ok secrets\n');
  });

  it('checks the image manifest and the placeholder rule', () => {
    const root = stubRoot();
    fs.writeFileSync(
      path.join(root, 'etc', 'codebox', 'image.json'),
      JSON.stringify({
        version: '0.1.0',
        commit: '0000000',
        builtAt: '2026-10-25T00:00:00Z',
        node: 'v24.22.1',
        opencode: '1.19.4',
        cloudflared: '2026.10.0',
      }),
    );

    expect(run(['--root', root, '--only', 'image']).stdout).toBe('ok image\n');

    fs.writeFileSync(
      path.join(root, 'etc', 'codebox', 'instance.env'),
      'CB_SESSION_SECRET=a-real-value\n',
    );
    const result = run(['--root', root, '--only', 'image']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('fail image');
    expect(result.stdout).toContain('CB_SESSION_SECRET has a value');
  });

  it('fails the browser check when /opt/ms-playwright is missing', () => {
    const root = stubRoot();

    const result = run(['--root', root, '--only', 'browser']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      `fail browser ${path.join(root, 'opt', 'ms-playwright')} is missing\n`,
    );
  });

  it('passes the browser check on a stub root with a clean ldd and a live launch', () => {
    const root = stubRoot();
    const { shims } = stubBrowser(root);

    const result = run(['--root', root, '--only', 'browser'], {
      PATH: `${shims}:${process.env.PATH}`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ok browser\n');
  });

  it('fails the browser check when the revision has no chrome binary', () => {
    const root = stubRoot();
    const revision = path.join(root, 'opt', 'ms-playwright', 'chromium-1248');
    fs.mkdirSync(path.join(revision, 'chrome-linux64'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'etc', 'environment'),
      'PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright\n',
    );

    const result = run(['--root', root, '--only', 'browser']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`fail browser no chrome binary under ${revision}\n`);
  });

  it('fails the browser check when the environment file loses the browsers path', () => {
    const root = stubRoot();
    const { shims } = stubBrowser(root);
    const environment = path.join(root, 'etc', 'environment');
    fs.writeFileSync(environment, 'PATH=/usr/local/bin:/usr/bin:/bin\n');

    const result = run(['--root', root, '--only', 'browser'], {
      PATH: `${shims}:${process.env.PATH}`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      `fail browser ${environment} does not set PLAYWRIGHT_BROWSERS_PATH\n`,
    );
  });

  it('fails the browser check when the browser exits non-zero', () => {
    const root = stubRoot();
    const { shims } = stubBrowser(root, { exitCode: 1 });

    const result = run(['--root', root, '--only', 'browser'], {
      PATH: `${shims}:${process.env.PATH}`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('fail browser headless launch failed\n');
  });

  it('fails the browser check naming a library ldd reports as not found', () => {
    const root = stubRoot();
    const { binary, shims } = stubBrowser(root, { library: 'libnss3.so' });

    const result = run(['--root', root, '--only', 'browser'], {
      PATH: `${shims}:${process.env.PATH}`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`fail browser ${binary} needs libnss3.so\n`);
  });

  it('lists browser in the default check list', () => {
    const help = run(['--help']);

    expect(help.status).toBe(0);
    expect(help.stdout).toContain('image browser');
    expect(help.stdout).toContain('(default: all)');
  });

  it('exits 2 on an unknown check and prints the checks on --help', () => {
    expect(run(['--only', 'nonsense']).status).toBe(2);

    const help = run(['--help']);

    expect(help.status).toBe(0);
    expect(help.stdout).toContain(
      'checks: runtime tools units user layout secrets image browser   (default: all)',
    );
  });
});
