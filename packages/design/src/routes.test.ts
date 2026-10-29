import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DesignDocumentError, parseRoutes } from './index.js';

const FIXTURE_ROUTES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/routes.json', import.meta.url)), 'utf8'),
) as unknown;

describe('parseRoutes', () => {
  it('reads one route per entry, in file order', () => {
    const routes = parseRoutes({
      routes: [
        { path: '/repos/:id', screen: 'Repo · backlog', component: 'RepoBacklogPage' },
        { path: '/dashboard', screen: 'Dashboard', component: 'DashboardPage' },
      ],
    });

    expect(routes).toEqual([
      { path: '/repos/:id', screen: 'Repo · backlog', component: 'RepoBacklogPage' },
      { path: '/dashboard', screen: 'Dashboard', component: 'DashboardPage' },
    ]);
  });

  it('keeps an empty component as data, because that is a finding and not a parse error', () => {
    expect(parseRoutes({ routes: [{ path: '/works/:id', screen: 'Work · run log' }] })).toEqual([
      { path: '/works/:id', screen: 'Work · run log', component: '' },
    ]);
    expect(
      parseRoutes({ routes: [{ path: '/works/:id', screen: 'Work · run log', component: '' }] }),
    ).toEqual([{ path: '/works/:id', screen: 'Work · run log', component: '' }]);
  });

  it('rejects a document whose routes is not an array', () => {
    expect(() => parseRoutes({ routes: {} })).toThrow(DesignDocumentError);
    expect(() => parseRoutes({})).toThrow(DesignDocumentError);
    expect(() => parseRoutes([])).toThrow(DesignDocumentError);
    expect(() => parseRoutes({ routes: [], extra: 1 })).toThrow(DesignDocumentError);
  });

  it('rejects an entry that is not an object and an empty path or screen', () => {
    for (const document of [
      { routes: ['/dashboard'] },
      { routes: [null] },
      { routes: [{ path: '', screen: 'Dashboard', component: 'DashboardPage' }] },
      { routes: [{ path: '/dashboard', screen: '', component: 'DashboardPage' }] },
      { routes: [{ path: '/dashboard', screen: 'Dashboard', component: 9 }] },
      { routes: [{ path: '/dashboard', screen: 'Dashboard', extra: true }] },
    ]) {
      expect(() => parseRoutes(document)).toThrow(DesignDocumentError);
    }
  });

  it('reports the boundary and the failing index', () => {
    try {
      parseRoutes({ routes: [{ path: '/dashboard', screen: '' }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DesignDocumentError);
      expect(error).toMatchObject({
        boundary: 'routes',
        issues: [{ path: 'routes.0.screen', message: 'route screen is empty' }],
      });
    }
  });

  it('parses the fixture', () => {
    const routes = parseRoutes(FIXTURE_ROUTES);

    expect(routes.map((route) => route.component)).toEqual(['DashboardPage', 'RepoBacklogPage']);
  });
});
