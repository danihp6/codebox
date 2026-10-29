import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import type { Route } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { restoreSession } from './app.config';
import { SHELL_TABS, routes } from './app.routes';
import { authGuard } from './core/auth/auth.guard';
import { AuthStore } from './core/auth/auth.store';

const EXPECTED_PATHS = [
  '',
  'pair',
  'dashboard',
  'repos',
  'settings',
  'repos/:id/works',
  'repos/:id/schedule',
  'repos/:id/design',
  'repos/:id',
  'works/:id',
  'sessions/:id',
  'jobs',
  'jobs/:id',
  'runs',
  'runs/:id',
  'approvals',
  'settings/devices',
  'settings/credentials',
  'about',
  '**',
] as const;

const GUARDED_PATHS = EXPECTED_PATHS.filter((path) => path !== '' && path !== 'pair');

const TAB_ROOT_PATHS = ['dashboard', 'repos', 'settings'] as const;

const UNTABBED_PATHS = EXPECTED_PATHS.filter(
  (path) => !TAB_ROOT_PATHS.includes(path as (typeof TAB_ROOT_PATHS)[number]),
);

/** Panels that render inside `/settings` and have no route of their own (docs/app.md §4). */
const PANEL_ONLY_PATHS: readonly string[] = ['/settings/providers', '/settings/notifications'];

function routeFor(path: string): Route {
  const route = routes.find((candidate) => candidate.path === path);
  if (route === undefined) throw new Error(`route ${path} is missing`);
  return route;
}

function screensSection(): string {
  const text = readFileSync(resolve(process.cwd(), '../../docs/app.md'), 'utf8');
  const start = text.indexOf('## 4. Screens');
  const end = text.indexOf('## 5. State and data');
  if (start === -1 || end === -1 || end <= start) throw new Error('docs/app.md §4 is missing');
  return text.slice(start, end);
}

function documentedPaths(): readonly string[] {
  return screensSection()
    .split('\n')
    .map((line) => /^\| `([^`]+)` \|/.exec(line)?.[1])
    .filter((path): path is string => path !== undefined);
}

function legacyPaths(): readonly string[] {
  const line = screensSection()
    .split('\n')
    .find((candidate) => candidate.startsWith('**Legacy'));
  if (line === undefined) throw new Error('docs/app.md §4 has no legacy list');
  return [...line.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((path): path is string => path !== undefined);
}

describe('app routes', () => {
  it('predeclares every route in the frozen order', () => {
    expect(routes.map((route) => route.path)).toEqual([...EXPECTED_PATHS]);

    const redirect = routeFor('');
    expect(redirect.redirectTo).toBe('dashboard');
    expect(redirect.pathMatch).toBe('full');
  });

  it('resolves every loadComponent to a function', async () => {
    for (const path of EXPECTED_PATHS.filter((candidate) => candidate !== '')) {
      const route = routeFor(path);
      expect(route.loadComponent, `route ${path} has no loadComponent`).toBeTypeOf('function');
      const loaded = await route.loadComponent?.();
      expect(loaded, `route ${path} resolved to nothing`).toBeTypeOf('function');
    }
  });

  it('guards every route except /pair with the one authGuard', () => {
    expect(routeFor('pair').canActivate).toBeUndefined();

    for (const path of GUARDED_PATHS) {
      const canActivate = routeFor(path).canActivate;
      expect(canActivate, `route ${path} is not guarded`).toHaveLength(1);
      expect(canActivate?.[0], `route ${path} uses a different guard`).toBe(authGuard);
    }
  });

  it('derives the three tab roots from SHELL_TABS', () => {
    expect(SHELL_TABS).toEqual([
      { id: 'dashboard', path: '/dashboard', labelKey: 'tabs.dashboard' },
      { id: 'repos', path: '/repos', labelKey: 'tabs.repos' },
      { id: 'settings', path: '/settings', labelKey: 'tabs.settings' },
    ]);
    expect(SHELL_TABS).toHaveLength(3);
    expect(Object.isFrozen(SHELL_TABS)).toBe(true);
    expect(SHELL_TABS[1]?.path).toBe('/repos');
    expect(SHELL_TABS[1]?.labelKey).toBe('tabs.repos');

    expect(routes.slice(2, 5).map((route) => route.path)).toEqual([...TAB_ROOT_PATHS]);

    for (const tab of SHELL_TABS) {
      const route = routeFor(tab.path.slice(1));
      expect(route.data?.['tab'], `route ${route.path} lost its tab`).toBe(tab.id);
      expect(route.canActivate?.[0]).toBe(authGuard);
    }

    for (const path of UNTABBED_PATHS) {
      expect(routeFor(path).data?.['tab'], `route ${path} claims a tab`).toBeUndefined();
    }
  });

  it('agrees with docs/app.md §4 in both directions', () => {
    const table = documentedPaths();
    const legacy = legacyPaths();
    const routerPaths = routes.map((route) => route.path);

    for (const path of table) {
      if (PANEL_ONLY_PATHS.includes(path)) continue;
      expect(routerPaths, `docs/app.md documents ${path} with no route`).toContain(path.slice(1));
    }

    for (const path of routerPaths) {
      if (path === '' || path === '**') continue;
      const documented = table.includes(`/${path}`);
      expect(documented || legacy.includes(`/${path}`), `route ${path} is undocumented`).toBe(true);
    }

    expect(legacy).toEqual(['/jobs', '/jobs/:id', '/runs', '/runs/:id', '/approvals']);
  });
});

describe('restoreSession', () => {
  it('calls AuthStore.restore once and resolves its value', async () => {
    const restore = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({ providers: [{ provide: AuthStore, useValue: { restore } }] });

    const result = await TestBed.runInInjectionContext(() => restoreSession());

    expect(restore).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('resolves false instead of throwing when the stored session is gone', async () => {
    const restore = vi.fn(() => Promise.resolve(false));
    TestBed.configureTestingModule({ providers: [{ provide: AuthStore, useValue: { restore } }] });

    await expect(TestBed.runInInjectionContext(() => restoreSession())).resolves.toBe(false);
  });
});
