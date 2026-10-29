import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DesignImportError,
  checkDocuments,
  importDesign,
  parseImportMap,
  parseRoutes,
  parseScreenSpec,
  parseTokens,
  snapshotHash,
  snapshotSha256,
} from './index.js';
import type {
  DesignImportInput,
  DesignImportResult,
  FigmaFileSnapshot,
  ImportMap,
} from './index.js';

const SHIPPED_MAP = new URL('../../../design/import.json', import.meta.url);
const EXPORT = new URL('./fixtures/figma/export-dashboard.png', import.meta.url);
const DASHBOARD_CAPTION = '05 · Dashboard — mobile dark';
const DASHBOARD_INDEX = 5;

function jsonOf(url: URL): unknown {
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as unknown;
}

function fileSnapshot(name: 'file.json' | 'file-missing.json'): FigmaFileSnapshot {
  return jsonOf(new URL(`./fixtures/figma/${name}`, import.meta.url)) as FigmaFileSnapshot;
}

function fixtureMap(): ImportMap {
  return parseImportMap(jsonOf(new URL('./fixtures/figma/import.json', import.meta.url)));
}

function importedFixture(): DesignImportResult {
  return importDesign({ snapshot: fileSnapshot('file.json'), map: fixtureMap() });
}

function mutableShippedMap(): Record<string, unknown> {
  return jsonOf(SHIPPED_MAP) as Record<string, unknown>;
}

function framesOf(map: Record<string, unknown>): Record<string, unknown>[] {
  return map['frames'] as Record<string, unknown>[];
}

function frameAt(map: Record<string, unknown>, index: number): Record<string, unknown> {
  return framesOf(map)[index] as Record<string, unknown>;
}

function parseFailure(input: unknown): DesignImportError {
  try {
    parseImportMap(input);
  } catch (error) {
    if (error instanceof DesignImportError) return error;
    throw error;
  }
  throw new Error('parseImportMap accepted an invalid map');
}

function importFailure(input: DesignImportInput): DesignImportError {
  try {
    importDesign(input);
  } catch (error) {
    if (error instanceof DesignImportError) return error;
    throw error;
  }
  throw new Error('importDesign accepted a page without the mapped frame');
}

function issuePaths(error: DesignImportError): readonly string[] {
  return error.issues.map((issue) => issue.path);
}

describe('importDesign', () => {
  it('projects the mapped frames in map order and ignores the frames outside the map', () => {
    const result = importedFixture();

    expect(fileSnapshot('file.json').frames).toHaveLength(13);
    expect(result.routes).toHaveLength(11);
    expect(result.screens).toHaveLength(11);
    expect(result.routes[DASHBOARD_INDEX]).toEqual({
      path: '/dashboard',
      screen: 'Dashboard',
      component: 'DashboardPage',
    });
    expect(result.screens[DASHBOARD_INDEX]?.screen).toBe('Dashboard');
    expect(result.screens.every((spec) => spec.snapshotSha256 === null)).toBe(true);
  });

  it('collects the mapped fills only: lowercased, deduplicated and sorted', () => {
    const colours = importedFixture().colours;

    expect(colours).toEqual(['#0b0f14', '#121821', '#22c55e', '#8b98a5', '#e6edf3', '#f59e0b']);
    expect(colours).not.toContain('#ff00ff');
    expect(colours).not.toContain('#abcdef');
    expect(colours).toEqual([...new Set(colours)].sort());
    expect(colours.every((colour) => colour === colour.trim().toLowerCase())).toBe(true);
  });

  it('fails a mapped caption the page does not carry, naming the map entry', () => {
    const failure = importFailure({
      snapshot: fileSnapshot('file-missing.json'),
      map: fixtureMap(),
    });

    expect(failure.code).toBe('frame_missing');
    expect(failure.caption).toBe(DASHBOARD_CAPTION);
    expect(failure.path).toBe('frames.5.caption');
    expect(issuePaths(failure)).toEqual(['frames.5.caption']);
    expect(failure.message).toContain(DASHBOARD_CAPTION);
    expect(failure.name).toBe('DesignImportError');
  });

  it('hashes the export the map asks for and leaves every other spec null', () => {
    const bytes = readFileSync(fileURLToPath(EXPORT));
    const hash = snapshotSha256(bytes);

    expect(hash).toBe(snapshotHash(bytes));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const result = importDesign({
      snapshot: fileSnapshot('file.json'),
      map: fixtureMap(),
      exports: { [DASHBOARD_CAPTION]: bytes },
    });

    result.screens.forEach((spec, index) => {
      expect(spec.snapshotSha256).toBe(index === DASHBOARD_INDEX ? hash : null);
    });
  });

  it('ignores supplied bytes for an entry that declines a snapshot', () => {
    const map = mutableShippedMap();
    frameAt(map, DASHBOARD_INDEX)['snapshot'] = false;

    const result = importDesign({
      snapshot: fileSnapshot('file.json'),
      map: parseImportMap(map),
      exports: { [DASHBOARD_CAPTION]: readFileSync(fileURLToPath(EXPORT)) },
    });

    expect(result.screens[DASHBOARD_INDEX]?.snapshotSha256).toBeNull();
  });
});

describe('parseImportMap', () => {
  it('reads the shipped map, and the package copy is byte-identical to it', () => {
    const map = parseImportMap(jsonOf(SHIPPED_MAP));

    expect(map.frames).toHaveLength(11);
    expect(map.frames.every((frame) => frame.snapshot)).toBe(true);
    expect(
      readFileSync(new URL('./fixtures/figma/import.json', import.meta.url)).equals(
        readFileSync(SHIPPED_MAP),
      ),
    ).toBe(true);
  });

  it('accepts an empty frame list', () => {
    const map = parseImportMap({ fileKey: 'key', page: 'Page 1', frames: [] });

    expect(map.frames).toEqual([]);
    expect(importDesign({ snapshot: { fileKey: 'key', page: 'Page 1', frames: [] }, map })).toEqual(
      { routes: [], screens: [], colours: [] },
    );
  });

  it('requires the three states and takes an empty one as null', () => {
    const map = mutableShippedMap();
    const states = frameAt(map, 0)['states'] as Record<string, unknown>;
    delete states['empty'];

    const failure = parseFailure(map);
    expect(failure.code).toBe('map_invalid');
    expect(failure.path).toBe('frames.0.states.empty');
    expect(issuePaths(failure)).toContain('frames.0.states.empty');
    expect(failure.message).toBe('invalid import map');

    states['empty'] = null;
    const result = importDesign({ snapshot: fileSnapshot('file.json'), map: parseImportMap(map) });
    expect(result.screens[0]?.states.empty).toBeNull();
  });

  it('rejects a component that check.ts would flag', () => {
    for (const component of ['', 'dashboardPage', '9Page']) {
      const map = mutableShippedMap();
      frameAt(map, 0)['component'] = component;

      const failure = parseFailure(map);
      expect(failure.code).toBe('map_invalid');
      expect(issuePaths(failure)).toContain('frames.0.component');
    }
  });

  it('rejects a repeated caption, screen or route', () => {
    for (const field of ['caption', 'screen', 'route'] as const) {
      const map = mutableShippedMap();
      frameAt(map, 1)[field] = frameAt(map, 0)[field];

      const failure = parseFailure(map);
      expect(failure.code).toBe('map_invalid');
      expect(issuePaths(failure)).toContain(`frames.1.${field}`);
    }
  });

  it('rejects a document that is not a map, an unknown key and a broken entry', () => {
    for (const document of [
      null,
      [],
      'map',
      { fileKey: 'key', page: 'Page 1' },
      { fileKey: 'key', page: 'Page 1', frames: [], extra: true },
      { fileKey: '', page: 'Page 1', frames: [] },
      { fileKey: 'key', page: 'Page 1', frames: [null] },
      { fileKey: 'key', page: 'Page 1', frames: [{}] },
    ]) {
      const failure = parseFailure(document);
      expect(failure.code).toBe('map_invalid');
      expect(failure.message).toBe('invalid import map');
    }
  });

  it('rejects an unknown state key and a state that is neither null nor a string', () => {
    for (const states of [
      { loading: null, empty: null, error: null, paused: 'x' },
      { loading: 3 },
      { loading: '   ' },
    ]) {
      const map = mutableShippedMap();
      frameAt(map, 0)['states'] = states;

      expect(parseFailure(map).code).toBe('map_invalid');
    }
  });
});

describe('round trip', () => {
  it('re-parses as routes and screen specs and never trips route_without_component', () => {
    const result = importedFixture();
    const routes = parseRoutes({ routes: result.routes });

    expect(routes).toHaveLength(11);
    for (const spec of result.screens) expect(parseScreenSpec(spec)).toEqual(spec);

    const findings = checkDocuments({
      tokens: parseTokens(jsonOf(new URL('./fixtures/tokens.json', import.meta.url))),
      routes,
      screens: result.screens,
    }).filter((finding) => finding.rule === 'route_without_component');

    expect(findings).toEqual([]);
  });
});

describe('fixture export', () => {
  it('is a real PNG under the export budget', () => {
    const bytes = readFileSync(fileURLToPath(EXPORT));

    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.byteLength).toBeLessThanOrEqual(409_600);
  });
});
