import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const unitsDir = path.resolve(import.meta.dirname, '..', 'systemd');

const LONG_RUNNING_UNITS = [
  'codebox.service',
  'codebox-opencode.service',
  'cloudflared.service',
];

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
  'UMask=0027',
];

const READ_WRITE = 'ReadWritePaths=/var/lib/codebox /srv/codebox';

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
      it('carries every directive of the sandbox block', () => {
        const entries = lines(unit);
        for (const directive of SANDBOX_BLOCK) {
          expect(entries, `${unit} ${directive}`).toContain(directive);
        }
      });

      it('places the block after PrivateTmp and before ReadWritePaths', () => {
        const entries = lines(unit);
        const privateTmp = entries.indexOf('PrivateTmp=true');
        const readWrite = entries.indexOf(READ_WRITE);
        expect(privateTmp, `${unit} PrivateTmp`).toBeGreaterThan(-1);
        expect(readWrite, `${unit} ReadWritePaths`).toBeGreaterThan(-1);
        expect(privateTmp).toBeLessThan(readWrite);
        for (const directive of SANDBOX_BLOCK) {
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
          READ_WRITE,
          'Restart=on-failure',
        ]) {
          expect(entries, `${unit} ${directive}`).toContain(directive);
        }
        expect(entries.some((line) => line.startsWith('ExecStart=')), `${unit} ExecStart`).toBe(
          true,
        );
        expect(
          entries.some((line) => line.startsWith('EnvironmentFile=')),
          `${unit} EnvironmentFile`,
        ).toBe(true);
        if (unit !== 'cloudflared.service') {
          expect(entries, `${unit} User`).toContain('User=codebox');
          expect(entries, `${unit} Group`).toContain('Group=codebox');
        }
      });

      it('never denies the write-execute mapping V8 needs', () => {
        expect(read(unit)).not.toMatch(/^\s*MemoryDenyWriteExecute\s*=\s*(?:yes|true|1)\s*$/m);
      });
    });
  }
});

describe('the two timer-backed units', () => {
  it('leaves the backup and keepalive services alone', () => {
    for (const unit of ['codebox-backup.service', 'codebox-keepalive.service']) {
      expect(lines(unit).length).toBeGreaterThan(0);
      expect(read(unit)).not.toContain('SystemCallFilter=');
    }
  });
});
