import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'launch.sh');

// Dummy values only: no fixture in this repository may carry real key material.
const fakePrivateKey = 'dummy-private-key-material-do-not-use';
const fakePublicKey = 'ssh-ed25519 dummy-public-key-material';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-oci-'));
  tempDirs.push(dir);
  return dir;
}

function baseEnv() {
  return {
    OCI_CLI_USER: 'ocid1.user.oc1..dummy',
    OCI_CLI_FINGERPRINT: 'aa:bb:cc:dd:dummy',
    OCI_CLI_TENANCY: 'ocid1.tenancy.oc1..dummy',
    OCI_CLI_REGION: 'eu-madrid-1',
    OCI_CLI_KEY_CONTENT: fakePrivateKey,
    CB_OCI_COMPARTMENT_ID: 'ocid1.compartment.oc1..dummy',
    CB_OCI_SUBNET_ID: 'ocid1.subnet.oc1..dummy',
    CB_OCI_IMAGE_ID: 'ocid1.image.oc1..dummy',
    CB_OCI_AD: 'AD-1',
    CB_OCI_SSH_PUBLIC_KEY: fakePublicKey,
  };
}

function isolatedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CB_OCI_') || key.startsWith('OCI_CLI_') || key === 'GITHUB_OUTPUT') continue;
    env[key] = value;
  }
  return env;
}

function writeFakeOci(body) {
  const dir = tempDir();
  const file = path.join(dir, 'oci');
  fs.writeFileSync(
    file,
    ['#!/usr/bin/env bash', `printf '%s\\n' "$*" >> "$CB_OCI_FAKE_LOG"`, body, ''].join('\n'),
  );
  fs.chmodSync(file, 0o755);
  return {
    dir,
    log: path.join(dir, 'oci.log'),
    path: `${dir}${path.delimiter}${process.env.PATH ?? ''}`,
  };
}

function run(args, env) {
  return spawnSync('bash', [script, ...args], { env, encoding: 'utf8', timeout: 30_000 });
}

const noSleep = {
  CB_OCI_ATTEMPT_SLEEP: '0',
  CB_OCI_THROTTLE_SLEEP: '0',
  CB_OCI_START_DELAY: '0',
  CB_OCI_BUDGET: '3600',
};

describe('launch.sh', () => {
  it('capacity: an OutOfHostCapacity answer exits 0 and hands the wait on', () => {
    const fake = writeFakeOci(
      [
        `echo 'ServiceError: { "code": "OutOfHostCapacity", "message": "Out of host capacity" }' >&2`,
        'exit 1',
      ].join('\n'),
    );
    const summary = path.join(fake.dir, 'summary.md');
    const env = {
      ...isolatedEnv(),
      ...baseEnv(),
      ...noSleep,
      CB_OCI_FAKE_LOG: fake.log,
      GITHUB_STEP_SUMMARY: summary,
      PATH: fake.path,
    };

    const result = run([], env);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no capacity yet/);
    expect(fs.readFileSync(summary, 'utf8')).toContain('No slot yet');
  });

  it('throttle: a TooManyRequests answer is retried and counted', () => {
    const fake = writeFakeOci(
      [`echo '{ "code": "TooManyRequests" }' >&2`, 'exit 1'].join('\n'),
    );
    const env = {
      ...isolatedEnv(),
      ...baseEnv(),
      ...noSleep,
      CB_OCI_ATTEMPTS: '2',
      CB_OCI_FAKE_LOG: fake.log,
      PATH: fake.path,
    };

    const result = run([], env);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/rate-limited by Oracle/);
    expect(result.stdout).toMatch(/2 of them throttled/);
  });

  it('bad shape: a malformed CB_OCI_SHAPES entry exits 2 before any call', () => {
    const fake = writeFakeOci(['echo "the fake must not be called" >&2', 'exit 97'].join('\n'));
    const env = {
      ...isolatedEnv(),
      ...baseEnv(),
      ...noSleep,
      CB_OCI_SHAPES: '2/12 1/x',
      CB_OCI_FAKE_LOG: fake.log,
      PATH: fake.path,
    };

    const result = run([], env);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/is not <ocpus>\/<gb>/);
    expect(fs.existsSync(fake.log)).toBe(false);
  });

  it('missing key: an empty CB_OCI_SSH_PUBLIC_KEY exits 2 and names the variable', () => {
    const fake = writeFakeOci(['echo "the fake must not be called" >&2', 'exit 97'].join('\n'));
    const env = {
      ...isolatedEnv(),
      ...baseEnv(),
      ...noSleep,
      CB_OCI_FAKE_LOG: fake.log,
      PATH: fake.path,
    };
    delete env.CB_OCI_SSH_PUBLIC_KEY;

    const result = run([], env);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CB_OCI_SSH_PUBLIC_KEY');
    expect(result.stdout).toBe('');
    expect(result.stdout + result.stderr).not.toContain(fakePublicKey);
    expect(result.stdout + result.stderr).not.toContain(fakePrivateKey);
    expect(fs.existsSync(fake.log)).toBe(false);
  });

  it('already running: a RUNNING instance parks without a launch call', () => {
    const fake = writeFakeOci(
      [
        'case "$*" in',
        '  *list-vnics*) echo 203.0.113.10 ;;',
        '  *"instance launch"*) echo "the fake must not launch" >&2; exit 97 ;;',
        '  *"instance list"*) echo ocid1.instance.oc1.eu-madrid-1.aaaa ;;',
        '  *"instance get"*)',
        '    case "$*" in',
        '      *ocpus*) echo 2 ;;',
        '      *memoryInGBs*) echo 12 ;;',
        '      *) echo "unknown instance get query: $*" >&2; exit 97 ;;',
        '    esac',
        '    ;;',
        '  *) echo "unknown command: $*" >&2; exit 97 ;;',
        'esac',
      ].join('\n'),
    );
    const output = path.join(fake.dir, 'output');
    fs.writeFileSync(output, '');
    const env = {
      ...isolatedEnv(),
      ...baseEnv(),
      ...noSleep,
      CB_OCI_FAKE_LOG: fake.log,
      GITHUB_OUTPUT: output,
      PATH: fake.path,
    };

    const result = run([], env);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/already running:/);
    const emitted = fs.readFileSync(output, 'utf8');
    expect(emitted).toContain('id=ocid1.instance.oc1.eu-madrid-1.aaaa');
    expect(emitted).toContain('ip=203.0.113.10');
    expect(emitted).toContain('shape=2/12');
    const calls = fs.readFileSync(fake.log, 'utf8').split('\n');
    expect(calls.some((line) => line.includes('instance launch'))).toBe(false);
  });
});
