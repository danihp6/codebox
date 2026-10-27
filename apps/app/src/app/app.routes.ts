import type { Type } from '@angular/core';
import type { Route, Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export type ShellTabId = 'dashboard' | 'chat' | 'settings';

export interface ShellTab {
  readonly id: ShellTabId;
  readonly path: '/dashboard' | '/chat' | '/settings';
  readonly labelKey: 'tabs.dashboard' | 'tabs.chat' | 'tabs.settings';
}

/** The single source of truth for the bottom tab bar (D47). Exactly three, in this order. */
export const SHELL_TABS: readonly ShellTab[] = Object.freeze([
  { id: 'dashboard', path: '/dashboard', labelKey: 'tabs.dashboard' },
  { id: 'chat', path: '/chat', labelKey: 'tabs.chat' },
  { id: 'settings', path: '/settings', labelKey: 'tabs.settings' },
]);

type LazyComponent = () => Promise<Type<unknown>>;

const TAB_COMPONENTS: Readonly<Record<ShellTabId, LazyComponent>> = {
  dashboard: () =>
    import('./features/dashboard/dashboard.page').then((module) => module.DashboardPage),
  chat: () => import('./features/chat/chat-list.page').then((module) => module.ChatListPage),
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
 * Frozen by Task-18: feature tasks replace the placeholder components in place and never edit
 * this table. `/pair` is the only public route.
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
    path: 'repos',
    canActivate: [authGuard],
    loadComponent: () => import('./features/repos/repos.page').then((module) => module.ReposPage),
  },
  {
    path: 'repos/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/repos/repo.page').then((module) => module.RepoPage),
  },
  {
    path: 'chat/:id',
    canActivate: [authGuard],
    data: { tab: 'chat' },
    loadComponent: () => import('./features/chat/chat.page').then((module) => module.ChatPage),
  },
  {
    path: 'jobs',
    canActivate: [authGuard],
    loadComponent: () => import('./features/jobs/jobs.page').then((module) => module.JobsPage),
  },
  {
    path: 'jobs/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/jobs/job.page').then((module) => module.JobPage),
  },
  {
    path: 'runs',
    canActivate: [authGuard],
    loadComponent: () => import('./features/runs-list/runs.page').then((module) => module.RunsPage),
  },
  {
    path: 'runs/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/run-detail/run.page').then((module) => module.RunDetailPage),
  },
  {
    path: 'approvals',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/approvals/approvals.page').then((module) => module.ApprovalsPage),
  },
  {
    path: 'settings/devices',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/devices.page').then((module) => module.DevicesPage),
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
