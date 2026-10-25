import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const imageDir = path.join(repo, 'ops', 'image');
const vmDir = path.join(repo, 'ops', 'vm');
const template = path.join(imageDir, 'codebox.pkr.hcl');

// The pattern list of the image's own secret check (ops/image/scripts/90-verify.sh). The three
// files that have to name the patterns to test them are the only exclusions, exactly like the
// grep a reviewer runs by hand.
const forbidden = [
  'ghp_',
  'ghs_',
  'gho_',
  'ghu_',
  'github_pat_',
  '-----BEGIN',
  'cf-tunnel',
  'sk-',
  'xoxb-',
  'AKIA',
];
const selfNaming = new Set([
  'ops/image/scripts/90-verify.sh',
  'ops/image/test/template.test.mjs',
  'ops/vm/test/cloud-init.test.mjs',
]);

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-image-'));
  tempDirs.push(dir);
  return dir;
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function have(binary) {
  return spawnSync('sh', ['-c', `command -v ${binary}`], { encoding: 'utf8' }).status === 0;
}

function hclVariable(source, name) {
  const match = source.match(new RegExp(`variable "${name}" \\{([\\s\\S]*?)\\n\\}`));
  return match ? match[1] : null;
}

describe('Packer template', () => {
  const source = fs.readFileSync(template, 'utf8');

  it('requires the oracle plugin from the registry', () => {
    expect(source).toMatch(/required_plugins \{[\s\S]*oracle = \{/);
    expect(source).toContain('source  = "github.com/hashicorp/oracle"');
    expect(source).toMatch(/version = ">= 1\.0\.2"/);
  });

  it('uses the free-tier Ampere shape with 2 OCPU and 12 GB', () => {
    expect(source).toMatch(/source "oracle-oci" "codebox" \{/);
    expect(source).toMatch(/shape\s+= "VM\.Standard\.A1\.Flex"/);
    expect(source).toMatch(/ocpus\s+= 2/);
    expect(source).toMatch(/memory_in_gbs\s+= 12/);
    expect(source).toMatch(/ssh_username\s+= "ubuntu"/);
    expect(source).toContain(
      'image_name          = "cb-image-${var.image_version}-${var.git_sha}"',
    );
  });

  it('declares the required variables without a default and the three pinned ones with one', () => {
    for (const name of [
      'compartment_ocid',
      'subnet_ocid',
      'availability_domain',
      'base_image_ocid',
      'image_version',
      'git_sha',
    ]) {
      const block = hclVariable(source, name);
      expect(block, name).not.toBeNull();
      expect(block).toContain('type        = string');
      expect(block).toContain('description');
      expect(block).not.toContain('default');
    }

    expect(hclVariable(source, 'node_version')).toContain('default     = "24.22.1"');
    expect(hclVariable(source, 'opencode_version')).toContain('default     = "1.19.4"');
    expect(hclVariable(source, 'cloudflared_channel')).toContain('default     = "stable"');
  });

  it('runs the eight provisioners in numeric order and every path exists', () => {
    const block = source.match(/scripts = \[([\s\S]*?)\]/)[1];
    const scripts = [...block.matchAll(/scripts\/([A-Za-z0-9._-]+)"/g)].map((match) => match[1]);
    expect(scripts).toEqual([
      '10-base.sh',
      '20-node.sh',
      '30-tools.sh',
      '40-opencode.sh',
      '50-cloudflared.sh',
      '60-service.sh',
      '70-harden.sh',
      '90-verify.sh',
    ]);
    for (const name of scripts) {
      expect(fs.existsSync(path.join(imageDir, 'scripts', name)), name).toBe(true);
    }
  });

  it('uploads the units and the host scripts by relative path', () => {
    const uploads = [...source.matchAll(/"\$\{path\.root\}\/\.\.\/vm\/([A-Za-z0-9._/-]+)"/g)].map(
      (match) => match[1],
    );
    expect(uploads).toContain('systemd/codebox.service');
    expect(uploads).toContain('systemd/codebox-backup.timer');
    expect(uploads).toContain('lib.sh');
    expect(uploads).toContain('cloud-init.sh');
    for (const name of uploads) {
      expect(fs.existsSync(path.join(vmDir, name)), name).toBe(true);
    }
  });

  it('passes exactly the five documented build variables and no sensitive one', () => {
    const block = source.match(/environment_vars = \[([\s\S]*?)\]/)[1];
    const entries = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && line !== ']')
      .map((line) => line.replace(/,$/, '').replace(/^"/, '').replace(/"$/, ''));
    expect(entries).toEqual([
      'CB_IMAGE_VERSION=${var.image_version}',
      'CB_IMAGE_COMMIT=${var.git_sha}',
      'CB_IMAGE_BUILT_AT={{timestamp}}',
      'NODE_VERSION=${var.node_version}',
      'OPENCODE_VERSION=${var.opencode_version}',
    ]);
    expect(source).not.toMatch(/sensitive\s*=/);
    expect(source).not.toMatch(/\benv\s*=\s*\[/);
  });

  it('ships a committed example var-file with dummy OCIDs only', () => {
    const vars = fs.readFileSync(path.join(imageDir, 'example.pkrvars.hcl'), 'utf8');

    expect(vars).toContain('compartment_ocid    = "ocid1.compartment.oc1..example"');
    expect(vars).toContain('subnet_ocid         = "ocid1.subnet.oc1..example"');
    expect(vars).toContain('availability_domain = "AD-1"');
    expect(vars).toContain('base_image_ocid     = "ocid1.image.oc1..example"');
    expect(vars).toContain('image_version       = "0.1.0"');
    expect(vars).toContain('git_sha             = "0000000"');
    expect(vars).not.toMatch(/key|secret|token/i);
  });
});

describe('the seven units', () => {
  const unitDir = path.join(vmDir, 'systemd');
  const units = fs.readdirSync(unitDir).sort();

  it('ships the five services and the two timers', () => {
    expect(units).toEqual([
      'cloudflared.service',
      'codebox-backup.service',
      'codebox-backup.timer',
      'codebox-keepalive.service',
      'codebox-keepalive.timer',
      'codebox-opencode.service',
      'codebox.service',
    ]);
  });

  it('gives every service the sandbox block of docs/providers.md §14', () => {
    for (const name of units.filter((unit) => unit.endsWith('.service'))) {
      const text = fs.readFileSync(path.join(unitDir, name), 'utf8');
      expect(text, name).toContain('NoNewPrivileges=true');
      expect(text, name).toContain('ProtectSystem=strict');
      expect(text, name).toContain('ProtectHome=true');
      expect(text, name).toContain('PrivateTmp=true');
      expect(text, name).toContain('ReadWritePaths=/var/lib/codebox /srv/codebox');
      expect(text, name).toContain('User=codebox');
      if (!text.includes('Type=oneshot')) expect(text, name).toContain('Restart=on-failure');
    }
  });

  it('starts the daemon and the tunnel with the instance environment', () => {
    const daemon = fs.readFileSync(path.join(unitDir, 'codebox.service'), 'utf8');
    expect(daemon).toContain('EnvironmentFile=/etc/codebox/instance.env');
    expect(daemon).toContain(
      'ExecStart=/usr/bin/env node /opt/codebox/current/apps/daemon/dist/main.js',
    );
    expect(daemon).toContain('After=network-online.target codebox-opencode.service');
    expect(daemon).toContain('TimeoutStopSec=30');
    expect(daemon).toContain('WantedBy=multi-user.target');

    const tunnel = fs.readFileSync(path.join(unitDir, 'cloudflared.service'), 'utf8');
    expect(tunnel).toContain(
      'ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel --config /etc/cloudflared/config.yml run',
    );
    expect(tunnel).toContain('EnvironmentFile=/etc/codebox/instance.env');
  });

  it('keeps OpenCode on loopback and out of the default target', () => {
    const text = fs.readFileSync(path.join(unitDir, 'codebox-opencode.service'), 'utf8');
    expect(text).toContain(
      'ExecStart=/usr/bin/env opencode serve --hostname 127.0.0.1 --port 4096',
    );
    expect(text).not.toMatch(/^\[Install\]$/m);
    expect(text).not.toContain('WantedBy');
  });

  it('schedules the nightly backup at 03:20', () => {
    const timer = fs.readFileSync(path.join(unitDir, 'codebox-backup.timer'), 'utf8');
    expect(timer).toContain('OnCalendar=*-*-* 03:20:00');
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('WantedBy=timers.target');

    const backup = fs.readFileSync(path.join(unitDir, 'codebox-backup.service'), 'utf8');
    expect(backup).toContain('Type=oneshot');
    expect(backup).toContain('ExecStart=/usr/local/lib/codebox/backup.sh --upload');
  });
});

describe('every shell script parses', () => {
  it('passes bash -n', () => {
    const scripts = [...walk(vmDir), ...walk(path.join(imageDir, 'scripts'))].filter((file) =>
      file.endsWith('.sh'),
    );
    expect(scripts.length).toBeGreaterThanOrEqual(12);
    for (const file of scripts) {
      const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
      expect(result.status, `${file}: ${result.stderr}`).toBe(0);
    }
  });
});

describe('no credential in the templates', () => {
  it('finds none of the ten token patterns under ops/image and ops/vm', () => {
    const files = [...walk(imageDir), ...walk(vmDir)];
    const hits = [];
    for (const file of files) {
      const relative = path.relative(repo, file).split(path.sep).join('/');
      if (selfNaming.has(relative)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (text.includes(pattern)) hits.push(`${relative}:${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('Packer itself', () => {
  it('formats clean', (context) => {
    if (!have('packer')) {
      console.warn('codebox: packer is not installed, skipping packer fmt -check');
      context.skip();
      return;
    }

    const result = spawnSync('packer', ['fmt', '-check', '-recursive', imageDir], {
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
  });

  it('validates the example var-file against the installed plugin', (context) => {
    if (!have('packer') || !have('openssl')) {
      console.warn('codebox: packer or openssl is not installed, skipping packer validate');
      context.skip();
      return;
    }

    const init = spawnSync('packer', ['init', imageDir], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (init.status !== 0) {
      console.warn(`codebox: packer init failed, skipping packer validate: ${init.stderr}`);
      context.skip();
      return;
    }

    // The OCI builder refuses to prepare without a tenancy config, so validation runs against
    // a throwaway key generated here: never a credential, never committed.
    const dir = tempDir();
    const key = path.join(dir, 'key.pem');
    const generated = spawnSync('openssl', ['genrsa', '2048'], { encoding: 'utf8' });
    expect(generated.status).toBe(0);
    fs.writeFileSync(key, generated.stdout);
    const config = path.join(dir, 'config');
    fs.writeFileSync(
      config,
      [
        '[DEFAULT]',
        'user=ocid1.user.oc1..example',
        'fingerprint=00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
        'tenancy=ocid1.tenancy.oc1..example',
        'region=eu-madrid-1',
        `key_file=${key}`,
        '',
      ].join('\n'),
    );

    const result = spawnSync(
      'packer',
      [
        'validate',
        `-var-file=${path.join(imageDir, 'example.pkrvars.hcl')}`,
        `-var=oci_config_file=${config}`,
        imageDir,
      ],
      { encoding: 'utf8', timeout: 120_000 },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('The configuration is valid.');
  });
});
