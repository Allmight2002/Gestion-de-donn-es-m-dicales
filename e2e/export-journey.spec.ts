// Parcours export critique : UI -> Edge `generate-export` -> historique -> telechargement
// (lot 10, correction 4). Le contenu detaille du classeur est deja couvert par les tests
// unitaires XLSX/CSV ; ce test navigateur prouve le PARCOURS REEL et le refus par role.
//
// Prerequis (sinon indisponible, jamais un succes silencieux) :
//   E2E_TARGET=staging, E2E_BASE_URL, E2E_EXPORT_BASE_ID + E2E_EXPORT_COHORT_ID (cohorte
//   figee eligible, semee cote staging), identifiants medecin (export) et curateur (refus).
// Le skip vit en `beforeAll` : une fixture absente marque le test indisponible SANS ouvrir
// de navigateur.
import { statSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { exportBaseId, exportCohortId, hasCredentials, signIn } from './fixtures';

const exportReady = () => Boolean(exportBaseId() && exportCohortId());

test.describe('parcours export critique (medecin)', () => {
  test.beforeAll(() => {
    if (!hasCredentials('MEDECIN') || !exportReady()) {
      test.skip(true, 'Fixture export indisponible : identifiants medecin + E2E_EXPORT_BASE_ID/E2E_EXPORT_COHORT_ID requis.');
    }
  });

  test('@critical exporte une cohorte en CSV puis telecharge le fichier', async ({ page }) => {
    const baseId = exportBaseId()!;
    const cohortId = exportCohortId()!;

    // 1) connexion medecin autorise
    await signIn(page, 'MEDECIN');

    // 2) ouverture d'une cohorte fictive eligible
    await page.goto(`/bases/${baseId}/cohorts/${cohortId}/export`);
    await expect(page.getByRole('heading', { name: /Exporter une cohorte|Export a cohort/i })).toBeVisible();

    // 3) lancement d'un export CSV
    await page.getByLabel(/Format/i).selectOption('csv');
    await page.getByRole('button', { name: /G.n.rer et conserver|Generate and keep/i }).click();

    // 4) attente du resultat
    await expect(page.getByText(/Export g.n.r. et conserv.|Export generated and kept/i)).toBeVisible({ timeout: 30_000 });

    // 5) presence de l'export dans l'historique
    const downloadButton = page.getByRole('button', { name: /T.l.charger|Download/i }).first();
    await expect(downloadButton).toBeVisible();

    // 6) telechargement intercepte + 7) verification minimale nom / type / taille
    const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/\.csv$/i);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    expect(statSync(filePath!).size).toBeGreaterThan(0);

    // 8) absence d'erreur utilisateur
    await expect(page.getByRole('alert')).toHaveCount(0);

    // 9) nettoyage : aucune donnee jetable creee (cohorte semee reutilisee) ; l'export_log est
    //    volontairement immuable (trace scientifique en ajout seul) — rien a supprimer.
  });
});

test.describe('refus export (role sans droit)', () => {
  test.beforeAll(() => {
    if (!hasCredentials('CURATEUR') || !exportReady()) {
      test.skip(true, 'Fixture refus indisponible : identifiants curateur + E2E_EXPORT_BASE_ID/E2E_EXPORT_COHORT_ID requis.');
    }
  });

  test('@critical refuse l export a un role sans droit', async ({ page }) => {
    const baseId = exportBaseId()!;
    const cohortId = exportCohortId()!;

    await signIn(page, 'CURATEUR');
    await page.goto(`/bases/${baseId}/cohorts/${cohortId}/export`);

    // Le role hors zone membre ne doit ni atteindre l'ecran d'export ni pouvoir lancer un export.
    await expect(page).not.toHaveURL(/\/cohorts\/[^/]+\/export$/);
    await expect(page.getByRole('button', { name: /G.n.rer et conserver|Generate and keep/i })).toHaveCount(0);
  });
});
