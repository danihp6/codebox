import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'spot-notice.sh');
const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const unitDir = path.join(repo, 'ops', 'vm', 'systemd');

const notice = { action: 'terminate', time: '2026-10-26T12:00:00Z' };

const tempDirs = [];
const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
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
    if (key.startsWith('CB_') || key.startsWith('OCI_') || key.startsWith('AWS_')) continue;
    if (key === 'ROOT') continue;
    env[key] = value;
  }
  return env;
}

// The metadata service lives in this process, so the run has to spawn without blocking the
// event loop: `curl` is the child and it has to be answered while it waits.
function runAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn('bash', [script, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function metadataFixture(answer) {
  const server = createServer((request, response) => {
    if (request.url === '/latest/api/token') {
      response.writeHead(200);
      response.end('imds-token');
      return;
    }
    if (request.url === '/latest/meta-data/spot/instance-action') {
      if (answer === null) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}` });
    });
  });
}

// The real script would upload; here it only records the call, which is the fact under test.
function stubBackup() {
  const dir = tempDir();
  const file = path.join(dir, 'backup.sh');
  fs.writeFileSync(
    file,
    ['#!/usr/bin/env bash', 'printf "%s\\n" "$*" >> "$CB_STUB_LOG"', 'exit 0', ''].join('\n'),
  );
  fs.chmodSync(file, 0o755);
  return { file, log: path.join(dir, 'calls.log') };
}

describe('spot-notice.sh', () => {
  it('does nothing when the metadata service has no notice', async () => {
    const fixture = await metadataFixture(null);
    const state = tempDir();
    const stub = stubBackup();

    const result = await runAsync(
      ['--once', '--endpoint', fixture.url, '--state', state, '--backup-script', stub.file],
      { ...isolatedEnv(), CB_STUB_LOG: stub.log },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no spot notice');
    expect(fs.existsSync(stub.log)).toBe(false);
    expect(fs.readdirSync(state).filter((name) => name.endsWith('.done'))).toEqual([]);
  });

  it('runs one final backup for repeated notices', async () => {
    const fixture = await metadataFixture(notice);
    const state = tempDir();
    const stub = stubBackup();
    const args = [
      '--once',
      '--endpoint',
      fixture.url,
      '--state',
      state,
      '--backup-script',
      stub.file,
    ];
    const env = { ...isolatedEnv(), CB_STUB_LOG: stub.log };

    const first = await runAsync(args, env);
    expect(first.status).toBe(0);
    expect(first.stderr).toContain(`final backup for ${notice.time}`);

    const marker = path.join(state, `final-${notice.time.replaceAll(/[^A-Za-z0-9]/g, '-')}.done`);
    expect(fs.readFileSync(marker, 'utf8')).toBe(JSON.stringify(notice));

    const second = await runAsync(args, env);
    expect(second.status).toBe(0);
    expect(second.stderr).toContain(`notice ${notice.time} already handled`);

    const calls = fs
      .readFileSync(stub.log, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    expect(calls).toEqual(['--upload']);
  });

  it('keeps no marker and exits 6 when the backup fails', async () => {
    const fixture = await metadataFixture(notice);
    const state = tempDir();
    const failing = path.join(tempDir(), 'backup.sh');
    fs.writeFileSync(failing, '#!/usr/bin/env bash\nexit 6\n');
    fs.chmodSync(failing, 0o755);

    const result = await runAsync(
      ['--once', '--endpoint', fixture.url, '--state', state, '--backup-script', failing],
      isolatedEnv(),
    );

    expect(result.status).toBe(6);
    expect(fs.readdirSync(state).filter((name) => name.endsWith('.done'))).toEqual([]);
  });

  it('rejects a token the metadata service refuses', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/latest/api/token') {
        response.writeHead(401);
        response.end();
        return;
      }
      response.writeHead(401);
      response.end();
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const result = await runAsync(
      ['--once', '--endpoint', `http://127.0.0.1:${port}`, '--state', tempDir()],
      isolatedEnv(),
    );

    expect(result.status).toBe(6);
    expect(result.stderr).toContain('metadata token rejected');
  });
});

describe('the spot notice unit', () => {
  it('ships the spot notice unit with its sandbox block', () => {
    const text = fs.readFileSync(path.join(unitDir, 'codebox-spot-notice.service'), 'utf8');

    expect(text).toContain('Description=Codebox spot interruption notice: one final backup');
    expect(text).toContain('After=network-online.target');
    expect(text).toContain('Wants=network-online.target');
    expect(text).toContain('Type=simple');
    expect(text).toContain('User=codebox');
    expect(text).toContain('Group=codebox');
    expect(text).toContain('ExecStart=/usr/local/lib/codebox/spot-notice.sh');
    expect(text).toContain('Restart=on-failure');
    expect(text).toContain('RestartSec=10');
    expect(text).toContain('NoNewPrivileges=true');
    expect(text).toContain('ProtectSystem=strict');
    expect(text).toContain('ProtectHome=true');
    expect(text).toContain('PrivateTmp=true');
    expect(text).toContain('ReadWritePaths=/var/lib/codebox /srv/codebox');
    expect(text).toContain('WantedBy=multi-user.target');
  });
});

describe('the image installs the spot-notice pair', () => {
  const installer = fs.readFileSync(
    path.join(repo, 'ops', 'image', 'scripts', '60-service.sh'),
    'utf8',
  );

  it('installs the spot-notice pair into the image', () => {
    const loop = installer.match(/for script in ([^;]+); do/)[1].split(' ');
    expect(loop).toContain('spot-notice.sh');

    expect(installer).toContain('/etc/systemd/system/codebox-spot-notice.service');
    const enable = installer
      .replaceAll('\\\n', ' ')
      .split('\n')
      .find((line) => line.startsWith('systemctl enable '));
    expect(enable).toContain('codebox-spot-notice.service');

    const template = fs.readFileSync(path.join(repo, 'ops', 'image', 'codebox.pkr.hcl'), 'utf8');
    const pairs = [
      ...template.matchAll(
        /provisioner "file" \{\s+source\s+= "([^"]+)"\s+destination = "([^"]+)"\s+\}/g,
      ),
    ].map((match) => ({ source: match[1], destination: match[2] }));
    expect(pairs).toEqual(
      expect.arrayContaining([
        {
          source: '${path.root}/../vm/spot-notice.sh',
          destination: '/tmp/codebox/vm/spot-notice.sh',
        },
        {
          source: '${path.root}/../vm/systemd/codebox-spot-notice.service',
          destination: '/tmp/codebox/units/codebox-spot-notice.service',
        },
      ]),
    );
  });
});
