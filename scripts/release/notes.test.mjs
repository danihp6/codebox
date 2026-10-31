import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ReleaseNotesMissingError, releaseNotes } from './notes.mjs';

const cli = path.resolve(import.meta.dirname, 'notes.mjs');
const changelog = path.resolve(import.meta.dirname, '..', '..', 'CHANGELOG.md');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-notes-'));
  tempDirs.push(dir);
  return dir;
}

const MARKDOWN = [
  '# Changelog',
  '',
  'Intro text that is not a release.',
  '',
  '## Unreleased',
  '',
  '### Added',
  '',
  '- the thing that is not released yet',
  '',
  '## [1.2.0] - 2026-02-03',
  '',
  '### Fixed',
  '',
  '- the released fix',
  '',
  '## [1.0.0]',
  '',
  '- the first release',
  '',
].join('\n');

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

describe('releaseNotes', () => {
  it('prefers the section for the version and keeps its body only', () => {
    expect(releaseNotes({ markdown: MARKDOWN, version: '1.2.0' })).toBe(
      '# Codebox 1.2.0\n\n### Fixed\n\n- the released fix',
    );
    expect(releaseNotes({ markdown: MARKDOWN, version: '1.0.0' })).toBe(
      '# Codebox 1.0.0\n\n- the first release',
    );
  });

  it('falls back to ## Unreleased when the version has no heading', () => {
    expect(releaseNotes({ markdown: MARKDOWN, version: '3.0.0' })).toBe(
      '# Codebox 3.0.0\n\n### Added\n\n- the thing that is not released yet',
    );
  });

  it('throws ReleaseNotesMissingError when nothing matches', () => {
    const result = () =>
      releaseNotes({ markdown: '# Changelog\n\n## [1.0.0]\n\n- one\n', version: '2.0.0' });

    expect(result).toThrow(ReleaseNotesMissingError);
  });

  it('throws ReleaseNotesMissingError on a matching but empty section', () => {
    const markdown = '## [2.0.0]\n\n## Unreleased\n\n- later\n';

    expect(() => releaseNotes({ markdown, version: '2.0.0' })).toThrow(ReleaseNotesMissingError);
  });

  it('reads the real ## Unreleased section for version 0.0.0', () => {
    const notes = releaseNotes({ markdown: fs.readFileSync(changelog, 'utf8'), version: '0.0.0' });

    expect(notes.startsWith('# Codebox 0.0.0\n\n')).toBe(true);
    const body = notes.slice('# Codebox 0.0.0\n\n'.length);
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/^## /m);
  });
});

describe('notes.mjs CLI', () => {
  it('writes the notes to stdout by default', () => {
    const file = path.join(tempDir(), 'CHANGELOG.md');
    fs.writeFileSync(file, MARKDOWN);

    const result = run(['--version', '1.0.0', '--changelog', file]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('# Codebox 1.0.0\n\n- the first release\n');
  });

  it('writes the notes to --out with a trailing newline', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), MARKDOWN);
    const out = path.join(dir, 'RELEASE-NOTES.md');

    const result = run([
      '--version',
      '1.2.0',
      '--changelog',
      path.join(dir, 'CHANGELOG.md'),
      '--out',
      out,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(fs.readFileSync(out, 'utf8')).toBe(
      '# Codebox 1.2.0\n\n### Fixed\n\n- the released fix\n',
    );
  });

  it('exits 4 when the section is missing', () => {
    const file = path.join(tempDir(), 'CHANGELOG.md');
    fs.writeFileSync(file, '# Changelog\n\n## [1.0.0]\n\n- one\n');

    const result = run(['--version', '9.9.9', '--changelog', file]);

    expect(result.status).toBe(4);
    expect(result.stderr).toContain('9.9.9');
  });

  it('exits 2 on an unknown flag and on a missing --version', () => {
    expect(run(['--nonsense']).status).toBe(2);
    expect(run(['--nonsense']).stderr).toContain('unknown option');
    expect(run([]).status).toBe(2);
    expect(run([]).stderr).toContain('--version is required');
  });

  it('prints the usage on --help', () => {
    const result = run(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('usage: node scripts/release/notes.mjs');
  });
});
