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
  'chat',
  'settings',
  'repos',
  'repos/:id',
  'chat/:id',
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

const UNTABBED_PATHS = [
  'pair',
  'repos',
  'repos/:id',
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

function routeFor(path: string): Route {
  const route = routes.find((candidate) => candidate.path === path);
  if (route === undefined) throw new Error(`route ${path} is missing`);
  return route;
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
      { id: 'chat', path: '/chat', labelKey: 'tabs.chat' },
      { id: 'settings', path: '/settings', labelKey: 'tabs.settings' },
    ]);
    expect(SHELL_TABS).toHaveLength(3);
    expect(Object.isFrozen(SHELL_TABS)).toBe(true);

    for (const tab of SHELL_TABS) {
      const route = routeFor(tab.path.slice(1));
      expect(route.data?.['tab'], `route ${route.path} lost its tab`).toBe(tab.id);
      expect(route.canActivate?.[0]).toBe(authGuard);
    }

    expect(routeFor('chat/:id').data?.['tab']).toBe('chat');

    for (const path of UNTABBED_PATHS) {
      expect(routeFor(path).data?.['tab'], `route ${path} claims a tab`).toBeUndefined();
    }
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
