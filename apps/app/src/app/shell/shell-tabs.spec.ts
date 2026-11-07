import { describe, expect, it, vi } from 'vitest';
import { SHELL_TABS } from '../app.routes';
import { showsShellTabs } from './shell-tabs';

describe('showsShellTabs', () => {
  it('accepts the three tab roots, one trailing slash, a query and a fragment', () => {
    for (const url of [
      '/dashboard',
      '/repos',
      '/settings',
      '/dashboard/',
      '/dashboard?tab=1',
      '/dashboard#top',
      '/settings/',
    ]) {
      expect(showsShellTabs(url), url).toBe(true);
    }
  });

  it('rejects the root, every pushed destination and an unknown URL', () => {
    for (const url of [
      '',
      '/',
      '/pair',
      '/about',
      '/settings/devices',
      '/settings/credentials',
      '/settings/notifications',
      '/repos/repo-1',
      '/repos/repo-1/workers',
      '/repos/repo-1/schedule',
      '/repos/repo-1/design',
      '/works/work-1',
      '/sessions/session-1',
      '/nope',
    ]) {
      expect(showsShellTabs(url), url).toBe(false);
    }
  });

  it('is derived from SHELL_TABS', () => {
    expect(SHELL_TABS.every((tab) => showsShellTabs(tab.path))).toBe(true);
  });

  it('iterates the live SHELL_TABS, so a fourth tab is covered', () => {
    const original = Array.prototype.some;
    const receivers: unknown[] = [];
    const spy = vi.spyOn(Array.prototype, 'some').mockImplementation(function (
      this: unknown[],
      ...args: unknown[]
    ): boolean {
      receivers.push(this);
      return Reflect.apply(original, this, args) as boolean;
    } as unknown as typeof Array.prototype.some);

    try {
      expect(showsShellTabs('/dashboard')).toBe(true);
    } finally {
      spy.mockRestore();
    }

    expect(receivers).toContain(SHELL_TABS);
  });
});
