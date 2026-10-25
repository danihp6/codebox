import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const file = path.resolve(import.meta.dirname, '..', 'http', 'cloud-init.yaml');
const source = fs.readFileSync(file, 'utf8');
const lines = source.split('\n');

function section(name) {
  const start = lines.findIndex((line) => line.startsWith(`${name}:`));
  if (start === -1) return null;
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !line.startsWith(' ') && !line.startsWith('-')) break;
    block.push(line);
  }
  return block;
}

describe('cloud-init user-data', () => {
  it('is a cloud-config document', () => {
    expect(lines[0]).toBe('#cloud-config');
  });

  it('takes the hostname from the template variable, not from a baked name', () => {
    expect(source).toMatch(/^hostname: \$\{CB_INSTANCE_NAME\}$/m);
    expect(source).toMatch(/^preserve_hostname: false$/m);
  });

  it('runs cloud-init.sh as its only runcmd entry', () => {
    const runcmd = section('runcmd');
    expect(runcmd).not.toBeNull();
    const entries = runcmd.filter((line) => line.trim().startsWith('-'));
    expect(entries).toHaveLength(1);
    expect(entries[0].trim()).toBe('- [bash, /usr/local/lib/codebox/cloud-init.sh]');
  });

  it('orders the final modules so the script runs after networking', () => {
    const modules = section('cloud_final_modules');
    expect(modules).not.toBeNull();
    expect(modules.join('\n')).toMatch(/scripts-user/);
    expect(modules.join('\n')).toMatch(/final-message/);
  });

  it('carries no key, no password and no writable file', () => {
    expect(source).not.toMatch(/ssh_authorized_keys/);
    expect(source).not.toMatch(/ssh-authorized-keys/);
    expect(source).not.toMatch(/^password:/m);
    expect(source).not.toMatch(/^users:/m);
    expect(source).not.toMatch(/^write_files:/m);
    expect(source).not.toMatch(/chpasswd/);
    expect(source).not.toMatch(/^packages:/m);
  });

  it('names only the first-boot script and the image paths', () => {
    const executables = source.match(/\/usr\/local\/lib\/codebox\/[A-Za-z0-9._-]+/g) ?? [];
    expect([...new Set(executables)]).toEqual(['/usr/local/lib/codebox/cloud-init.sh']);
  });
});
