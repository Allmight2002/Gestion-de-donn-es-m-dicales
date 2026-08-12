// Parcours patient critique de bout en bout, entierement pilote par l'INTERFACE (lot 10,
// correction 3). Aucune RPC n'est appelee pour SIMULER le parcours : seule la fixture de
// nettoyage utilise la couche serveur, et uniquement pour supprimer le residu d'un echec.
//
// Prerequis (sinon le test est marque indisponible, jamais un succes silencieux) :
//   E2E_TARGET=staging, E2E_BASE_URL, identifiants medecin,
//   E2E_MEDECIN_BASE_ID (base de test possedee par le medecin, gabarit vide accepte),
//   E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY (nettoyage best-effort du residu).
import { expect, test } from './staging-test';
import { backendConfigured, cleanupPatient, fixtureBackend, hasCredentials, seedBaseId, signIn, uniquePatientCode } from './fixtures';

test.describe('@critical parcours patient critique (medecin)', () => {
  let patientId: string | null = null;
  let softDeleted = false;

  test.beforeAll(() => {
    if (!hasCredentials('MEDECIN') || !seedBaseId() || !backendConfigured()) {
      test.skip(
        true,
        'Fixture patient indisponible : E2E_TARGET=staging, identifiants medecin, E2E_MEDECIN_BASE_ID et E2E_SUPABASE_URL/ANON_KEY requis.',
      );
    }
    fixtureBackend(); // tripwire anti-production (echec bruyant si la cible est inattendue)
  });

  // Nettoyage du residu : n'agit QUE si la suppression logique du parcours n'a pas eu lieu
  // (echec avant l'etape 8). Best-effort, ne masque jamais l'echec du test.
  test.afterEach(async () => {
    if (patientId && !softDeleted) await cleanupPatient(patientId);
    patientId = null;
    softDeleted = false;
  });

  test('cree, verifie, modifie, persiste puis supprime logiquement un patient', async ({ page }) => {
    const baseId = seedBaseId()!;
    const code = uniquePatientCode();
    const fullName = `Fictif ${code}`;

    // 1) connexion
    await signIn(page, 'MEDECIN');

    // 2) ouverture d'une base de test
    await page.goto(`/bases/${baseId}`);
    await expect(page.getByRole('button', { name: /Nouveau patient|New patient/i })).toBeVisible();

    // 3) creation d'un patient fictif — via l'UI reelle : « Nouveau patient » ouvre
    //    directement le formulaire (la page de choix intercalaire a ete retiree).
    await page.getByRole('button', { name: /Nouveau patient|New patient/i }).click();
    await page.getByLabel(/Code patient|Patient code/i).fill(code);
    await page.getByLabel(/Nom complet|Full name/i).fill(fullName);
    await page.getByLabel(/Date de naissance|Date of birth/i).fill('1990-01-01');
    await page.getByRole('button', { name: /Enregistrer le patient|Save patient/i }).click();

    // La fiche s'ouvre : on capte l'identifiant pour le nettoyage du residu eventuel.
    await expect(page).toHaveURL(/\/bases\/[^/]+\/patients\/[0-9a-f-]{36}$/i);
    patientId = page.url().match(/\/patients\/([0-9a-f-]{36})/i)?.[1] ?? null;
    expect(patientId).not.toBeNull();

    // 4) verification de sa presence dans la liste de la base
    await page.goto(`/bases/${baseId}`);
    await expect(page.getByRole('button', { name: code })).toBeVisible();

    // 5) modification d'un champ persiste cote serveur : le statut de validation du dossier
    //    (update_patient journalise le changement + le motif).
    await page.getByRole('button', { name: code }).click();
    await page.getByRole('button', { name: /Modifier les donn.es permanentes|Edit permanent data/i }).click();
    await page.getByLabel(/Statut du dossier|Record status/i).selectOption('complete');
    await page.getByLabel(/Motif de la correction|Reason for the correction/i).fill(`Passage complete ${code}`);
    await page.getByRole('button', { name: /Enregistrer la rencontre|Save encounter/i }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}$`, 'i'));

    // 6) rafraichissement du navigateur
    await page.reload();

    // 7) verification de la persistance : la valeur relue du serveur porte bien la modification.
    await page.getByRole('button', { name: /Modifier les donn.es permanentes|Edit permanent data/i }).click();
    await expect(page.getByLabel(/Statut du dossier|Record status/i)).toHaveValue('complete');
    await page.getByRole('button', { name: /Annuler|Cancel/i }).click();

    // 8) suppression logique avec MOTIF obligatoire
    await page.getByRole('button', { name: /Supprimer ce patient|Delete this patient/i }).click();
    await page.getByLabel(/Motif de la suppression|Reason for deletion/i).fill(`Fin de test E2E ${code}`);
    await page.getByRole('button', { name: /Confirmer|Confirm/i }).click();

    // 9) disparition du parcours normal (retour a la base, patient absent de la liste)
    await expect(page).toHaveURL(new RegExp(`/bases/${baseId}$`));
    await expect(page.getByRole('button', { name: code })).toHaveCount(0);

    // 10) nettoyage : la suppression logique EST le nettoyage de la fixture.
    softDeleted = true;
  });
});
