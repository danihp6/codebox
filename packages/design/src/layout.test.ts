import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DesignDocumentError,
  importDesign,
  parseImportMap,
  parseScreenSpec,
  parseTokens,
} from './index.js';
import type { FigmaFileSnapshot, ImportMap } from './index.js';

const TOKENS = parseTokens(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../design/tokens.json', import.meta.url)), 'utf8'),
  ) as unknown,
);

function jsonOf(url: URL): unknown {
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as unknown;
}

function regionDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Header',
    x: 0,
    y: 0,
    width: 390,
    height: 56,
    fill: 'color.surface.raised',
    radius: 8,
    stroke: 0,
    ...overrides,
  };
}

function typeRowDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'Title',
    family: 'Inter',
    weight: 600,
    size: 16,
    lineHeight: 24,
    colour: 'color.ink.text',
    ...overrides,
  };
}

function layoutDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    box: { x: 0, y: 0, width: 390, height: 844 },
    layoutMode: 'vertical',
    paddingTop: 16,
    paddingRight: 8,
    paddingBottom: 16,
    paddingLeft: 16,
    itemSpacing: 8,
    cornerRadius: 12,
    strokes: 0,
    inferred: false,
    regions: [
      regionDocument(),
      regionDocument({ name: 'Body', y: 64, height: 400, fill: null, radius: 0 }),
    ],
    type: [typeRowDocument()],
    ...overrides,
  };
}

function specDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    screen: 'Measured',
    route: '/measured',
    layout: layoutDocument(),
    ...overrides,
  };
}

function failureOf(document: unknown): DesignDocumentError {
  try {
    parseScreenSpec(document, TOKENS);
  } catch (error) {
    if (error instanceof DesignDocumentError) return error;
    throw error;
  }
  throw new Error('parseScreenSpec accepted an invalid screen spec');
}

describe('parseScreenSpec — layout', () => {
  it('keeps a measured layout and appends it after the four existing keys', () => {
    const spec = parseScreenSpec(specDocument(), TOKENS);

    expect(Object.keys(spec)).toEqual(['screen', 'route', 'states', 'snapshotSha256', 'layout']);
    expect(spec.layout).toEqual(layoutDocument());
    expect(spec.states).toEqual({ loading: null, empty: null, error: null });
  });

  it('accepts a negative x and y and every layout mode', () => {
    for (const layoutMode of ['none', 'horizontal', 'vertical']) {
      const layout = layoutDocument({
        box: { x: -120, y: -40, width: 390, height: 844 },
        layoutMode,
        inferred: layoutMode === 'none',
      });
      expect(parseScreenSpec(specDocument({ layout }), TOKENS).layout?.layoutMode).toBe(layoutMode);
    }
  });

  it('rejects a number that is not finite, a negative size and an unknown key', () => {
    const invalidLayouts = [
      layoutDocument({ box: { x: 0, y: 0, width: Infinity, height: 844 } }),
      layoutDocument({ box: { x: 0, y: Number.NaN, width: 390, height: 844 } }),
      layoutDocument({ box: { x: 0, y: 0, width: -1, height: 844 } }),
      layoutDocument({ paddingTop: -1 }),
      layoutDocument({ itemSpacing: -8 }),
      layoutDocument({ cornerRadius: -1 }),
      layoutDocument({ strokes: -1 }),
      layoutDocument({ inferred: 'yes' }),
      layoutDocument({ layoutMode: 'diagonal' }),
      layoutDocument({ regions: [regionDocument({ width: -10 })] }),
      layoutDocument({ regions: [regionDocument({ radius: -1 })] }),
      layoutDocument({ regions: [regionDocument({ stroke: -1 })] }),
      layoutDocument({ type: [typeRowDocument({ weight: -400 })] }),
      layoutDocument({ type: [typeRowDocument({ size: -16 })] }),
      layoutDocument({ type: [typeRowDocument({ lineHeight: -24 })] }),
      layoutDocument({ type: [typeRowDocument({ role: '   ' })] }),
      layoutDocument({ type: [typeRowDocument({ family: '  ' })] }),
      layoutDocument({ rows: [] }),
      layoutDocument({ regions: [{ name: 'Header', x: 0, y: 0 }] }),
    ];

    for (const layout of invalidLayouts) {
      const failure = failureOf(specDocument({ layout }));
      expect(failure.boundary).toBe('screen');
      expect(failure.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects a fill or colour that is not a dotted lowercase token key', () => {
    for (const fill of ['#0b0f14', 'Inter', 'Color.Brand.Green', 'color', 'color..green']) {
      expect(() =>
        parseScreenSpec(
          specDocument({ layout: layoutDocument({ regions: [regionDocument({ fill })] }) }),
          TOKENS,
        ),
      ).toThrow(DesignDocumentError);
    }
    for (const colour of ['#e6edf3', 'Inter', 'color']) {
      expect(() =>
        parseScreenSpec(
          specDocument({ layout: layoutDocument({ type: [typeRowDocument({ colour })] }) }),
          TOKENS,
        ),
      ).toThrow(DesignDocumentError);
    }
  });

  it('checks a fill against the token document and names the key and the path', () => {
    const layout = layoutDocument({
      regions: [
        regionDocument(),
        regionDocument({ name: 'Body', y: 64, height: 400, fill: null, radius: 0 }),
        regionDocument({ name: 'Brand', y: 472, height: 40, fill: 'color.brand.purple' }),
      ],
    });

    const failure = failureOf(specDocument({ layout }));
    expect(failure.issues).toEqual([
      { path: 'layout.regions.2.fill', message: 'unknown token key color.brand.purple' },
    ]);
    expect(failure.message).toBe('invalid design screen document');
  });

  it('checks a type colour against the token document', () => {
    const layout = layoutDocument({
      type: [typeRowDocument(), typeRowDocument({ role: 'Mono', colour: 'font.nope' })],
    });

    const failure = failureOf(specDocument({ layout }));
    expect(failure.issues).toEqual([
      { path: 'layout.type.1.colour', message: 'unknown token key font.nope' },
    ]);
  });

  it('leaves a layout alone when no token document is given', () => {
    const spec = parseScreenSpec(
      specDocument({
        layout: layoutDocument({ regions: [regionDocument({ fill: 'color.brand.purple' })] }),
      }),
    );

    expect(spec.layout?.regions[0]?.fill).toBe('color.brand.purple');
  });
});

describe('parseScreenSpec — no layout', () => {
  it('parses a spec without a layout and carries no layout key', () => {
    const spec = parseScreenSpec({ screen: 'Measured', route: '/measured' });

    expect(Object.hasOwn(spec, 'layout')).toBe(false);
    expect(JSON.stringify(spec)).not.toContain('layout');
  });

  it('round-trips both committed screen fixtures unchanged and gains no layout', () => {
    for (const name of ['dashboard', 'repo-backlog']) {
      const document = jsonOf(new URL(`./fixtures/screens/${name}.json`, import.meta.url));
      const spec = parseScreenSpec(document, TOKENS);

      expect(spec).toEqual(document);
      expect(Object.hasOwn(spec, 'layout')).toBe(false);
    }
  });
});

function layoutSnapshot(): FigmaFileSnapshot {
  return jsonOf(new URL('./fixtures/figma/layout.json', import.meta.url)) as FigmaFileSnapshot;
}

function layoutMap(): ImportMap {
  return parseImportMap({
    fileKey: '3HMV2UN6QviuNXe2T3Htsr',
    page: 'Page 1',
    frames: [
      {
        caption: '10 · Measured — mobile dark',
        screen: 'Measured',
        route: '/measured',
        component: 'MeasuredPage',
        states: { loading: null, empty: null, error: null },
        snapshot: false,
      },
    ],
  });
}

describe('importDesign — layout', () => {
  it('copies the frame layout into the spec and resolves its colours to token keys', () => {
    const snapshot = layoutSnapshot();
    const frame = snapshot.frames[0];
    const source = frame?.layout;
    if (source === undefined) throw new Error('the layout fixture has no frame layout');

    const result = importDesign({ snapshot, map: layoutMap(), tokens: TOKENS });
    const spec = result.screens[0];
    if (spec === undefined) throw new Error('importDesign dropped the mapped screen');
    const layout = spec.layout;
    if (layout === undefined) throw new Error('importDesign dropped the frame layout');

    expect(Object.keys(spec)).toEqual(['screen', 'route', 'states', 'snapshotSha256', 'layout']);
    expect(layout.box).toEqual(source.box);
    expect(layout.layoutMode).toBe('vertical');
    expect(layout.inferred).toBe(false);
    expect(layout).toEqual({
      box: { x: 100, y: 100, width: 390, height: 844 },
      layoutMode: 'vertical',
      paddingTop: 16,
      paddingRight: 8,
      paddingBottom: 16,
      paddingLeft: 16,
      itemSpacing: 8,
      cornerRadius: 12,
      strokes: 2,
      inferred: false,
      regions: [
        {
          name: 'Header',
          x: 16,
          y: 16,
          width: 358,
          height: 56,
          fill: 'color.surface.raised',
          radius: 8,
          stroke: 0,
        },
        {
          name: 'Title',
          x: 16,
          y: 80,
          width: 200,
          height: 24,
          fill: 'color.ink.text',
          radius: 0,
          stroke: 0,
        },
        {
          name: 'Dot',
          x: 16,
          y: 112,
          width: 20,
          height: 20,
          fill: null,
          radius: 10,
          stroke: 0,
        },
      ],
      type: [
        {
          role: 'Title',
          family: 'Inter',
          weight: 600,
          size: 16,
          lineHeight: 24,
          colour: 'color.ink.text',
        },
      ],
    });
  });

  it('projects every colour as null without a token document and copies the rest', () => {
    const result = importDesign({ snapshot: layoutSnapshot(), map: layoutMap() });
    const layout = result.screens[0]?.layout;
    if (layout === undefined) throw new Error('importDesign dropped the frame layout');

    expect(layout.regions.every((region) => region.fill === null)).toBe(true);
    expect(layout.type.every((row) => row.colour === null)).toBe(true);
    expect(layout.box).toEqual({ x: 100, y: 100, width: 390, height: 844 });
    expect(layout.paddingLeft).toBe(16);
    expect(layout.cornerRadius).toBe(12);
    expect(layout.strokes).toBe(2);
    expect(layout.regions).toHaveLength(3);
  });

  it('omits the layout of a frame the fixture does not measure', () => {
    const snapshot: FigmaFileSnapshot = {
      fileKey: 'file',
      page: 'Page 1',
      frames: [{ id: '1:1', caption: 'Plain', width: 10, height: 10, fills: [] }],
    };
    const map = parseImportMap({
      fileKey: 'file',
      page: 'Page 1',
      frames: [
        {
          caption: 'Plain',
          screen: 'Plain',
          route: '/plain',
          component: 'PlainPage',
          states: { loading: null, empty: null, error: null },
          snapshot: false,
        },
      ],
    });

    const result = importDesign({ snapshot, map, tokens: TOKENS });
    expect(Object.hasOwn(result.screens[0] as object, 'layout')).toBe(false);
  });

  it('keeps the projected layout valid for the parser', () => {
    const result = importDesign({ snapshot: layoutSnapshot(), map: layoutMap(), tokens: TOKENS });
    const spec = result.screens[0];

    expect(spec).toBeDefined();
    expect(parseScreenSpec(spec, TOKENS)).toEqual(spec);
  });
});
