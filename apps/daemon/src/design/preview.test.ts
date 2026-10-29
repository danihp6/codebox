import { describe, expect, it } from 'vitest';
import { parseDesignPreview } from '@codebox/contracts';
import { DesignPreviewError, buildDesignPreview } from './preview.js';
import type { DesignPreviewInput, DesignSource } from './preview.js';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const REVISION = '9f1c2ab';
const CHECKED_AT = '2026-10-29T10:00:00Z';

const TOKENS = `{
  "space": { "gap": { "$value": 8, "$type": "dimension" } },
  "color": {
    "surface": { "night": { "$value": "#0b1120", "$type": "color" } },
    "brand": { "bright": { "$value": "#22c55e", "$type": "color" } }
  }
}`;

const ROUTES = `{
  "routes": [
    { "path": "/repos/:id", "screen": "Repo · backlog", "component": "RepoBacklogPage" },
    { "path": "/dashboard", "screen": "Dashboard" }
  ]
}`;

const SCREENS = [
  {
    file: 'design/screens/repo-backlog.json',
    text: `{
      "screen": "Repo · backlog",
      "route": "/repos/:id",
      "states": { "loading": "Rows grey", "empty": "Empty file", "error": "Envelope" }
    }`,
  },
  {
    file: 'design/screens/dashboard.json',
    text: `{
      "screen": "Dashboard",
      "route": "/dashboard",
      "states": { "loading": "Skeleton", "empty": null, "error": "Envelope" },
      "snapshotSha256": null
    }`,
  },
];

const SOURCE: DesignSource = { tokens: TOKENS, routes: ROUTES, screens: SCREENS };

function input(source: DesignSource = SOURCE): DesignPreviewInput {
  return { repoId: REPO_ID, revision: REVISION, checkedAt: CHECKED_AT, source };
}

function thrown(build: () => unknown): unknown {
  try {
    build();
  } catch (error) {
    return error;
  }
  return null;
}

describe('buildDesignPreview', () => {
  it('answers present with empty collections when there is no token document', () => {
    const preview = buildDesignPreview(input({ tokens: null, routes: ROUTES, screens: SCREENS }));
    expect(preview).toEqual({
      repoId: REPO_ID,
      revision: REVISION,
      present: false,
      tokens: [],
      routes: [],
      screens: [],
      findings: [],
      checkedAt: CHECKED_AT,
    });
    expect(parseDesignPreview(preview)).toEqual(preview);
  });

  it('projects the tokens, routes and screens sorted by their own key', () => {
    const preview = buildDesignPreview(input());

    expect(preview.present).toBe(true);
    expect(preview.tokens).toEqual([
      { name: 'color.brand.bright', type: 'color', value: '#22c55e' },
      { name: 'color.surface.night', type: 'color', value: '#0b1120' },
      { name: 'space.gap', type: 'dimension', value: '8' },
    ]);
    expect(preview.routes).toEqual([
      { path: '/dashboard', screen: 'Dashboard', component: '' },
      { path: '/repos/:id', screen: 'Repo · backlog', component: 'RepoBacklogPage' },
    ]);
    expect(preview.screens.map((screen) => screen.screen)).toEqual(['Dashboard', 'Repo · backlog']);
    expect(preview.screens[0]).toEqual({
      screen: 'Dashboard',
      route: '/dashboard',
      states: { loading: 'Skeleton', empty: null, error: 'Envelope' },
      snapshotSha256: null,
    });
    expect(parseDesignPreview(preview)).toEqual(preview);
  });

  it('carries the check findings in the order the checker returns them', () => {
    const preview = buildDesignPreview(input());
    expect(preview.findings).toEqual([
      {
        file: 'design/routes.json',
        line: 1,
        rule: 'route_without_component',
        message: 'route /dashboard has no component',
      },
      {
        file: 'design/screens/dashboard.json',
        line: 1,
        rule: 'screen_state_missing',
        message: 'screen Dashboard has no empty state',
      },
    ]);
  });

  it('never claims a snapshot was matched: a declared hash is data', () => {
    const declared = 'a'.repeat(64);
    const preview = buildDesignPreview(
      input({
        tokens: TOKENS,
        routes:
          '{"routes":[{"path":"/repos/:id","screen":"Repo · backlog","component":"RepoBacklogPage"}]}',
        screens: [
          {
            file: 'design/screens/repo-backlog.json',
            text: `{
              "screen": "Repo · backlog",
              "route": "/repos/:id",
              "states": { "loading": "a", "empty": "b", "error": "c" },
              "snapshotSha256": "${declared}"
            }`,
          },
        ],
      }),
    );
    expect(preview.screens[0]?.snapshotSha256).toBe(declared);
    expect(preview.findings).toEqual([]);
  });

  it('refuses a document that is not JSON and one that does not parse', () => {
    const brokenJson = thrown(() => buildDesignPreview(input({ ...SOURCE, tokens: '{' })));
    expect(brokenJson).toBeInstanceOf(DesignPreviewError);
    expect((brokenJson as DesignPreviewError).file).toBe('design/tokens.json');
    expect((brokenJson as DesignPreviewError).message).toBe('document is not valid JSON');

    const brokenRoutes = thrown(() =>
      buildDesignPreview(
        input({ ...SOURCE, routes: '{"routes":[{"path":"","screen":"Dashboard"}]}' }),
      ),
    );
    expect(brokenRoutes).toBeInstanceOf(DesignPreviewError);
    expect((brokenRoutes as DesignPreviewError).file).toBe('design/routes.json');
    expect((brokenRoutes as DesignPreviewError).message).toBe('route path is empty');

    const brokenScreen = thrown(() =>
      buildDesignPreview(
        input({
          ...SOURCE,
          screens: [{ file: 'design/screens/bad.json', text: '{"screen":"","route":"/"}' }],
        }),
      ),
    );
    expect(brokenScreen).toBeInstanceOf(DesignPreviewError);
    expect((brokenScreen as DesignPreviewError).file).toBe('design/screens/bad.json');
    expect((brokenScreen as DesignPreviewError).message).toBe('screen is empty');
  });

  it('treats an absent routes document as no routes', () => {
    const preview = buildDesignPreview(input({ tokens: TOKENS, routes: null, screens: [] }));
    expect(preview.routes).toEqual([]);
    expect(preview.screens).toEqual([]);
    expect(preview.findings).toEqual([]);
  });
});
