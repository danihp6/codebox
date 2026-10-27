import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const imageDir = path.join(repo, 'ops', 'image');
const scriptsDir = path.join(imageDir, 'scripts');
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

function attribute(block, name, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${name}\\s+= ${escaped}`);
}

describe('Packer template', () => {
  const source = fs.readFileSync(template, 'utf8');

  it('requires the oracle and the amazon plugin from the registry', () => {
    expect(source).toMatch(/required_plugins \{[\s\S]*oracle = \{/);
    expect(source).toMatch(
      /oracle = \{\s*version\s*= ">= 1\.0\.2"\s*source\s*= "github\.com\/hashicorp\/oracle"\s*\}/,
    );
    expect(source).toMatch(
      /amazon = \{\s*version\s*= ">= 1\.3\.0"\s*source\s*= "github\.com\/hashicorp\/amazon"\s*\}/,
    );
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

  it('builds the amazon arm64 AMI from the AWS variables', () => {
    const match = source.match(/source "amazon-ebs" "codebox" \{([\s\S]*?)\n\}/);
    expect(match, 'amazon-ebs source').not.toBeNull();
    const block = match[1];

    for (const [name, value] of [
      ['region', 'var.aws_region'],
      ['subnet_id', 'var.aws_subnet_id'],
      ['source_ami', 'var.aws_source_ami'],
      ['instance_type', 'var.aws_instance_type'],
      ['ssh_username', 'var.aws_ssh_username'],
      ['spot_price', 'var.aws_spot_max_price'],
    ]) {
      expect(block, name).toMatch(attribute(block, name, value));
    }

    expect(block).toMatch(/ami_name\s+= "cb-image-\$\{var\.image_version\}-\$\{var\.git_sha\}"/);
    expect(block).toMatch(/"codebox:version"\s+= var\.image_version/);
    expect(block).toMatch(/"codebox:commit"\s+= var\.git_sha/);
    expect(block).toMatch(/Name\s+= "cb-image-\$\{var\.image_version\}-\$\{var\.git_sha\}"/);

    // An empty aws_source_ami resolves the newest Canonical Ubuntu 24.04 arm64 AMI of the
    // region, so -var aws_source_ami= builds without pinning an ID that expires.
    expect(block).toMatch(/source_ami_filter \{/);
    expect(block).toContain('ubuntu/images/hvm-ssd/ubuntu-noble-24.04-arm64-server-*');
    expect(block).toContain('099720109477');
    expect(block).toMatch(/most_recent\s+= true/);
  });

  it('declares the required variables without a default and the pinned ones with one', () => {
    for (const name of [
      'compartment_ocid',
      'subnet_ocid',
      'availability_domain',
      'base_image_ocid',
      'image_version',
      'git_sha',
      'aws_subnet_id',
    ]) {
      const block = hclVariable(source, name);
      expect(block, name).not.toBeNull();
      expect(block).toContain('type        = string');
      expect(block).toContain('description');
      expect(block).not.toContain('default');
    }

    for (const [name, value] of [
      ['node_version', '24.22.1'],
      ['opencode_version', '1.19.4'],
      ['cloudflared_channel', 'stable'],
      ['aws_region', 'eu-west-1'],
      ['aws_instance_type', 'c7g.xlarge'],
      ['aws_ssh_username', 'ubuntu'],
      ['aws_spot_max_price', ''],
      ['aws_source_ami', ''],
    ]) {
      const block = hclVariable(source, name);
      expect(block, name).not.toBeNull();
      expect(block, name).toContain('description');
      expect(block, name).toContain(`default     = "${value}"`);
    }
  });

  it('declares no credential-shaped variable', () => {
    const names = [...source.matchAll(/variable "([^"]+)" \{/g)].map((match) => match[1]);
    expect(names.length).toBe(16);
    for (const name of names) {
      expect(name).not.toMatch(/key|secret|token|password|credential|access|vault/i);
    }
    expect(source).not.toMatch(/\b(access_key|secret_key|session_token|aws_secret|vault)\s*=/);
    expect(source).not.toMatch(/sensitive\s*=/);
  });

  it('shares one build block and one copy of each provisioner between both sources', () => {
    expect(source).toMatch(/^source "oracle-oci" "codebox" \{/m);
    expect(source).toMatch(/^source "amazon-ebs" "codebox" \{/m);
    expect(source.match(/^build \{/gm) ?? []).toHaveLength(1);

    const build = source.slice(source.indexOf('build {'));
    const lists = [...build.matchAll(/sources\s+= \[([\s\S]*?)\]/g)];
    expect(lists).toHaveLength(1);
    expect([...lists[0][1].matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual([
      'source.oracle-oci.codebox',
      'source.amazon-ebs.codebox',
    ]);

    expect(build.match(/provisioner "/g) ?? []).toHaveLength(19);
    expect(source.match(/provisioner "/g) ?? []).toHaveLength(19);
    expect(build.match(/provisioner "file" \{/g) ?? []).toHaveLength(17);
    expect(build.match(/provisioner "shell" \{/g) ?? []).toHaveLength(2);
  });

  it('discovers every numbered build step in lexicographic order', () => {
    const block = source.match(/scripts\s+= \[([\s\S]*?)\]\n/)[1];
    expect(block).toMatch(/fileset\("[^"]*\/scripts", "\*\.sh"\)/);
    expect(block).toMatch(/: "[^"]*\/scripts\/\$\{f\}"/);
    expect(block).not.toMatch(/scripts\/\d\d-/);
    expect(source.match(/\bscripts\s+=/g) ?? []).toHaveLength(1);

    const discovered = fs
      .readdirSync(scriptsDir)
      .filter((name) => name.endsWith('.sh'))
      .sort();
    expect(discovered).toEqual(
      expect.arrayContaining([
        '10-base.sh',
        '20-node.sh',
        '30-tools.sh',
        '40-opencode.sh',
        '50-cloudflared.sh',
        '60-service.sh',
        '70-harden.sh',
        '90-verify.sh',
      ]),
    );
    for (const name of discovered) expect(name).toMatch(/^\d\d-[a-z0-9-]+\.sh$/);
    const prefixes = discovered.map((name) => name.slice(0, 2));
    expect([...new Set(prefixes)]).toEqual(prefixes);
    expect([...prefixes].sort()).toEqual(prefixes);
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

  it('ships a committed example var-file with dummy OCIDs and AWS IDs only', () => {
    const vars = fs.readFileSync(path.join(imageDir, 'example.pkrvars.hcl'), 'utf8');

    expect(vars).toContain('compartment_ocid    = "ocid1.compartment.oc1..example"');
    expect(vars).toContain('subnet_ocid         = "ocid1.subnet.oc1..example"');
    expect(vars).toContain('availability_domain = "AD-1"');
    expect(vars).toContain('base_image_ocid     = "ocid1.image.oc1..example"');
    expect(vars).toContain('aws_region         = "eu-west-1"');
    expect(vars).toContain('aws_subnet_id      = "subnet-0123456789abcdef0"');
    expect(vars).toContain('aws_source_ami     = "ami-0123456789abcdef0"');
    expect(vars).toContain('aws_instance_type  = "c7g.xlarge"');
    expect(vars).toContain('aws_ssh_username   = "ubuntu"');
    expect(vars).toContain('image_version       = "0.1.0"');
    expect(vars).toContain('git_sha             = "0000000"');

    const awsVars = [...source.matchAll(/variable "(aws_[^"]+)" \{/g)].map((match) => match[1]);
    expect(awsVars.length).toBe(6);
    for (const name of awsVars) {
      expect(vars, name).toMatch(new RegExp(`^${name}\\s+= `, 'm'));
    }

    expect(vars).not.toMatch(/key|secret|token/i);
  });
});

describe('the eight units', () => {
  const unitDir = path.join(vmDir, 'systemd');
  const units = fs.readdirSync(unitDir).sort();

  it('ships the six services and the two timers', () => {
    expect(units).toEqual([
      'cloudflared.service',
      'codebox-backup.service',
      'codebox-backup.timer',
      'codebox-keepalive.service',
      'codebox-keepalive.timer',
      'codebox-opencode.service',
      'codebox-spot-notice.service',
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
      if (!text.includes('Type=oneshot')) expect(text, name).toContain('Restart=on-failure');
    }
  });

  it('runs the agent as its own user with only its own environment', () => {
    const text = fs.readFileSync(path.join(unitDir, 'codebox-opencode.service'), 'utf8');

    expect(text).toContain('User=codebox-agent');
    expect(text).toContain('Group=codebox-workspace');
    expect(text).toContain('WorkingDirectory=/var/lib/codebox-agent');
    expect(text).toContain('EnvironmentFile=/etc/codebox/agent.env');
    expect(text).toContain('ReadWritePaths=/srv/codebox /var/lib/codebox-agent');
    expect(text).not.toContain('instance.env');
  });

  it('keeps every other service on the daemon user and the daemon paths', () => {
    for (const name of units.filter((unit) => unit.endsWith('.service'))) {
      if (name === 'codebox-opencode.service') continue;
      const text = fs.readFileSync(path.join(unitDir, name), 'utf8');
      expect(text, name).toContain('User=codebox');
      expect(text, name).not.toContain('User=codebox-agent');
      expect(text, name).toContain('ReadWritePaths=/var/lib/codebox /srv/codebox');
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

  it('validates the example var-file against both installed plugins', (context) => {
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

    const installed = spawnSync('packer', ['plugins', 'installed'], { encoding: 'utf8' });
    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.stdout).toContain('hashicorp/amazon');
    expect(installed.stdout).toContain('hashicorp/oracle');

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

    for (const extra of [[], ['-var=aws_source_ami=']]) {
      const result = spawnSync(
        'packer',
        [
          'validate',
          `-var-file=${path.join(imageDir, 'example.pkrvars.hcl')}`,
          `-var=oci_config_file=${config}`,
          ...extra,
          imageDir,
        ],
        { encoding: 'utf8', timeout: 120_000 },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('The configuration is valid.');
    }
  });
});
