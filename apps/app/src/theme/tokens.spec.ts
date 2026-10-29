import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_TOKENS } from './tokens';

const APP = resolve(process.cwd());
const ROOT = resolve(APP, '../..');
const DOCUMENT = parseJson(readFileSync(resolve(ROOT, 'design/tokens.json'), 'utf8'));
const CSS = readFileSync(resolve(APP, 'src/theme/variables.css'), 'utf8');

const COLOURS = [
  '#0b0f14',
  '#121821',
  '#15803d',
  '#22c55e',
  '#5b6772',
  '#8b98a5',
  '#b45309',
  '#e6edf3',
  '#ef4444',
  '#f59e0b',
  '#f7f9fb',
  '#ffffff',
] as const;

const COLOUR_KEYS = ['bg', 'surface', 'text', 'muted', 'accent', 'warn', 'danger'] as const;

const MONO = "ui-monospace, sfmono-regular, menlo, consolas, 'Liberation Mono', monospace";
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const IMPORT = "@import '@fontsource-variable/inter';";

interface Leaf {
  path: string;
  value: string;
  type: string;
}

function parseJson(source: string): unknown {
  return JSON.parse(source) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flatten(node: unknown, prefix = ''): Leaf[] {
  if (!isRecord(node)) return [];
  const value = node['$value'];
  if (typeof value === 'string') {
    const type = node['$type'];
    return [{ path: prefix, value, type: typeof type === 'string' ? type : '' }];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    flatten(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

function colourValues(): string[] {
  return leaves()
    .filter((leaf) => leaf.type === 'color')
    .map((leaf) => leaf.value.toLowerCase())
    .sort();
}

function leaves(): Leaf[] {
  return flatten(DOCUMENT);
}

function leafAt(path: string): Leaf | undefined {
  return leaves().find((leaf) => leaf.path === path);
}

function declaration(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(CSS);
  return match?.[1]?.trim() ?? '';
}

describe('design/tokens.json', () => {
  it('flattens to fourteen leaves', () => {
    expect(leaves()).toHaveLength(14);
    expect(leaves().map((leaf) => leaf.path).sort()).toEqual([
      'color.brand.bright',
      'color.brand.green',
      'color.danger.red',
      'color.ink.muted',
      'color.ink.muted-light',
      'color.ink.text',
      'color.surface.bg',
      'color.surface.bg-light',
      'color.surface.raised',
      'color.surface.raised-light',
      'color.waiting.amber',
      'color.waiting.bright',
      'font.mono',
      'font.sans',
    ]);
  });

  it('keeps exactly the twelve colour leaves and their values', () => {
    expect(leaves().filter((leaf) => leaf.type === 'color')).toHaveLength(12);
    expect(colourValues()).toEqual([...COLOURS].sort());
  });

  it('adds exactly font.sans and font.mono as fontFamily leaves', () => {
    const fonts = leaves().filter((leaf) => leaf.type === 'fontFamily');

    expect(fonts.map((leaf) => leaf.path).sort()).toEqual(['font.mono', 'font.sans']);
    expect(leafAt('font.sans')?.value).toBe('Inter Variable');
    expect(leafAt('font.mono')?.value).toBe(MONO);
  });

  it('has no leaf of another type and no fontFamily value that reads as a colour', () => {
    for (const leaf of leaves()) {
      expect(['color', 'fontFamily'], leaf.path).toContain(leaf.type);
    }
    for (const leaf of leaves().filter((candidate) => candidate.type === 'fontFamily')) {
      expect(HEX.test(leaf.value), leaf.path).toBe(false);
      expect(colourValues()).not.toContain(leaf.value.toLowerCase());
    }
  });
});

describe('THEME_TOKENS', () => {
  it('names the bundled face and mirrors the mono token', () => {
    expect(THEME_TOKENS.fontSans).toContain('Inter Variable');
    expect(THEME_TOKENS.fontMono).toBe(leafAt('font.mono')?.value);
  });

  it('draws its seven colours from the twelve leaves', () => {
    const values = colourValues();

    for (const key of COLOUR_KEYS) {
      expect(values, key).toContain(THEME_TOKENS[key].toLowerCase());
    }
  });
});

describe('variables.css', () => {
  it('imports the font package exactly once and nothing else', () => {
    expect(CSS.split(IMPORT)).toHaveLength(2);
    expect(CSS.match(/@import/g)).toHaveLength(1);
    expect(CSS.startsWith(IMPORT)).toBe(true);
  });

  it('points the Ionic face and the sans token at Inter', () => {
    expect(declaration('--ion-font-family').startsWith("'Inter Variable'")).toBe(true);
    expect(declaration('--cb-font-sans').startsWith("'Inter Variable'")).toBe(true);
    expect(declaration('--cb-font-mono')).toBe(leafAt('font.mono')?.value);
  });
});
