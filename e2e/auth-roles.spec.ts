import { expect, test } from '@playwright/test';
import { signIn } from './fixtures';

// Socle E2E critique : authentification, session et CLOISONNEMENT des roles.
// Ce fichier ne couvre volontairement PAS les parcours metier (patient, export, upload,
// hors-ligne, revocation) — voir docs/e2e-browser.md pour la couverture reelle et differee.
test.describe('Socle E2E critique — authentification et cloisonnement des roles', () => {
  test('@critical une route protegee redirige une session absente', async ({ page }) => {
    await page.goto('/bases/00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: /Se connecter|Sign in/i })).toBeVisible();
  });

  test('@critical une connexion invalide reste refusee', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/Adresse e-mail|Email address/i).fill(`invalid-${Date.now()}@e2e.invalid`);
    await page.getByLabel(/Mot de passe|Password/i).fill('invalid-e2e-password');
    await page.getByRole('button', { name: /Se connecter|Sign in/i }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('@critical la session medecin survit au refresh', async ({ page }) => {
    await signIn(page, 'MEDECIN');
    await expect(page).toHaveURL(/\/$/);
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: /Se connecter|Sign in/i })).toHaveCount(0);
  });

  test('@critical une session expiree revient a la connexion', async ({ page }) => {
    await signIn(page, 'MEDECIN');
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const session = JSON.parse(raw) as Record<string, unknown>;
        session.expires_at = 1;
        session.refresh_token = 'expired-e2e-refresh-token';
        localStorage.setItem(key, JSON.stringify(session));
      }
    });
    await page.reload();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  });

  test('@critical le curateur ne peut pas entrer dans la zone admin', async ({ page }) => {
    await signIn(page, 'CURATEUR');
    await expect(page).toHaveURL(/\/curation$/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/curation$/);
  });

  test('@critical l administrateur ne peut pas entrer dans la zone patient', async ({ page }) => {
    await signIn(page, 'ADMIN');
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/admin$/);
  });
});
