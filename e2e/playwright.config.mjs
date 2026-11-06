import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The Playwright half. `outputDir` lives outside the repository on purpose: a report inside
 * `e2e/` would be linted by `npm run lint` and committed by accident.
 *
 * @type {import('@playwright/test').PlaywrightTestConfig}
 */
const config = {
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  outputDir: process.env.CB_E2E_OUTPUT ?? join(tmpdir(), 'cb-e2e-playwright'),
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
  timeout: 120_000,
};

export default config;
