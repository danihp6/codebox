import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'cloud-init.sh');
const instanceId = 'ocid1.instance.oc1..ABCDEF12';
// Dummy values only: no fixture in this repository carries a real credential.
const tunnelToken = {
  a: 'acct',
  t: '11111111-2222-3333-4444-555555555555',
  s: 'tunnel-secret-value',
};

const ocids = {
  githubApp: 'ocid1.vaultsecret.oc1..github-app',
  sessionSecret: 'ocid1.vaultsecret.oc1..session-secret',
  tunnelToken: 'ocid1.vaultsecret.oc1..tunnel-token',
  providerKeys: 'ocid1.vaultsecret.oc1..provider-keys',
};

const payloads = {
  [ocids.githubApp]: 'dummy-github-app-key-material',
  [ocids.sessionSecret]: 'dummy-session-secret-value',
  [ocids.tunnelToken]: JSON.stringify(tunnelToken),
  [ocids.providerKeys]: 'ANTHROPIC_API_KEY=not-a-real-key\nOPENAI_API_KEY=not-a-real-key-either\n',
};

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-vm-'));
  tempDirs.push(dir);
  return dir;
}

// The fixture answers one secret bundle per OCID and records every call, so the test can prove
// the script reads each secret exactly once and nothing else.
function fakeOci(mode = 'ok') {
  const dir = tempDir();
  const file = path.join(dir, 'oci');
  const cases = Object.entries(payloads).map(([ocid, payload]) => {
    if (mode === 'fail-tunnel' && ocid === ocids.tunnelToken) {
      return `    ${ocid}) printf 'the vault refused\\n' >&2; exit 1 ;;`;
    }
    const encoded = Buffer.from(payload, 'utf8').toString('base64');
    return `    ${ocid}) printf '%s\\n' '${encoded}' ;;`;
  });
  fs.writeFileSync(
    file,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> "$CB_FAKE_OCI_LOG"`,
      'secret=',
      'while [ $# -gt 0 ]; do',
      '  if [ "$1" = "--secret-id" ]; then secret=$2; fi',
      '  shift',
      'done',
      'case "$secret" in',
      ...cases,
      `  *) printf 'unexpected secret %s\\n' "$secret" >&2; exit 97 ;;`,
      'esac',
      '',
    ].join('\n'),
  );
  fs.chmodSync(file, 0o755);
  return {
    dir,
    log: path.join(dir, 'oci.log'),
    path: `${dir}${path.delimiter}${process.env.PATH ?? ''}`,
  };
}

function isolatedEnv() {
  const env = {};
  const dropped = ['ROOT', 'CB_FAKE_OCI_LOG'];
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CB_') || key.startsWith('OCI_') || dropped.includes(key)) continue;
    env[key] = value;
  }
  return env;
}

function baseEnv(fake) {
  return {
    ...isolatedEnv(),
    CB_VAULT_REGION: 'eu-madrid-1',
    CB_INSTANCE_NAME: 'cb-test',
    CB_PUBLIC_URL: 'https://cb.example.com',
    CB_VAULT_GITHUB_APP_SECRET_OCID: ocids.githubApp,
    CB_VAULT_SESSION_SECRET_OCID: ocids.sessionSecret,
    CB_VAULT_TUNNEL_TOKEN_OCID: ocids.tunnelToken,
    CB_VAULT_PROVIDER_KEYS_OCID: ocids.providerKeys,
    CB_FAKE_OCI_LOG: fake.log,
    PATH: fake.path,
  };
}

function run(args, env) {
  return spawnSync('bash', [script, ...args], { env, encoding: 'utf8', timeout: 30_000 });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function bootLines(root) {
  const file = path.join(root, 'var', 'lib', 'codebox', 'first-boot.jsonl');
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

describe('cloud-init idempotency', () => {
  it('cloud-init idempotency: a second boot rewrites the same bytes and appends one line', () => {
    const fake = fakeOci();
    const root = tempDir();
    const args = ['--root', root, '--no-services', '--instance-id', instanceId];

    const first = run(args, baseEnv(fake));
    expect(first.status).toBe(0);
    expect(first.stderr).not.toContain('tunnel-secret-value');
    expect(first.stdout).not.toContain('tunnel-secret-value');

    const instanceEnv = path.join(root, 'etc', 'codebox', 'instance.env');
    const config = path.join(root, 'etc', 'cloudflared', 'config.yml');
    const firstHashes = { env: sha256(instanceEnv), config: sha256(config) };

    const second = run(args, baseEnv(fake));
    expect(second.status).toBe(0);
    expect(second.stderr).not.toContain('tunnel-secret-value');
    expect(second.stdout).not.toContain('tunnel-secret-value');

    expect(sha256(instanceEnv)).toBe(firstHashes.env);
    expect(sha256(config)).toBe(firstHashes.config);

    const lines = bootLines(root);
    expect(lines).toHaveLength(2);
    const records = lines.map((line) => JSON.parse(line));
    for (const record of records) expect(record.result).toBe('ok');
    expect(records[0].ts).not.toBe(records[1].ts);

    const hosts = fs
      .readFileSync(path.join(root, 'etc', 'hosts'), 'utf8')
      .split('\n')
      .filter((line) => line === '127.0.1.1 cb-abcdef12');
    expect(hosts).toHaveLength(1);

    const calls = fs
      .readFileSync(fake.log, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    expect(calls).toHaveLength(8);
    for (const ocid of Object.values(ocids)) {
      expect(calls.filter((line) => line.includes(`--secret-id ${ocid}`))).toHaveLength(2);
    }
  });

  it('cloud-init idempotency: instance.env carries the documented keys in order', () => {
    const fake = fakeOci();
    const root = tempDir();

    const result = run(
      ['--root', root, '--no-services', '--instance-id', instanceId],
      baseEnv(fake),
    );

    expect(result.status).toBe(0);
    const lines = fs
      .readFileSync(path.join(root, 'etc', 'codebox', 'instance.env'), 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    expect(lines.map((line) => line.split('=')[0])).toEqual([
      'CB_ENV',
      'CB_INSTANCE_NAME',
      'CB_PUBLIC_URL',
      'CB_GITHUB_APP_PRIVATE_KEY_BASE64',
      'CB_SESSION_SECRET',
      'CB_TUNNEL_TOKEN',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
    ]);
    expect(lines[0]).toBe('CB_ENV=production');
    expect(lines[1]).toBe('CB_INSTANCE_NAME=cb-test');
    expect(lines[2]).toBe('CB_PUBLIC_URL=https://cb.example.com');
  });

  it('cloud-init idempotency: the tunnel credentials are rendered without echoing them', () => {
    const fake = fakeOci();
    const root = tempDir();

    const result = run(
      ['--root', root, '--no-services', '--instance-id', instanceId],
      baseEnv(fake),
    );

    expect(result.status).toBe(0);
    const uuid = tunnelToken.t;
    const credentials = JSON.parse(
      fs.readFileSync(path.join(root, 'etc', 'cloudflared', `${uuid}.json`), 'utf8'),
    );
    expect(credentials).toEqual({
      AccountTag: tunnelToken.a,
      TunnelSecret: tunnelToken.s,
      TunnelID: tunnelToken.t,
    });
    expect(fs.readFileSync(path.join(root, 'etc', 'cloudflared', 'config.yml'), 'utf8')).toBe(
      `tunnel: ${uuid}\ncredentials-file: /etc/cloudflared/${uuid}.json\n`,
    );
    expect(result.stderr).not.toContain(tunnelToken.s);
  });

  it('cloud-init idempotency: a failed Vault read leaves no instance.env', () => {
    const fake = fakeOci('fail-tunnel');
    const root = tempDir();

    const result = run(
      ['--root', root, '--no-services', '--instance-id', instanceId],
      baseEnv(fake),
    );

    expect(result.status).not.toBe(0);
    expect(fs.existsSync(path.join(root, 'etc', 'codebox', 'instance.env'))).toBe(false);
    const records = bootLines(root).map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0].result).toBe('failed');
    expect(records[0].step).toBe('vault');
  });

  it('cloud-init idempotency: a missing required variable exits 2 and writes nothing', () => {
    const fake = fakeOci();
    const root = tempDir();
    const env = baseEnv(fake);
    delete env.CB_PUBLIC_URL;

    const result = run(['--root', root, '--no-services', '--instance-id', instanceId], env);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CB_PUBLIC_URL is empty');
    expect(fs.existsSync(path.join(root, 'etc'))).toBe(false);
    expect(fs.existsSync(fake.log)).toBe(false);
  });
});

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const hasCodeboxGroup =
  asRoot && spawnSync('getent', ['group', 'codebox'], { encoding: 'utf8' }).status === 0;

describe('cloud-init permissions', () => {
  it.skipIf(!asRoot || !hasCodeboxGroup)(
    'cloud-init permissions: instance.env is 0640 root:codebox (skipped unless the suite runs as root with the codebox group)',
    () => {
      const fake = fakeOci();
      const root = tempDir();

      const result = run(
        ['--root', root, '--no-services', '--instance-id', instanceId],
        baseEnv(fake),
      );

      expect(result.status).toBe(0);
      const stat = fs.statSync(path.join(root, 'etc', 'codebox', 'instance.env'));
      expect(stat.mode & 0o777).toBe(0o640);
      expect(stat.uid).toBe(0);
    },
  );
});
