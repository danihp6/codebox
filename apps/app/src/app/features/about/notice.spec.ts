import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTICE_TEXT, THIRD_PARTY_NOTICES, parseNotice } from './notice';

const REPOSITORY_NOTICE = resolve(process.cwd(), '../../NOTICE');

describe('notice', () => {
  it('ships the repository NOTICE verbatim', () => {
    expect(NOTICE_TEXT.trim()).toBe(readFileSync(REPOSITORY_NOTICE, 'utf8').trim());
  });

  it('derives the shipped list from the shipped text', () => {
    expect(THIRD_PARTY_NOTICES).toEqual(parseNotice(NOTICE_TEXT));
    expect(THIRD_PARTY_NOTICES.length).toBeGreaterThan(0);
  });

  it('returns nothing for empty input', () => {
    expect(parseNotice('')).toEqual([]);
  });

  it('parses a bullet into name, version, licence and label in file order', () => {
    expect(parseNotice('- hono@4.13.13 — MIT\n- rxjs@7.8.2 — Apache-2.0\n')).toEqual([
      { name: 'hono', version: '4.13.13', licence: 'MIT', label: 'hono@4.13.13' },
      { name: 'rxjs', version: '7.8.2', licence: 'Apache-2.0', label: 'rxjs@7.8.2' },
    ]);
  });

  it('keeps a scoped name and splits the label at the last @', () => {
    expect(parseNotice('- @angular/core@22.2.3 — MIT\n')).toEqual([
      { name: '@angular/core', version: '22.2.3', licence: 'MIT', label: '@angular/core@22.2.3' },
    ]);
  });

  it('skips prose, malformed bullets and everything after the heading', () => {
    const text = [
      'This distribution includes the following third-party packages:',
      '- hono@4.13.13 — MIT',
      '- not a package',
      '- three@1.0.0 — MIT — extra',
      '- empty@1.0.0 — ',
      'Copyleft exceptions',
      '- zod@4.6.7 — MIT',
      '',
    ].join('\n');

    expect(parseNotice(text)).toEqual([
      { name: 'hono', version: '4.13.13', licence: 'MIT', label: 'hono@4.13.13' },
    ]);
  });

  it('lists the packages the repository ships with their licences', () => {
    const licenceOf = (name: string): string | undefined =>
      THIRD_PARTY_NOTICES.find((notice) => notice.name === name)?.licence;

    expect(licenceOf('hono')).toBe('MIT');
    expect(licenceOf('rxjs')).toBe('Apache-2.0');
    expect(licenceOf('tslib')).toBe('0BSD');
    expect(licenceOf('@angular/core')).toBe('MIT');
  });
});
