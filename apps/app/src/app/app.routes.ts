import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

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
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.page').then((module) => module.DashboardPage),
  },
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
    path: 'chat',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/chat/chat-list.page').then((module) => module.ChatListPage),
  },
  {
    path: 'chat/:id',
    canActivate: [authGuard],
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
    loadComponent: () =>
      import('./features/runs-list/runs.page').then((module) => module.RunsPage),
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
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/settings.page').then((module) => module.SettingsPage),
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
    loadComponent: () => import('./features/about/about.page').then((module) => module.AboutPage),
  },
];
