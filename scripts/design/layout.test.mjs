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
      {
        name: 'Title',
        x: 20,
        y: 192,
        width: 200,
        height: 24,
        fill: '#e6edf3',
        radius: 0,
        stroke: 0,
      },
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

function bandBody() {
  const bgFill = [{ type: 'SOLID', color: { r: 0.043, g: 0.059, b: 0.078 } }];
  const raisedFill = [{ type: 'SOLID', color: { r: 0.071, g: 0.094, b: 0.129 } }];
  const inkFill = [{ type: 'SOLID', color: { r: 0.902, g: 0.929, b: 0.953 } }];
  const mutedFill = [{ type: 'SOLID', color: { r: 0.545, g: 0.596, b: 0.647 } }];
  const greenFill = [{ type: 'SOLID', color: { r: 0.0823529, g: 0.5019608, b: 0.2392157 } }];
  const statusStyle = { fontFamily: 'Inter', fontWeight: 400, fontSize: 12, lineHeightPx: 16 };
  const rowStyle = { fontFamily: 'Inter', fontWeight: 600, fontSize: 16, lineHeightPx: 24 };
  return {
    name: 'codebox',
    document: {
      id: '0:0',
      name: 'Document',
      type: 'DOCUMENT',
      children: [
        {
          id: '0:3',
          name: 'Page 1',
          type: 'CANVAS',
          children: [
            {
              id: '30:100',
              name: '20 · Banded — mobile dark',
              type: 'FRAME',
              absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
              layoutMode: 'VERTICAL',
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              paddingLeft: 0,
              itemSpacing: 0,
              fills: bgFill,
              children: [
                {
                  id: '30:101',
                  name: 'bd-band-status',
                  type: 'FRAME',
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 40 },
                  fills: [],
                  children: [
                    {
                      id: '30:102',
                      name: 'Status right',
                      type: 'TEXT',
                      absoluteBoundingBox: { x: 300, y: 8, width: 66, height: 20 },
                      style: statusStyle,
                      fills: mutedFill,
                    },
                    {
                      id: '30:103',
                      name: 'Status time',
                      type: 'TEXT',
                      absoluteBoundingBox: { x: 24, y: 8, width: 60, height: 20 },
                      style: statusStyle,
                      fills: inkFill,
                    },
                  ],
                },
                {
                  id: '30:110',
                  name: 'bd-band-content',
                  type: 'FRAME',
                  absoluteBoundingBox: { x: 0, y: 40, width: 390, height: 700 },
                  fills: [],
                  children: [
                    {
                      id: '30:111',
                      name: 'Row',
                      type: 'FRAME',
                      absoluteBoundingBox: { x: 16, y: 56, width: 358, height: 64 },
                      cornerRadius: 8,
                      fills: raisedFill,
                      children: [
                        {
                          id: '30:112',
                          name: 'Row title',
                          type: 'TEXT',
                          absoluteBoundingBox: { x: 28, y: 72, width: 120, height: 20 },
                          style: rowStyle,
                          fills: inkFill,
                        },
                      ],
                    },
                    {
                      id: '30:120',
                      name: 'bd-band-inner',
                      type: 'FRAME',
                      absoluteBoundingBox: { x: 16, y: 136, width: 358, height: 120 },
                      fills: [],
                      children: [
                        {
                          id: '30:121',
                          name: 'bd-band-deep',
                          type: 'FRAME',
                          absoluteBoundingBox: { x: 16, y: 136, width: 358, height: 120 },
                          fills: [],
                          children: [
                            {
                              id: '30:122',
                              name: 'Chip',
                              type: 'RECTANGLE',
                              absoluteBoundingBox: { x: 24, y: 150, width: 100, height: 32 },
                              cornerRadius: 4,
                              fills: greenFill,
                            },
                            {
                              id: '30:123',
                              name: 'Ghost',
                              type: 'RECTANGLE',
                              absoluteBoundingBox: { x: 140, y: 150, width: 100, height: 32 },
                              fills: [{ type: 'GRADIENT_LINEAR', gradientStops: [] }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  id: '30:130',
                  name: 'bd-band-tabbar',
                  type: 'FRAME',
                  absoluteBoundingBox: { x: 0, y: 740, width: 390, height: 104 },
                  strokeWeight: 1.5,
                  strokes: [
                    { type: 'SOLID', color: { r: 0.545, g: 0.596, b: 0.647 }, visible: true },
                  ],
                  fills: [],
                  children: [
                    {
                      id: '30:131',
                      name: 'Tab',
                      type: 'RECTANGLE',
                      absoluteBoundingBox: { x: 0, y: 760, width: 130, height: 64 },
                      fills: raisedFill,
                    },
                  ],
                },
              ],
            },
            {
              id: '31:100',
              name: '21 · Banded inferred — mobile dark',
              type: 'FRAME',
              absoluteBoundingBox: { x: 500, y: 0, width: 390, height: 844 },
              fills: bgFill,
              children: [
                {
                  id: '31:101',
                  name: 'inf-band-b',
                  type: 'FRAME',
                  absoluteBoundingBox: { x: 500, y: 300, width: 390, height: 100 },
                  fills: [],
                  children: [
                    {
                      id: '31:102',
                      name: 'B left',
                      type: 'RECTANGLE',
                      absoluteBoundingBox: { x: 516, y: 316, width: 100, height: 40 },
                    },
                    {
                      id: '31:103',
                      name: 'B right',
                      type: 'RECTANGLE',
                      absoluteBoundingBox: { x: 600, y: 316, width: 100, height: 40 },
                    },
                  ],
                },
                {
                  id: '31:104',
                  name: 'inf-band-a',
                  type: 'FRAME',
                  absoluteBoundingBox: { x: 500, y: 100, width: 390, height: 100 },
                  fills: [],
                  children: [
                    {
                      id: '31:105',
                      name: 'A right',
                      type: 'RECTANGLE',
                      absoluteBoundingBox: { x: 600, y: 116, width: 100, height: 40 },
                    },
                    {
                      id: '31:106',
                      name: 'A left',
                      type: 'RECTANGLE',
                      absoluteBoundingBox: { x: 516, y: 116, width: 100, height: 40 },
                    },
                  ],
                },
              ],
            },
            {
              id: '32:100',
              name: '22 · Banded empty — mobile dark',
              type: 'FRAME',
              absoluteBoundingBox: { x: 1000, y: 0, width: 390, height: 844 },
              layoutMode: 'VERTICAL',
              fills: bgFill,
              children: [
                {
                  id: '32:101',
                  name: 'bd-band-empty',
                  type: 'FRAME',
                  absoluteBoundingBox: { x: 1000, y: 0, width: 390, height: 844 },
                  fills: [],
                  children: [{ id: '32:102', name: 'No box', type: 'RECTANGLE', fills: [] }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('projectPage — bands', () => {
  it('projects one region per leaf through a fill-less band', () => {
    const snapshot = projectPage(bandBody(), 'Page 1', KEY);
    const { layout } = frameOf(snapshot, '30:100');

    expect(layout.regions).toEqual([
      {
        name: 'Status right',
        x: 300,
        y: 8,
        width: 66,
        height: 20,
        fill: '#8b98a5',
        radius: 0,
        stroke: 0,
      },
      {
        name: 'Status time',
        x: 24,
        y: 8,
        width: 60,
        height: 20,
        fill: '#e6edf3',
        radius: 0,
        stroke: 0,
      },
      {
        name: 'Row',
        x: 16,
        y: 56,
        width: 358,
        height: 64,
        fill: '#121821',
        radius: 8,
        stroke: 0,
      },
      {
        name: 'Chip',
        x: 24,
        y: 150,
        width: 100,
        height: 32,
        fill: '#15803d',
        radius: 4,
        stroke: 0,
      },
      {
        name: 'Ghost',
        x: 140,
        y: 150,
        width: 100,
        height: 32,
        fill: null,
        radius: 0,
        stroke: 0,
      },
      {
        name: 'bd-band-tabbar',
        x: 0,
        y: 740,
        width: 390,
        height: 104,
        fill: null,
        radius: 0,
        stroke: 1.5,
      },
    ]);
    expect(layout.layoutMode).toBe('vertical');
    expect(layout.inferred).toBe(false);
    expect(layout.box).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(layout.paddingTop).toBe(0);
    expect(layout.paddingRight).toBe(0);
    expect(layout.paddingBottom).toBe(0);
    expect(layout.paddingLeft).toBe(0);
    expect(layout.itemSpacing).toBe(0);
    expect(layout.type).toEqual([
      {
        role: 'Status right',
        family: 'Inter',
        weight: 400,
        size: 12,
        lineHeight: 16,
        colour: '#8b98a5',
      },
      {
        role: 'Status time',
        family: 'Inter',
        weight: 400,
        size: 12,
        lineHeight: 16,
        colour: '#e6edf3',
      },
      {
        role: 'Row title',
        family: 'Inter',
        weight: 600,
        size: 16,
        lineHeight: 24,
        colour: '#e6edf3',
      },
    ]);
  });

  it('keeps a child frame that paints as one region', () => {
    const snapshot = projectPage(bandBody(), 'Page 1', KEY);
    const { layout } = frameOf(snapshot, '30:100');
    const names = layout.regions.map((region) => region.name);
    const row = layout.regions.find((region) => region.name === 'Row');
    const tabbar = layout.regions.find((region) => region.name === 'bd-band-tabbar');

    expect(row).toEqual({
      name: 'Row',
      x: 16,
      y: 56,
      width: 358,
      height: 64,
      fill: '#121821',
      radius: 8,
      stroke: 0,
    });
    expect(names).not.toContain('Row title');
    expect(tabbar).toEqual({
      name: 'bd-band-tabbar',
      x: 0,
      y: 740,
      width: 390,
      height: 104,
      fill: null,
      radius: 0,
      stroke: 1.5,
    });
    expect(names).not.toContain('Tab');
  });

  it('recurses two bands deep and emits no transparent band', () => {
    const snapshot = projectPage(bandBody(), 'Page 1', KEY);
    const { layout } = frameOf(snapshot, '30:100');
    const names = layout.regions.map((region) => region.name);
    const chip = layout.regions.find((region) => region.name === 'Chip');
    const ghost = layout.regions.find((region) => region.name === 'Ghost');

    expect(chip).toMatchObject({ x: 24, y: 150 });
    expect(ghost).toEqual({
      name: 'Ghost',
      x: 140,
      y: 150,
      width: 100,
      height: 32,
      fill: null,
      radius: 0,
      stroke: 0,
    });
    expect(names).not.toContain('bd-band-inner');
    expect(names).not.toContain('bd-band-deep');
    expect(names).not.toContain('bd-band-content');
  });

  it('orders banded regions in reading order without autolayout and in document order with it', () => {
    const snapshot = projectPage(bandBody(), 'Page 1', KEY);
    const inferred = frameOf(snapshot, '31:100').layout;

    expect(inferred.inferred).toBe(true);
    expect(inferred.layoutMode).toBe('none');
    expect(inferred.regions.map((region) => region.name)).toEqual([
      'A left',
      'A right',
      'B left',
      'B right',
    ]);
    expect(inferred.regions.map((region) => [region.x, region.y])).toEqual([
      [16, 116],
      [100, 116],
      [16, 316],
      [100, 316],
    ]);
    expect(frameOf(snapshot, '30:100').layout.regions.map((region) => region.name)).toEqual([
      'Status right',
      'Status time',
      'Row',
      'Chip',
      'Ghost',
      'bd-band-tabbar',
    ]);
  });

  it('writes no layout when every band is empty or unmeasurable', () => {
    const snapshot = projectPage(bandBody(), 'Page 1', KEY);
    const frame = snapshot.frames.find((candidate) => candidate.id === '32:100');

    expect(Object.hasOwn(frame, 'layout')).toBe(false);
    expect(snapshot.frames.map((candidate) => candidate.id)).toEqual([
      '30:100',
      '31:100',
      '32:100',
    ]);
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
