import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const isCi = Boolean(process.env.CI);
const target = process.env.E2E_TARGET ?? (process.env.E2E_BASE_URL ? '' : 'local');
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
if (!['local', 'staging'].includes(target)) {
  throw new Error('E2E_TARGET doit valoir local ou staging; la production est interdite.');
}
if (process.env.E2E_BASE_URL && target !== 'staging') {
  throw new Error('Une URL E2E externe exige E2E_TARGET=staging.');
}
if (process.env.E2E_BASE_URL && target === 'staging' && !bypassSecret) {
  throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET est requis pour le staging protege.');
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: 0,
  workers: isCi ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: isCi
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['junit', { outputFile: 'test-results/e2e-junit.xml' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    // Vercel recommande le header au niveau du contexte Playwright. La fixture staging intercepte
    // ensuite chaque requete et le retire avant toute destination hors origine approuvee.
    extraHTTPHeaders:
      process.env.E2E_BASE_URL && target === 'staging'
        ? {
            'x-vercel-protection-bypass': bypassSecret!,
            'x-vercel-set-bypass-cookie': 'true',
          }
        : undefined,
    // Une trace reseau pourrait conserver ce header secret : captures/videos, mais jamais de trace.
    trace: target === 'staging' ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1',
        url: 'http://127.0.0.1:5173/login',
        reuseExistingServer: !isCi,
        timeout: 120_000,
      },
});
