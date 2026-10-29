import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import * as design from '../../packages/design/src/index.ts';
import { ImportCommandError, main, projectPage } from './import.mjs';

const KEY = '3HMV2UN6QviuNXe2T3Htsr';
const TOKEN = 'test-token';
const COMMITTED_TOKENS = fileURLToPath(new URL('../../design/tokens.json', import.meta.url));

const roots = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

function jsonFixture(name) {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'),
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nodeById(node, id) {
  const children = node.children;
  if (!Array.isArray(children)) return null;
  for (const child of children) {
    if (!isRecord(child)) continue;
    if (child.id === id) return child;
    const found = nodeById(child, id);
    if (found !== null) return found;
  }
  return null;
}

function frameOf(snapshot, id) {
  const frame = snapshot.frames.find((candidate) => candidate.id === id);
  if (frame === undefined) throw new Error(`no frame ${id}`);
  if (frame.layout === undefined) throw new Error(`frame ${id} has no layout`);
  return frame;
}

function failureOf(run) {
  try {
    run();
  } catch (error) {
    if (error instanceof ImportCommandError) return error;
    throw error;
  }
  throw new Error('projectPage accepted an invalid file');
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cb-design-layout-'));
  roots.push(root);
  mkdirSync(join(root, 'design'), { recursive: true });
  writeFileSync(join(root, 'design/tokens.json'), readFileSync(COMMITTED_TOKENS));
  copyFileSync(
    fileURLToPath(new URL('./fixtures/import-layout.json', import.meta.url)),
    join(root, 'design/import.json'),
  );
  return root;
}

function stubFetch(body) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.startsWith('https://api.figma.com/v1/files/')) {
      return { ok: true, status: 200, json: async () => body };
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { calls, fetch };
}

async function runMain(root, argv = ['--file', KEY, '--root', root]) {
  const stub = stubFetch(jsonFixture('file-layout.json'));
  const stdout = [];
  const stderr = [];
  const code = await main(argv, {
    env: { FIGMA_TOKEN: TOKEN, FIGMA_FILE_KEY: KEY },
    cwd: process.cwd(),
    fetch: stub.fetch,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    design,
  });
  return {
    code,
    calls: stub.calls,
    stdout,
    stderr,
    lines: stdout.join('').replace(/\n$/, '').split('\n'),
    err: stderr.join(''),
    drifts: stderr.filter((line) => line.startsWith('drift: ')),
  };
}

function tree(root, prefix = '') {
  const found = {};
  const directory = prefix === '' ? root : join(root, prefix);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(found, tree(root, relative));
    else found[relative] = readFileSync(join(root, relative)).toString('base64');
  }
  return found;
}

describe('projectPage — measured layout', () => {
  it('projects autolayout padding, gap, radius and stroke', () => {
    const snapshot = projectPage(jsonFixture('file-layout.json'), 'Page 1', KEY);
    const { layout } = frameOf(snapshot, '20:100');

    expect(layout.box).toEqual({ x: 100, y: 100, width: 390, height: 844 });
    expect(layout.layoutMode).toBe('vertical');
    expect(layout.paddingTop).toBe(16);
    expect(layout.paddingRight).toBe(8);
    expect(layout.paddingBottom).toBe(16);
    expect(layout.paddingLeft).toBe(16);
    expect(layout.itemSpacing).toBe(8);
    expect(layout.cornerRadius).toBe(12);
    expect(layout.strokes).toBe(2);
    expect(layout.inferred).toBe(false);
  });

  it('places each region relative to the frame in document order and keeps its paint', () => {
    const snapshot = projectPage(jsonFixture('file-layout.json'), 'Page 1', KEY);
    const { layout } = frameOf(snapshot, '20:100');

    expect(layout.regions).toEqual([
      {
        name: 'Header',
        x: 16,
        y: 16,
        width: 358,
        height: 56,
        fill: '#121821',
        radius: 8,
        stroke: 0,
      },
      {
        name: 'Title',
        x: 16,
        y: 80,
        width: 200,
        height: 24,
        fill: '#e6edf3',
        radius: 0,
        stroke: 0,
      },
      {
        name: 'Dot',
        x: 16,
        y: 112,
        width: 20,
        height: 20,
        fill: 'rgba(51, 102, 153, 0.25)',
        radius: 10,
        stroke: 0,
      },
      { name: 'Ghost', x: 16, y: 140, width: 100, height: 40, fill: null, radius: 0, stroke: 0 },
      { name: 'Stack', x: 16, y: 188, width: 200, height: 60, fill: null, radius: 0, stroke: 0 },
    ]);
    expect(layout.regions.map((region) => region.name)).not.toContain('Hidden');
  });

  it('collects the type scale from every TEXT node, distinct by row and in document order', () => {
    const snapshot = projectPage(jsonFixture('file-layout.json'), 'Page 1', KEY);
    const { layout } = frameOf(snapshot, '20:100');

    expect(layout.type).toEqual([
      {
        role: 'Title',
        family: 'Inter',
        weight: 600,
        size: 16,
        lineHeight: 24,
        colour: '#e6edf3',
      },
    ]);
  });

  it('falls back to reading order and zero padding without autolayout', () => {
    const snapshot = projectPage(jsonFixture('file-layout.json'), 'Page 1', KEY);
    const { layout } = frameOf(snapshot, '21:100');

    expect(layout.layoutMode).toBe('none');
    expect(layout.inferred).toBe(true);
    expect(layout.paddingTop).toBe(0);
    expect(layout.paddingLeft).toBe(0);
    expect(layout.itemSpacing).toBe(0);
    expect(layout.cornerRadius).toBe(16);
    expect(layout.strokes).toBe(0);
    expect(layout.regions.map((region) => region.name)).toEqual([
      'Top left',
      'Top right',
      'Bottom',
    ]);
    expect(layout.regions.map((region) => [region.x, region.y])).toEqual([
      [10, 100],
      [100, 100],
      [100, 500],
    ]);
    expect(layout.type).toEqual([]);
  });
});

describe('projectPage — page children', () => {
  it('projects a COMPONENT and the FRAME inside a SECTION, never the SECTION itself', () => {
    const snapshot = projectPage(jsonFixture('file-layout.json'), 'Page 1', KEY);
    const ids = snapshot.frames.map((frame) => frame.id);
    const captions = snapshot.frames.map((frame) => frame.caption);

    expect(ids).toEqual(['20:100', '21:100', '22:100', '23:100']);
    expect(captions).toContain('12 · Component — dark');
    expect(captions).toContain('13 · In section — dark');
    expect(captions).not.toContain('13 · Section — dark');
    expect(captions).not.toContain('Annotation');
    expect(snapshot.frames.every((frame) => frame.layout !== undefined)).toBe(true);
  });

  it('measures the component and the section frame on their own origin', () => {
    const snapshot = projectPage(jsonFixture('file-layout.json'), 'Page 1', KEY);

    expect(frameOf(snapshot, '22:100').layout.regions).toEqual([
      { name: 'Card', x: 0, y: 0, width: 390, height: 200, fill: '#121821', radius: 8, stroke: 0 },
    ]);
    expect(frameOf(snapshot, '23:100').layout.strokes).toBe(1.5);
    expect(frameOf(snapshot, '23:100').layout.regions).toEqual([
      { name: 'Row', x: 0, y: 0, width: 390, height: 60, fill: '#8b98a5', radius: 4, stroke: 0 },
    ]);
  });

  it('leaves a frame without a measurable child and every legacy frame unmeasured', () => {
    const body = jsonFixture('file-layout.json');
    const component = nodeById(body.document, '22:100');
    delete component.children[0].absoluteBoundingBox;

    const snapshot = projectPage(body, 'Page 1', KEY);
    const frame = snapshot.frames.find((candidate) => candidate.id === '22:100');
    expect(Object.hasOwn(frame, 'layout')).toBe(false);

    const legacy = projectPage(jsonFixture('file.json'), 'Page 1', KEY);
    const devices = legacy.frames.find((candidate) => candidate.id === '8:170');
    expect(devices).toBeDefined();
    expect(Object.hasOwn(devices, 'layout')).toBe(false);
  });

  it('fails a TEXT node without a style or without a size', () => {
    const noStyle = jsonFixture('file-layout.json');
    delete nodeById(noStyle.document, '20:102').style;
    const styleFailure = failureOf(() => projectPage(noStyle, 'Page 1', KEY));
    expect(styleFailure.code).toBe('file_invalid');
    expect(styleFailure.exitCode).toBe(1);
    expect(styleFailure.message).toContain("text node '20:102' has no style");

    const noSize = jsonFixture('file-layout.json');
    nodeById(noSize.document, '20:102').style.fontSize = Number.NaN;
    const sizeFailure = failureOf(() => projectPage(noSize, 'Page 1', KEY));
    expect(sizeFailure.code).toBe('file_invalid');
    expect(sizeFailure.message).toContain("text node '20:102'");
  });
});

describe('main — measured layout', () => {
  it('writes token keys into the specs and a stable --check', async () => {
    const root = makeRoot();
    const written = await runMain(root);
    expect(written.code).toBe(0);
    expect(written.lines[0]).toBe('wrote design/routes.json (2 routes)');
    expect(written.lines).toContain('wrote design/screens/component-measured.json');
    expect(written.lines).toContain('wrote design/screens/section-measured.json');
    expect(JSON.parse(written.lines[written.lines.length - 1])).toEqual({
      frames: 4,
      mapped: 2,
      unmapped: 2,
      colours: 3,
      coloursOutsideTokens: 0,
      routes: 2,
      screens: 2,
      exports: 0,
    });
    expect(written.err).toBe('');

    const tokens = design.parseTokens(
      JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8')),
    );
    const component = design.parseScreenSpec(
      JSON.parse(readFileSync(join(root, 'design/screens/component-measured.json'), 'utf8')),
      tokens,
    );
    const section = design.parseScreenSpec(
      JSON.parse(readFileSync(join(root, 'design/screens/section-measured.json'), 'utf8')),
      tokens,
    );

    expect(Object.keys(component)).toEqual([
      'screen',
      'route',
      'states',
      'snapshotSha256',
      'layout',
    ]);
    expect(component.layout?.regions.map((region) => region.fill)).toEqual([
      'color.surface.raised',
    ]);
    expect(section.layout?.regions.map((region) => region.fill)).toEqual(['color.ink.muted']);
    expect(section.layout?.strokes).toBe(1.5);
    expect(readFileSync(join(root, 'design/screens/section-measured.json'), 'utf8')).toContain(
      '"fill": "color.ink.muted"',
    );

    const before = tree(root);
    const checked = await runMain(root, ['--file', KEY, '--root', root, '--check']);
    expect(checked.code).toBe(0);
    expect(checked.drifts).toEqual([]);
    expect(checked.err).toBe('');
    expect(tree(root)).toEqual(before);
  });
});
