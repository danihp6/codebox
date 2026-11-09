import { SHELL_TABS } from '../app.routes';

function normalise(url: string): string {
  const cut = url.search(/[?#]/);
  const path = cut === -1 ? url : url.slice(0, cut);
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * True only when the URL is one of the three top-level destinations in `SHELL_TABS`.
 * A query string or fragment is ignored, and one trailing slash is tolerated, so
 * `/dashboard?tab=1` is a tab root and `/repos/repo-1` is not.
 */
export function showsShellTabs(url: string): boolean {
  const path = normalise(url);
  return SHELL_TABS.some((tab) => tab.path === path);
}
