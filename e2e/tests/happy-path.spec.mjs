import { expect, test } from '@playwright/test';
import {
  BACKLOG_REF,
  BROWSER_DEVICE,
  DEFAULT_BRANCH,
  GATE,
  SLUG,
  withEnvironment,
} from './fixtures.mjs';

test('pair, add a repository, run its work and watch the merge', async ({ page }) => {
  await withEnvironment(async (env) => {
    await page.goto(`${env.baseUrl}/pair`);
    await page.fill('[data-testid="pair-code"]', await env.mintCode());
    await page.fill('[data-testid="pair-device-name"]', BROWSER_DEVICE);
    await page.click('[data-testid="pair-submit"]');
    await page.waitForURL((url) => !url.pathname.endsWith('/pair'));

    await page.goto(`${env.baseUrl}/repos`);
    await page.fill('[data-testid="repo-slug"]', SLUG);
    await page.fill('[data-testid="repo-default-branch"]', DEFAULT_BRANCH);
    await page.fill('[data-testid="repo-gate"]', GATE);
    await page.click('[data-testid="repo-submit"]');
    await page.waitForSelector('[data-testid="repo-row"]');
    const repoId = await env.latestRepoId();
    await page.waitForSelector(`[data-testid="repo-row"][data-repo-id="${repoId}"]`);

    await page.click(`[data-testid="repo-link-${repoId}"]`);
    await page.waitForSelector(`[data-testid="backlog-row"][data-ref="${BACKLOG_REF}"]`);

    await page.click(`[data-testid="backlog-run-${BACKLOG_REF}"]`);
    await page.waitForURL(/\/works\/wrk_/);
    await env.waitForSucceeded();
    await page.reload();

    await expect(page.locator('[data-testid="work-run"][data-state="succeeded"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="work-run-gate"][data-status="passed"]')).toHaveCount(
      1,
    );
    const pullRequest = page.locator('[data-testid="work-run-pr"][data-state="merged"]');
    await expect(pullRequest).toHaveCount(1);
    await expect(pullRequest.locator('a')).toHaveText(/#\d+/);
    await expect(page.locator('[data-testid="work-run-backlog-tick"]')).toContainText(BACKLOG_REF);
    await page.close();
  });
});
