import type { Type } from '@angular/core';
import type { Route, Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export type ShellTabId = 'dashboard' | 'repos' | 'settings';

export interface ShellTab {
  readonly id: ShellTabId;
  readonly path: '/dashboard' | '/repos' | '/settings';
  readonly labelKey: 'tabs.dashboard' | 'tabs.repos' | 'tabs.settings';
}

/** The single source of truth for the bottom tab bar (D47). Exactly three, in this order. */
export const SHELL_TABS: readonly ShellTab[] = Object.freeze([
  { id: 'dashboard', path: '/dashboard', labelKey: 'tabs.dashboard' },
  { id: 'repos', path: '/repos', labelKey: 'tabs.repos' },
  { id: 'settings', path: '/settings', labelKey: 'tabs.settings' },
]);

type LazyComponent = () => Promise<Type<unknown>>;

const TAB_COMPONENTS: Readonly<Record<ShellTabId, LazyComponent>> = {
  dashboard: () =>
    import('./features/dashboard/dashboard.page').then((module) => module.DashboardPage),
  repos: () => import('./features/repos/repos.page').then((module) => module.ReposPage),
  settings: () => import('./features/settings/settings.page').then((module) => module.SettingsPage),
};

// The tab roots are derived from SHELL_TABS so a tab cannot exist in one place and not the other.
const tabRoutes: readonly Route[] = SHELL_TABS.map((tab) => ({
  path: tab.path.slice(1),
  canActivate: [authGuard],
  data: { tab: tab.id },
  loadComponent: TAB_COMPONENTS[tab.id],
}));

/**
 * The route table of `docs/app.md` §4. A repository is a pushed destination with four tabs, so
 * no `repos/:id` route carries `data.tab`; `/pair` is the only unguarded route.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'pair',
    loadComponent: () =>
      import('./features/pairing/pairing.page').then((module) => module.PairingPage),
  },
  ...tabRoutes,
  {
    path: 'repos/:id/works',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/works/repo-works.page').then((module) => module.RepoWorksPage),
  },
  {
    path: 'repos/:id/schedule',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/repos/repo-schedule.page').then((module) => module.RepoSchedulePage),
  },
  {
    path: 'repos/:id/design',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/repos/repo-design.page').then((module) => module.RepoDesignPage),
  },
  {
    path: 'repos/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/backlog/repo-backlog.page').then((module) => module.RepoBacklogPage),
  },
  {
    path: 'works/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/works/work.page').then((module) => module.WorkPage),
  },
  {
    path: 'sessions/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/sessions/session.page').then((module) => module.SessionPage),
  },
  {
    path: 'settings/devices',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/devices.page').then((module) => module.DevicesPage),
  },
  {
    path: 'settings/credentials',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/credentials/credentials.page').then((module) => module.CredentialsPage),
  },
  {
    path: 'about',
    canActivate: [authGuard],
    loadComponent: () => import('./features/about/about.page').then((module) => module.AboutPage),
  },
  {
    path: '**',
    canActivate: [authGuard],
    loadComponent: () => import('./features/about/about.page').then((module) => module.AboutPage),
  },
];
