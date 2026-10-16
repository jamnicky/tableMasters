import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for customer documentation screenshots.
 * Runs against a locally served build of the Vite app.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run preview',
    port: 5173,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
});
