import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for Pero.
 * Install: npm install -D @playwright/test  (from project root)
 * Run:     npx playwright test
 * UI mode: npx playwright test --ui
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Start both servers before tests run
  webServer: [
    {
      command: 'npm run dev',           // Vite frontend on :3000
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
    {
      command: 'npm run dev',           // Express server on :3001
      cwd: './server',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
  ],
});
