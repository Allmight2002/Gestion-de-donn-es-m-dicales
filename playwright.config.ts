import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const isCi = Boolean(process.env.CI);
const target = process.env.E2E_TARGET ?? (process.env.E2E_BASE_URL ? '' : 'local');
const vercelStorageState = process.env.E2E_VERCEL_STORAGE_STATE?.trim();
if (!['local', 'staging'].includes(target)) {
  throw new Error('E2E_TARGET doit valoir local ou staging; la production est interdite.');
}
if (process.env.E2E_BASE_URL && target !== 'staging') {
  throw new Error('Une URL E2E externe exige E2E_TARGET=staging.');
}
if (process.env.E2E_BASE_URL && target === 'staging' && !vercelStorageState) {
  throw new Error('E2E_VERCEL_STORAGE_STATE est requis pour le staging protege.');
}
if (vercelStorageState && (!process.env.E2E_BASE_URL || target !== 'staging')) {
  throw new Error('E2E_VERCEL_STORAGE_STATE est reserve aux E2E staging externes.');
}
if (vercelStorageState && !existsSync(vercelStorageState)) {
  throw new Error('Le fichier E2E_VERCEL_STORAGE_STATE est introuvable.');
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
    // Le cookie est cree hors Playwright par Vercel CLI puis limite au domaine du deploiement exact.
    // Aucun header de bypass n'est donc propage aux appels Supabase ou aux redirections tierces.
    storageState: vercelStorageState || undefined,
    // Une trace reseau pourrait conserver le cookie : captures/videos, mais jamais de trace en staging.
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
