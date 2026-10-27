import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const unitsDir = path.resolve(import.meta.dirname, '..', 'systemd');

const LONG_RUNNING_UNITS = ['codebox.service', 'codebox-opencode.service', 'cloudflared.service'];

const SANDBOX_BLOCK = [
  'CapabilityBoundingSet=',
  'AmbientCapabilities=',
  'LockPersonality=true',
  'PrivateDevices=true',
  'ProtectClock=true',
  'ProtectControlGroups=true',
  'ProtectHostname=true',
  'ProtectKernelLogs=true',
  'ProtectKernelModules=true',
  'ProtectKernelTunables=true',
  'RemoveIPC=true',
  'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
  'RestrictNamespaces=true',
  'RestrictRealtime=true',
  'RestrictSUIDSGID=true',
  'SystemCallArchitectures=native',
  'SystemCallFilter=@system-service',
  'SystemCallErrorNumber=EPERM',
];

// The daemon and the agent share the worktree trees, so their umask keeps the group writable;
// the tunnel touches nothing of ours and keeps the tighter mask.
const UMASK = {
  'codebox.service': 'UMask=0007',
  'codebox-opencode.service': 'UMask=0007',
  'cloudflared.service': 'UMask=0027',
};

const READ_WRITE = {
  'codebox.service': 'ReadWritePaths=/var/lib/codebox /srv/codebox',
  'codebox-opencode.service': 'ReadWritePaths=/srv/codebox /var/lib/codebox-agent',
  'cloudflared.service': 'ReadWritePaths=/var/lib/codebox /srv/codebox',
};

const IDENTITY = {
  'codebox.service': ['User=codebox', 'Group=codebox'],
  'codebox-opencode.service': ['User=codebox-agent', 'Group=codebox-workspace'],
  'cloudflared.service': [],
};

function read(unit) {
  return fs.readFileSync(path.join(unitsDir, unit), 'utf8');
}

function lines(unit) {
  return read(unit)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('['));
}

describe('the three long-running units', () => {
  for (const unit of LONG_RUNNING_UNITS) {
    describe(unit, () => {
      it('carries every directive of the sandbox block and its umask', () => {
        const entries = lines(unit);
        for (const directive of [...SANDBOX_BLOCK, UMASK[unit]]) {
          expect(entries, `${unit} ${directive}`).toContain(directive);
        }
      });

      it('places the block after PrivateTmp and before ReadWritePaths', () => {
        const entries = lines(unit);
        const privateTmp = entries.indexOf('PrivateTmp=true');
        const readWrite = entries.indexOf(READ_WRITE[unit]);
        expect(privateTmp, `${unit} PrivateTmp`).toBeGreaterThan(-1);
        expect(readWrite, `${unit} ReadWritePaths`).toBeGreaterThan(-1);
        expect(privateTmp).toBeLessThan(readWrite);
        for (const directive of [...SANDBOX_BLOCK, UMASK[unit]]) {
          const index = entries.indexOf(directive);
          expect(index, `${unit} ${directive}`).toBeGreaterThan(privateTmp);
          expect(index, `${unit} ${directive}`).toBeLessThan(readWrite);
        }
      });

      it('keeps the directives the unit already had', () => {
        const entries = lines(unit);
        for (const directive of [
          'NoNewPrivileges=true',
          'ProtectSystem=strict',
          'ProtectHome=true',
          'PrivateTmp=true',
          READ_WRITE[unit],
          'Restart=on-failure',
        ]) {
          expect(entries, `${unit} ${directive}`).toContain(directive);
        }
        expect(
          entries.some((line) => line.startsWith('ExecStart=')),
          `${unit} ExecStart`,
        ).toBe(true);
        expect(
          entries.some((line) => line.startsWith('EnvironmentFile=')),
          `${unit} EnvironmentFile`,
        ).toBe(true);
        for (const directive of IDENTITY[unit]) {
          expect(entries, `${unit} ${directive}`).toContain(directive);
        }
      });

      it('never denies the write-execute mapping V8 needs', () => {
        expect(read(unit)).not.toMatch(/^\s*MemoryDenyWriteExecute\s*=\s*(?:yes|true|1)\s*$/m);
      });
    });
  }
});

describe('the agent unit', () => {
  const unit = 'codebox-opencode.service';

  it('runs the agent as its own user in the workspace group', () => {
    const entries = lines(unit);
    expect(entries.filter((line) => line.startsWith('User='))).toEqual(['User=codebox-agent']);
    expect(entries).toContain('Group=codebox-workspace');
    expect(entries).toContain('WorkingDirectory=/var/lib/codebox-agent');
    expect(entries).toContain('Environment=HOME=/var/lib/codebox-agent');
    expect(entries).toContain('ReadWritePaths=/srv/codebox /var/lib/codebox-agent');
    expect(entries).toContain('UMask=0007');
  });

  it('reads the agent environment and never the instance one', () => {
    const text = read(unit);
    expect(text).toContain('EnvironmentFile=/etc/codebox/agent.env');
    expect(text).not.toContain('instance.env');
    expect(lines(unit)).not.toContain('User=codebox');
  });
});

describe('the daemon and the tunnel keep their own identity', () => {
  it('leaves the daemon on the instance environment with the group-writable mask', () => {
    const entries = lines('codebox.service');
    expect(entries).toContain('User=codebox');
    expect(entries).toContain('Group=codebox');
    expect(entries).toContain('EnvironmentFile=/etc/codebox/instance.env');
    expect(entries).toContain('UMask=0007');
  });

  it('leaves the tunnel on its own env and the tighter mask', () => {
    const entries = lines('cloudflared.service');
    expect(entries).toContain('User=codebox');
    expect(entries).toContain('UMask=0027');
    expect(entries).not.toContain('User=codebox-agent');
  });
});

describe('the two timer-backed units', () => {
  it('leaves the backup and keepalive services alone', () => {
    for (const unit of ['codebox-backup.service', 'codebox-keepalive.service']) {
      expect(lines(unit).length).toBeGreaterThan(0);
      expect(read(unit)).not.toContain('SystemCallFilter=');
    }
  });
});
