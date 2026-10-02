import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build served by `vite preview`, so what passes
 * here is what ships. Two suites:
 *   - a11y.spec.ts    — the axe WCAG gate, Chromium only (a deterministic gate).
 *   - claims.spec.ts  — the page tells the truth, including the negative claim.
 *
 * Port 4677 is unique to this lab across the fleet (never the Vite default 4173:
 * with 200+ labs side by side, a shared port means `reuseExistingServer` silently
 * scans a DIFFERENT lab's preview, which has really happened here).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 300_000, // the drive completes a Worker round trip before every scan
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4718/crypto-lab-return-path/',
    colorScheme: 'dark', // dark is the only theme
  },
  projects: [
    {
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'claims',
      testMatch: /(claims|entry)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Build before serving: `vite preview` only serves whatever is already in
    // dist/, so without this a failing build leaves the previous good bundle in
    // place and the suite passes green against code that no longer compiles.
    command: 'npm run build && npm run preview -- --port 4718 --strictPort',
    url: 'http://localhost:4718/crypto-lab-return-path/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
