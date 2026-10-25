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

function run(args) {
  return spawnSync('bash', [script, ...args], { env: isolatedEnv(), encoding: 'utf8' });
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

  it('exits 2 on an unknown check and prints the checks on --help', () => {
    expect(run(['--only', 'nonsense']).status).toBe(2);

    const help = run(['--help']);

    expect(help.status).toBe(0);
    expect(help.stdout).toContain(
      'checks: runtime tools units user layout secrets image   (default: all)',
    );
  });
});
