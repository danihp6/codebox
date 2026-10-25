import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', 'keepalive.sh');
const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const unitDir = path.join(repo, 'ops', 'vm', 'systemd');

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
    if (key.startsWith('CB_') || key === 'ROOT') continue;
    env[key] = value;
  }
  return env;
}

// A frozen /proc: the counters do not move between the two reads, which pins cpuBusyPct to 0.0.
function stubProc() {
  const dir = tempDir();
  const proc = path.join(dir, 'proc');
  fs.mkdirSync(path.join(proc, 'net'), { recursive: true });
  fs.writeFileSync(
    path.join(proc, 'stat'),
    'cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 100 0 50 800 50 0 0 0 0 0\n',
  );
  fs.writeFileSync(
    path.join(proc, 'meminfo'),
    'MemTotal:        1000 kB\nMemFree:          100 kB\nMemAvailable:     250 kB\n',
  );
  fs.writeFileSync(
    path.join(proc, 'net', 'dev'),
    [
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '    lo: 99999999   1 0 0 0 0 0 0 99999999   1 0 0 0 0 0 0',
      '  eth0: 1000   1 0 0 0 0 0 0 500   1 0 0 0 0 0 0',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(proc, 'loadavg'), '0.08 0.04 0.01 1/100 1234\n');
  fs.writeFileSync(path.join(proc, 'uptime'), '345600.00 1.00\n');
  return proc;
}

function logPath() {
  return path.join(tempDir(), 'logs', 'keepalive.jsonl');
}

function run(args) {
  return spawnSync('bash', [script, ...args], { env: isolatedEnv(), encoding: 'utf8' });
}

function runAsync(args) {
  return new Promise((resolve) => {
    const child = spawn('bash', [script, ...args], { env: isolatedEnv() });
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

function stubCli() {
  const dir = tempDir();
  const file = path.join(dir, 'cb');
  fs.writeFileSync(
    file,
    [
      '#!/usr/bin/env bash',
      'case "$1" in',
      '  doctor) exit 0 ;;',
      "  prune) printf 'cb: unknown command: prune\\n' >&2; exit 5 ;;",
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  );
  fs.chmodSync(file, 0o755);
  return file;
}

async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe('keepalive.sh --report', () => {
  it('prints exactly one JSON line and appends the identical line to the log', () => {
    const proc = stubProc();
    const log = logPath();

    const result = run(['--report', '--proc', proc, '--log', log]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.endsWith('\n')).toBe(true);
    const lines = result.stdout.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(1);
    expect(fs.readFileSync(log, 'utf8')).toBe(result.stdout);
    expect(Object.keys(JSON.parse(lines[0]))).toEqual([
      'at',
      'cpuBusyPct',
      'memUsedPct',
      'netBytes',
      'load1',
      'uptimeSeconds',
    ]);
    expect(JSON.parse(lines[0]).at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('samples the stub /proc into the documented object', () => {
    const proc = stubProc();
    const log = logPath();

    const result = run(['--report', '--proc', proc, '--log', log]);

    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd()).toMatch(
      /^\{"at":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z","cpuBusyPct":0\.0,"memUsedPct":75\.0,"netBytes":1500,"load1":0\.08,"uptimeSeconds":345600\}$/,
    );
    expect(JSON.parse(result.stdout)).toEqual({
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      cpuBusyPct: 0,
      memUsedPct: 75,
      netBytes: 1500,
      load1: 0.08,
      uptimeSeconds: 345600,
    });
  });

  it('exits 2 and prints no line when an input file is missing', () => {
    const proc = stubProc();
    const log = logPath();
    fs.rmSync(path.join(proc, 'uptime'));

    const result = run(['--report', '--proc', proc, '--log', log]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`codebox: error: ${path.join(proc, 'uptime')} is not readable\n`);
    expect(fs.existsSync(log)).toBe(false);
  });

  it('exits 2 when the /proc/meminfo has no MemAvailable', () => {
    const proc = stubProc();
    fs.writeFileSync(path.join(proc, 'meminfo'), 'MemTotal: 1000 kB\n');

    const result = run(['--report', '--proc', proc, '--log', logPath()]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${path.join(proc, 'meminfo')} is not readable`);
  });

  it('exits 2 when a sample input is empty', () => {
    const proc = stubProc();
    fs.writeFileSync(path.join(proc, 'stat'), '');

    const result = run(['--report', '--proc', proc, '--log', logPath()]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${path.join(proc, 'stat')} is not readable`);
  });
});

describe('keepalive.sh pass', () => {
  it('skips all three steps when the CLI is absent and nothing listens', async () => {
    const proc = stubProc();
    const log = logPath();
    const port = await closedPort();

    const result = run([
      '--proc',
      proc,
      '--log',
      log,
      '--cb',
      '/nonexistent/cb',
      '--health-url',
      `http://127.0.0.1:${port}/v1/health`,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.split('\n').filter((line) => line !== '')).toEqual([
      'codebox: step doctor skipped: absent',
      'codebox: step prune skipped: absent',
      'codebox: step health skipped: http 000',
    ]);
    expect(fs.readFileSync(log, 'utf8')).toMatch(/^\{"at":/);
  });

  it('reports doctor ok and prune unsupported against a stub CLI', async () => {
    const proc = stubProc();
    const port = await closedPort();

    const result = run([
      '--proc',
      proc,
      '--log',
      logPath(),
      '--cb',
      stubCli(),
      '--health-url',
      `http://127.0.0.1:${port}/v1/health`,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('codebox: step doctor ok');
    expect(result.stderr).toContain('codebox: step prune skipped: unsupported');
    expect(result.stderr).not.toContain('step prune failed');
  });

  it('reports health ok against a loopback server', async () => {
    const proc = stubProc();
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ok"}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const result = await runAsync([
        '--proc',
        proc,
        '--log',
        logPath(),
        '--cb',
        '/nonexistent/cb',
        '--health-url',
        `http://127.0.0.1:${port}/v1/health`,
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('codebox: step health ok');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('refuses a health URL that is not loopback before any step runs', () => {
    const log = logPath();

    const result = run([
      '--proc',
      stubProc(),
      '--log',
      log,
      '--health-url',
      'http://example.com/v1/health',
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('codebox: error: health-url is not loopback\n');
    expect(result.stderr).not.toContain('step health');
    expect(fs.existsSync(log)).toBe(false);
  });

  it('keeps the usage contract: an unknown flag and a value flag without a value', () => {
    const unknown = run(['--nonsense']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('usage: keepalive.sh [--report]');

    const missing = run(['--log']);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('usage: keepalive.sh [--report]');

    const help = run(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('usage: keepalive.sh [--report]');
    expect(help.stderr).toBe('');
  });
});

describe('keepalive.sh only talks to loopback', () => {
  const text = fs.readFileSync(script, 'utf8');

  it('has exactly one network call, on the health URL', () => {
    const lines = text.split('\n').filter((line) => line.includes('curl'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"$health_url"');
  });

  it('hard-codes the default probe as the only URL literal', () => {
    expect(text.match(/https?:\/\/[^\s"']+/g)).toEqual(['http://127.0.0.1:8787/v1/health']);
  });
});

describe('the units', () => {
  it('schedules the pass every six hours with Persistent=true', () => {
    const timer = fs.readFileSync(path.join(unitDir, 'codebox-keepalive.timer'), 'utf8');
    expect(timer).toContain('OnCalendar=*-*-* 00/6:40:00');
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('Unit=codebox-keepalive.service');
    expect(timer).toContain('WantedBy=timers.target');
  });

  it('runs the installed script once, sandboxed, without an [Install] section', () => {
    const service = fs.readFileSync(path.join(unitDir, 'codebox-keepalive.service'), 'utf8');
    expect(service).toContain('Type=oneshot');
    expect(service).toContain('User=codebox');
    expect(service).toContain('Group=codebox');
    expect(service).toContain('ExecStart=/usr/local/lib/codebox/keepalive.sh');
    expect(service).toContain('TimeoutStartSec=300');
    expect(service).toContain('After=network-online.target');
    expect(service).toContain('Wants=network-online.target');
    expect(service).toContain('NoNewPrivileges=true');
    expect(service).toContain('ProtectSystem=strict');
    expect(service).toContain('ProtectHome=true');
    expect(service).toContain('PrivateTmp=true');
    expect(service).toContain('ReadWritePaths=/var/lib/codebox /srv/codebox');
    expect(service).not.toMatch(/^\[Install\]$/m);
  });
});

describe('the image installs the pair', () => {
  const installer = fs.readFileSync(
    path.join(repo, 'ops', 'image', 'scripts', '60-service.sh'),
    'utf8',
  );

  it('installs keepalive.sh through the host-script loop', () => {
    const loop = installer.match(/for script in ([^;]+); do/)[1].split(' ');
    expect(loop).toContain('keepalive.sh');
  });

  it('installs both units and enables the timer', () => {
    expect(installer).toContain('/etc/systemd/system/codebox-keepalive.service');
    expect(installer).toContain('/etc/systemd/system/codebox-keepalive.timer');
    const enable = installer.split('\n').find((line) => line.startsWith('systemctl enable '));
    expect(enable).toContain('codebox-keepalive.timer');
  });

  it('uploads the three files from the Packer template', () => {
    const template = fs.readFileSync(path.join(repo, 'ops', 'image', 'codebox.pkr.hcl'), 'utf8');
    const pairs = [
      ...template.matchAll(
        /provisioner "file" \{\s+source\s+= "([^"]+)"\s+destination = "([^"]+)"\s+\}/g,
      ),
    ].map((match) => ({ source: match[1], destination: match[2] }));

    expect(pairs).toEqual(
      expect.arrayContaining([
        {
          source: '${path.root}/../vm/keepalive.sh',
          destination: '/tmp/codebox/vm/keepalive.sh',
        },
        {
          source: '${path.root}/../vm/systemd/codebox-keepalive.service',
          destination: '/tmp/codebox/units/codebox-keepalive.service',
        },
        {
          source: '${path.root}/../vm/systemd/codebox-keepalive.timer',
          destination: '/tmp/codebox/units/codebox-keepalive.timer',
        },
      ]),
    );
  });
});
