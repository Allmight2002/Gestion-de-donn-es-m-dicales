import { defineConfig, devices } from '@playwright/test';
import { VERCEL_BYPASS_STORAGE_STATE } from './e2e/vercel-bypass-state';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const isCi = Boolean(process.env.CI);
const target = process.env.E2E_TARGET ?? (process.env.E2E_BASE_URL ? '' : 'local');
if (!['local', 'staging'].includes(target)) {
  throw new Error('E2E_TARGET doit valoir local ou staging; la production est interdite.');
}
if (process.env.E2E_BASE_URL && target !== 'staging') {
  throw new Error('Une URL E2E externe exige E2E_TARGET=staging.');
}
if (process.env.E2E_BASE_URL && target === 'staging' && !process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()) {
  throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET est requis pour le staging protege.');
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/vercel-bypass.setup.ts',
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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    storageState: process.env.E2E_BASE_URL && target === 'staging' ? VERCEL_BYPASS_STORAGE_STATE : undefined,
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
