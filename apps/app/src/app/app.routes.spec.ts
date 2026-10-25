import { describe, expect, it } from 'vitest';
import type { Route } from '@angular/router';
import { routes } from './app.routes';

const EXPECTED_PATHS = [
  '',
  'pair',
  'dashboard',
  'repos',
  'repos/:id',
  'chat',
  'chat/:id',
  'jobs',
  'jobs/:id',
  'runs',
  'runs/:id',
  'approvals',
  'settings',
  'settings/devices',
  'about',
  '**',
] as const;

function routeFor(path: string): Route {
  const route = routes.find((candidate) => candidate.path === path);
  if (route === undefined) throw new Error(`route ${path} is missing`);
  return route;
}

describe('app routes', () => {
  it('predeclares every route and resolves every lazy loader', async () => {
    expect(routes.map((route) => route.path)).toEqual([...EXPECTED_PATHS]);

    const redirect = routeFor('');
    expect(redirect.redirectTo).toBe('dashboard');
    expect(redirect.pathMatch).toBe('full');

    for (const path of EXPECTED_PATHS.filter((candidate) => candidate !== '')) {
      const route = routeFor(path);
      expect(route.loadComponent, `route ${path} has no loadComponent`).toBeTypeOf('function');
      const loaded = await route.loadComponent?.();
      expect(loaded, `route ${path} resolved to nothing`).toBeTypeOf('function');
    }
  });

  it('keeps /pair public and guards the rest', () => {
    expect(routeFor('pair').canActivate).toBeUndefined();
    for (const path of EXPECTED_PATHS.filter(
      (candidate) => candidate !== '' && candidate !== 'pair' && candidate !== '**',
    )) {
      expect(routeFor(path).canActivate, `route ${path} is not guarded`).toHaveLength(1);
    }
  });
});
