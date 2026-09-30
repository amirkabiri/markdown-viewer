import { defineConfig, devices } from '@playwright/test';

/* Parallel agent worktrees each host their own preview server; a fixed
   port cross-tests whoever grabbed 4173 first. CI keeps the default. */
const port = Number(process.env.E2E_PORT ?? 4173);

/* E2E tests run against a production build (vite build + vite preview) so the
   suite exercises the same bundle that gets deployed. */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  /* Keep failure artifacts out of git status: .gitignore covers node_modules/
     but not Playwright's default `test-results/`, and this config must stay
     the only e2e-owned file. */
  outputDir: 'node_modules/.playwright-artifacts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${port}`,
    /* Deterministic initial theme: the app falls back to
       prefers-color-scheme when no stored preference exists. */
    colorScheme: 'light',
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm run build && pnpm run preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
