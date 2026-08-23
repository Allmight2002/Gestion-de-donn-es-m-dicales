// =============================================================================
// Preuve navigateur O6 — feuille de route « saisie hors-ligne » (intake-only).
//
// Parcours pilote par l'INTERFACE sur un preview isole (service worker REEL, donc
// build construit : jamais `npm run dev`, dont le SW est desactive). Les appels au
// backend Supabase ne servent qu'aux FIXTURES (verification des lignes serveur,
// semage du doublon, nettoyage best-effort) — jamais pour simuler le parcours.
//
// Prerequis (sinon SKIP explicite, jamais un succes silencieux) :
//   E2E_TARGET=staging, E2E_BASE_URL (preview isole construit avec
//   VITE_OFFLINE_MODE=demo + VITE_OFFLINE_ADMIN_ACK=true + VITE_OFFLINE_INTAKE=demo),
//   identifiants MEDECIN (+CURATEUR pour l'isolation inter-comptes),
//   E2E_MEDECIN_BASE_ID, E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY.
//
// Couverture des 17 etapes de la feuille de route §O6. La perte de reponse APRES
// commit est prouvee au niveau PostgreSQL (test/offline-intake-rpc.test.ts) ; ici,
// l'etape 14 prouve le rejeu apres echec transport via la vraie UI et la vraie RPC.
// =============================================================================
import type { Page } from '@playwright/test';
import { expect, test } from './staging-test';
import {
  backendConfigured, credentials, fixtureBackend, hasCredentials, medecinClient,
  seedBaseId, signIn, uniquePatientCode,
} from './fixtures';

const OFFLINE_BANNER = /la consultation de la base est indisponible|browsing this base is unavailable/i;
const PREPARE_BUTTON = /Pr.parer la saisie hors-ligne|Prepare offline intake/i;

async function goToBase(page: Page, baseId: string): Promise<void> {
  await page.goto(`/bases/${baseId}`);
}

async function syncNow(page: Page): Promise<void> {
  await page.goto('/status');
  await page.getByRole('button', { name: /Synchroniser maintenant|Sync now/i }).click();
}

test.describe('@critical saisie hors-ligne (intake-only)', () => {
  let baseId: string;
  let code1: string;
  let code2: string;
  let code3: string;

  test.beforeAll(() => {
    if (!hasCredentials('MEDECIN') || !seedBaseId() || !backendConfigured()) {
      test.skip(true, 'Fixture indisponible : staging + identifiants medecin + base + backend requis.');
    }
    fixtureBackend(); // tripwire anti-production
    baseId = seedBaseId()!;
    code1 = uniquePatientCode('OFF');
    code2 = uniquePatientCode('OFF');
    code3 = uniquePatientCode('OFF');
  });

  test('cree un patient hors-ligne, survit au rechargement puis se synchronise sans doublon', async ({ page }) => {
    // ---------- 1-2) version attendue + connexion en ligne ----------
    await signIn(page, 'MEDECIN');
    await page.goto('/status');
    const commit = await page.getByText(/Commit/i).locator('..').textContent().catch(() => null);
    test.info().annotations.push({ type: 'sha', description: commit?.trim() ?? 'inconnu' });

    await goToBase(page, baseId);
    // Le preview doit avoir la saisie hors-ligne ACTIVEE ; sinon SKIP explicite.
    const prepareVisible = await page.getByRole('button', { name: PREPARE_BUTTON }).isVisible().catch(() => false);
    test.skip(!prepareVisible, 'Le preview ne transporte pas VITE_OFFLINE_INTAKE=demo : preuve impossible.');

    // ---------- 3) preparation du contexte (formulaire SEUL) ----------
    await page.getByRole('button', { name: PREPARE_BUTTON }).first().click();
    await expect(page.getByText(/saisie hors-ligne pr.te|intake ready/i)).toBeVisible();

    // ---------- 4) hors-ligne : lecture de la base BLOQUEE ----------
    await page.context().setOffline(true);
    await goToBase(page, baseId);
    await expect(page.getByText(OFFLINE_BANNER)).toBeVisible();
    await expect(page.getByRole('button', { name: code1 })).toHaveCount(0); // aucune liste serveur

    // ---------- 5-6) creation d'un patient + donnees permanentes ----------
    await page.getByRole('button', { name: /Cr.er un patient hors-ligne|Create a patient offline/i }).click();
    await page.getByLabel(/Nom complet|Full name/i).fill(`Fictif ${code1}`);
    await page.getByLabel(/Date de naissance|Date of birth/i).fill('1990-01-01');
    await page.getByLabel(/Code patient|Patient code/i).fill(code1);
    await page.getByRole('button', { name: /Enregistrer le patient|Save patient/i }).click();

    // ---------- 7) le patient n'apparait QUE dans la file locale ----------
    await expect(page.getByText(OFFLINE_BANNER)).toBeVisible();
    await expect(page.getByText(code1)).toBeVisible();

    // ---------- 8) premiere rencontre DEPENDANTE ----------
    await page.getByRole('link', { name: /Ajouter une rencontre|Add encounter/i }).first().click()
      .catch(async () => page.getByRole('button', { name: /Ajouter une rencontre|Add encounter/i }).first().click());
    await page.getByLabel(/Date de la rencontre|Encounter date/i).fill('2026-08-21');
    await page.getByRole('button', { name: /Enregistrer la rencontre|Save encounter/i }).click();
    await expect(page.getByText(OFFLINE_BANNER)).toBeVisible();

    // ---------- 9-10) rechargement hors-ligne : la saisie survit ----------
    await page.reload();
    await expect(page.getByText(OFFLINE_BANNER)).toBeVisible();
    await expect(page.getByText(code1)).toBeVisible(); // patient toujours en file
    await expect(page.getByText(/Rencontre \(dossier local\)|Encounter \(local record\)/i)).toBeVisible();

    // ---------- 11-12) retour du reseau + synchronisation ordonnee ----------
    await page.context().setOffline(false);
    await syncNow(page);
    await expect(page.getByText(/Patients cr..s\s*:\s*1|Patients created\s*:\s*1/i)).toBeVisible();
    await expect(page.getByText(/Rencontres cr..es\s*:\s*1|Encounters created\s*:\s*1/i)).toBeVisible();

    // Verification SERVEUR (fixture) : exactement UNE ligne patient, UNE rencontre liee.
    const client = await medecinClient();
    const { data: rows } = await client.from('patient')
      .select('id, patient_code, encounters(id)').eq('base_id', baseId)
      .eq('patient_code', code1)
      .is('deleted_at', null);
    expect(rows).toHaveLength(1);
    const created = rows?.[0] as { id: string; encounters: { id: string }[] };
    expect(created.encounters).toHaveLength(1);

    // ---------- 13) relecture EN LIGNE : le patient est dans la base ----------
    await goToBase(page, baseId);
    await expect(page.getByRole('button', { name: code1 })).toBeVisible();

    // ---------- 14) rejeu apres echec transport (reponse jamais recue) ----------
    await page.context().setOffline(true);
    await goToBase(page, baseId);
    await page.getByRole('button', { name: /Cr.er un patient hors-ligne|Create a patient offline/i }).click();
    await page.getByLabel(/Nom complet|Full name/i).fill(`Fictif ${code2}`);
    await page.getByLabel(/Date de naissance|Date of birth/i).fill('1991-02-02');
    await page.getByLabel(/Code patient|Patient code/i).fill(code2);
    await page.getByRole('button', { name: /Enregistrer le patient|Save patient/i }).click();
    await expect(page.getByText(OFFLINE_BANNER)).toBeVisible();

    await page.context().setOffline(false);
    // Premiere tentative : la reponse est PERDUE (transport coupe, commit eventuel ignore).
    let cut = true;
    await page.route('**/rpc/replay_patient_create', async (route) => {
      if (cut) { cut = false; return route.abort('connectionreset'); }
      return route.fallback();
    });
    await syncNow(page);
    await page.unroute('**/rpc/replay_patient_create');
    // Rejeu manuel : la MEME cle atteint la RPC idempotente -> jamais deux lignes.
    await syncNow(page);
    const { data: rows2 } = await client.from('patient')
      .select('id').eq('base_id', baseId).eq('patient_code', code2).is('deleted_at', null);
    expect(rows2).toHaveLength(1);

    // ---------- 15) doublon de code -> rejet VISIBLE (jamais silencieux) ----------
    // Semage SERVEUR du doublon (fixture de setup uniquement) :
    await client.rpc('create_patient', {
      p_base_id: baseId, p_patient_code: code3, p_full_name: 'Deja Enregistre',
      p_date_of_birth: '1985-05-05', p_phone: null, p_address: null,
      p_external_identifier: null, p_permanent_data: {},
    });
    await page.context().setOffline(true);
    await goToBase(page, baseId);
    await page.getByRole('button', { name: /Cr.er un patient hors-ligne|Create a patient offline/i }).click();
    await page.getByLabel(/Nom complet|Full name/i).fill(`Fictif ${code3}`);
    await page.getByLabel(/Date de naissance|Date of birth/i).fill('1985-05-05');
    await page.getByLabel(/Code patient|Patient code/i).fill(code3);
    await page.getByRole('button', { name: /Enregistrer le patient|Save patient/i }).click();
    await page.context().setOffline(false);
    await syncNow(page);
    // Le rejet apparait dans le Centre de synchronisation avec sa cause.
    await expect(page.getByText(/Rejets definitifs|Rejected/i)).toBeVisible();
    await expect(page.getByText(/OFFLINE_IDENTITY_DUPLICATE|duplicate key|uq_identity_base_code/i).first()).toBeVisible();

    // Nettoyage best-effort du residu serveur (fixtures uniquement).
    for (const code of [code1, code2, code3]) {
      const { data: found } = await client.from('patient')
        .select('id').eq('base_id', baseId).eq('patient_code', code).is('deleted_at', null);
      for (const row of (found ?? []) as { id: string }[]) {
        await client.rpc('soft_delete_patient', { p_patient_id: row.id, p_reason: `Nettoyage E2E intake ${code}` }).then(() => {}, () => {});
      }
    }
    await client.auth.signOut();
  });

  test('deconnexion : purge verifiable ; le compte suivant ne voit aucune donnee locale', async ({ page }) => {
    test.info().setTimeout(60_000);
    await signIn(page, 'MEDECIN');

    // Purge a la deconnexion : toute la base IndexedDB applicative disparait (invariant §9).
    await page.evaluate(async () => {
      localStorage.setItem('meddata:e2e-before-signout', '1');
    });
    await page.getByRole('button', { name: /Se d.connecter|Sign out/i }).first().click();
    await expect(page).not.toHaveURL(/\/bases\//);
    const dbsAfter = await page.evaluate(async () =>
      (await indexedDB.databases()).map((d) => d.name));
    expect(dbsAfter).not.toContain('meddata-offline');

    // Second compte : aucune donnee locale du premier n'est visible.
    await signIn(page, 'CURATEUR');
    await page.goto('/status');
    await expect(page.getByText(/Aucune modification en attente|No pending changes/i)).toBeVisible();
    void credentials; // (les identifiants CURATEUR sont valides par signIn)
  });
});
