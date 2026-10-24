import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'provision.sh');

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-oci-'));
  tempDirs.push(dir);
  return dir;
}

function isolatedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CB_OCI_') || key.startsWith('OCI_CLI_') || key === 'GITHUB_OUTPUT') continue;
    env[key] = value;
  }
  return env;
}

// The `--plan` cases prove the absence of a call, so the fixture fails loudly if it ever runs.
function fakeOci() {
  const dir = tempDir();
  const file = path.join(dir, 'oci');
  fs.writeFileSync(
    file,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> "$CB_OCI_FAKE_LOG"`,
      'echo "provision.sh must not call the OCI CLI in --plan" >&2',
      'exit 97',
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

function planEnv(fake) {
  return {
    ...isolatedEnv(),
    CB_OCI_COMPARTMENT_ID: 'ocid1.compartment.oc1..dummy',
    CB_OCI_ADMIN_CIDR: '203.0.113.7/32',
    CB_OCI_FAKE_LOG: fake.log,
    PATH: fake.path,
  };
}

function run(args, env) {
  return spawnSync('bash', [script, ...args], { env, encoding: 'utf8', timeout: 30_000 });
}

describe('provision.sh', () => {
  // `vitest -t` takes a regular expression, so the spec's own selector for this case
  // (`-t 'plan: prints every cb-* resource name and the exact CIDRs'`) matches `cb` plus
  // zero or more `-`, not the literal star. The suite name carries the same words without
  // it so that selector still runs the case; the test title stays exactly as specified.
  describe('plan: prints every cb resource name and the exact CIDRs', () => {
    it('plan: prints every cb-* resource name and the exact CIDRs', () => {
      const fake = fakeOci();

      const result = run(['--plan'], planEnv(fake));

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/create vcn cb-vcn/);
      expect(result.stdout).toMatch(/10\.0\.0\.0\/16/);
      expect(result.stdout).toMatch(/create igw cb-igw/);
      expect(result.stdout).toMatch(/create route-table cb-rt/);
      expect(result.stdout).toMatch(/0\.0\.0\.0\/0/);
      expect(result.stdout).toMatch(/create security-list cb-sl/);
      expect(result.stdout).toMatch(/tcp\/22/);
      expect(result.stdout).toMatch(/\/32/);
      expect(result.stdout).toMatch(/create subnet cb-subnet/);
      expect(result.stdout).toMatch(/10\.0\.1\.0\/24/);
      expect(result.stdout).toMatch(/create dynamic-group cb-instance-dg/);
      expect(result.stdout).toMatch(/create policy cb-instance-policy/);
      expect(fs.existsSync(fake.log)).toBe(false);
    });
  });

  it('plan: --with-vault and --with-bucket add cb-vault and cb-backups and nothing else', () => {
    const fake = fakeOci();

    const result = run(['--plan', '--with-vault', '--with-bucket'], planEnv(fake));

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/create vault cb-vault/);
    expect(result.stdout).toMatch(/create bucket cb-backups/);
    expect(/pkm-/.test(result.stdout)).toBe(false);
    expect(fs.existsSync(fake.log)).toBe(false);
  });

  it('plan: a missing required variable exits 2 and prints nothing', () => {
    const fake = fakeOci();
    const env = planEnv(fake);
    delete env.CB_OCI_COMPARTMENT_ID;

    const result = run(['--plan'], env);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/CB_OCI_COMPARTMENT_ID/);
    expect(result.stdout).toBe('');
    expect(fs.existsSync(fake.log)).toBe(false);
  });

  it('destroy plan: the network is deleted in reverse order and the image is kept', () => {
    const fake = fakeOci();

    const result = run(['--destroy', '--plan'], planEnv(fake));

    expect(result.status).toBe(0);
    const order = [
      'delete subnet cb-subnet',
      'delete security-list cb-sl',
      'delete route-table cb-rt',
      'delete igw cb-igw',
      'delete vcn cb-vcn',
    ];
    const positions = order.map((line) => result.stdout.indexOf(line));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(result.stdout).toMatch(/terminate instance cb-instance preserve boot volume cb-boot/);
    expect(result.stdout).not.toMatch(/^delete .*cb-boot/m);
    expect(result.stdout.toLowerCase()).not.toContain('image');
    expect(fs.existsSync(fake.log)).toBe(false);
  });
});
