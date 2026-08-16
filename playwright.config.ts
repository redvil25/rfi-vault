import { defineConfig, devices } from '@playwright/test'

/**
 * E2E runs against a real dev server and the real Supabase project. Specs are
 * responsible for cleaning up anything they file.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // OCR of a scanned document takes several seconds on the server.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/sign-in',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
