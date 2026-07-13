import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { expect, test } from './staging-test';
import { signIn } from './fixtures';

type PatientFixture = {
  id: string;
  code: string;
  encounterId: string;
  encounterUpdatedAt: string;
};

type Lot13State = {
  prefix: string;
  baseId: string;
  cohortId: string;
  version2Id: string;
  accounts: { doctorId: string; secondDoctorId: string; curatorId: string; adminId: string };
  patients: PatientFixture[];
};

const statePath = process.env.LOT13_STATE_FILE;
if (!statePath) throw new Error('LOT13_STATE_FILE requis pour les E2E LOT 13.');
const state = JSON.parse(readFileSync(resolve(statePath), 'utf8')) as Lot13State;
const databaseUrl = process.env.E2E_SUPABASE_DB_URL;
const secondDoctorEmail = process.env.E2E_SECOND_MEDECIN_EMAIL;
const secondDoctorPassword = process.env.E2E_SECOND_MEDECIN_PASSWORD;
const expectedCommit = process.env.LOT13_EXPECTED_COMMIT?.slice(0, 12);

if (!databaseUrl || !secondDoctorEmail || !secondDoctorPassword) {
  throw new Error('Infrastructure LOT 13 incomplete: DB staging et second medecin requis.');
}
if (!databaseUrl.includes('gmsxrniiclrheehhoakn')) {
  throw new Error('Garde anti-production: URL PostgreSQL LOT 13 inattendue.');
}

const db = new pg.Client({ connectionString: databaseUrl });

async function login(page: import('@playwright/test').Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/Adresse e-mail|Email address/i).fill(email);
  await page.getByLabel(/Mot de passe|Password/i).fill(password);
  await page.getByRole('button', { name: /Se connecter|Sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function grantSecondDoctor(): Promise<void> {
  await db.query(
    `insert into public.base_access(
       base_id,user_id,access_role,can_view_identity,can_view_raw_documents,
       can_edit_structured_data,can_export_data,can_manage_access,granted_by,revoked_at
     ) values($1,$2,'editor',true,false,true,true,false,$3,null)
     on conflict(base_id,user_id) do update set access_role='editor',can_view_identity=true,
       can_edit_structured_data=true,can_export_data=true,revoked_at=null,granted_by=excluded.granted_by`,
    [state.baseId, state.accounts.secondDoctorId, state.accounts.doctorId],
  );
}

async function revokeSecondDoctor(): Promise<void> {
  await db.query(
    'update public.base_access set revoked_at=now() where base_id=$1 and user_id=$2',
    [state.baseId, state.accounts.secondDoctorId],
  );
}

async function storeRows(page: import('@playwright/test').Page, storeName: 'snapshots' | 'outbox'): Promise<unknown[]> {
  return page.evaluate((store) => new Promise<unknown[]>((resolveRows, reject) => {
    const request = indexedDB.open('meddata-offline', 4);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(store)) {
        database.close();
        resolveRows([]);
        return;
      }
      const transaction = database.transaction(store, 'readonly');
      const getAll = transaction.objectStore(store).getAll();
      getAll.onsuccess = () => resolveRows(getAll.result as unknown[]);
      getAll.onerror = () => reject(getAll.error);
      transaction.oncomplete = () => database.close();
    };
  }), storeName);
}

async function mutateStore(
  page: import('@playwright/test').Page,
  storeName: 'snapshots' | 'outbox',
  mutate: 'expire_all',
): Promise<void> {
  await page.evaluate(({ store, operation }) => new Promise<void>((resolveMutation, reject) => {
    const request = indexedDB.open('meddata-offline', 4);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(store, 'readwrite');
      const objectStore = transaction.objectStore(store);
      const all = objectStore.getAll();
      all.onsuccess = () => {
        for (const row of all.result as Array<Record<string, unknown>>) {
          if (operation === 'expire_all') objectStore.put({ ...row, expiresAt: Date.now() - 60_000 });
        }
      };
      transaction.oncomplete = () => { database.close(); resolveMutation(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), { store: storeName, operation: mutate });
}

async function waitForOutboxCount(page: import('@playwright/test').Page, expected: number): Promise<void> {
  await expect.poll(async () => (await storeRows(page, 'outbox')).length, { timeout: 20_000 }).toBe(expected);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await db.connect();
  await revokeSecondDoctor();
});

test.afterAll(async () => {
  await revokeSecondDoctor().catch(() => {});
  await db.end();
});

test('@lot13 build deploye et connexions medecin, curateur, administrateur', async ({ browser }) => {
  const storageState = process.env.E2E_VERCEL_STORAGE_STATE;
  const doctorContext = await browser.newContext({ storageState });
  const doctorPage = await doctorContext.newPage();
  await signIn(doctorPage, 'MEDECIN');
  await doctorPage.goto('/sync');
  await expect(doctorPage.getByText(/0\.1\.0/)).toBeVisible();
  if (expectedCommit) await expect(doctorPage.getByText(expectedCommit, { exact: false })).toBeVisible();
  await doctorContext.close();

  const curatorContext = await browser.newContext({ storageState });
  const curatorPage = await curatorContext.newPage();
  await signIn(curatorPage, 'CURATEUR');
  await expect(curatorPage).toHaveURL(/\/curation$/);
  await expect(curatorPage.getByRole('heading', { name: /Liste des requ.tes|Requests list/i })).toBeVisible();
  await curatorContext.close();

  const adminContext = await browser.newContext({ storageState });
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, 'ADMIN');
  await expect(adminPage).toHaveURL(/\/admin$/);
  await adminContext.close();
});

test('@lot13 utilisateur sans permission et revocation dynamique', async ({ page }) => {
  await login(page, secondDoctorEmail, secondDoctorPassword);
  await page.goto(`/bases/${state.baseId}`);
  await expect(page.getByText(state.prefix, { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: state.patients[0].code })).toHaveCount(0);

  await grantSecondDoctor();
  await page.reload();
  await expect(page.getByRole('button', { name: state.patients[0].code })).toBeVisible();

  await revokeSecondDoctor();
  await page.reload();
  await expect(page.getByRole('button', { name: state.patients[0].code })).toHaveCount(0);
  await expect(page.getByText(/introuvable|not found/i)).toBeVisible();
});

test('@lot13 navigator en ligne mais Supabase inaccessible, latence puis reconnexion', async ({ page }) => {
  await signIn(page, 'MEDECIN');
  await page.route('**/rest/v1/**', (route) => route.abort('connectionrefused'));
  await page.goto(`/bases/${state.baseId}`);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.getByText(/Profil indisponible|Profile unavailable/i)).toBeVisible();
  await expect(page.getByRole('button', { name: state.patients[0].code })).toHaveCount(0);

  await page.unroute('**/rest/v1/**');
  await page.reload();
  await expect(page.getByRole('button', { name: state.patients[0].code })).toBeVisible();

  await page.route('**/rest/v1/**', async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_200));
    await route.continue();
  });
  const started = Date.now();
  await page.reload();
  await expect(page.getByRole('button', { name: state.patients[0].code })).toBeVisible({ timeout: 20_000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(1_000);
  await page.unroute('**/rest/v1/**');
});

test('@lot13 creation curation: reponse perdue apres commit puis retry sans doublon', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page, 'MEDECIN');
  await page.goto(`/bases/${state.baseId}/patients/new/submit`);
  const code = `${state.prefix}-UI-LOST-${Date.now()}`;
  await page.getByLabel(/Code patient|Patient code/i).fill(code);
  await page.getByLabel(/Nom complet|Full name/i).fill(`Identite fictive ${code}`);
  await page.getByLabel(/Date de naissance|Date of birth/i).fill('1992-02-02');

  let intercepted = false;
  await page.route('**/rest/v1/rpc/create_patient_curation_submission', async (route) => {
    if (intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    await route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'LOT13 simulated lost response' }) });
  });

  const submit = page.getByRole('button', { name: /Continuer vers les documents|Continue to documents/i });
  await submit.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/rest/v1/rpc/create_patient_curation_submission');
  await submit.click();
  await expect(page).toHaveURL(/\/curation\/[0-9a-f-]{36}$/i);

  const counts = (await db.query(
    `select
       (select count(*)::int from public.patient where base_id=$1 and patient_code=$2) patients,
       (select count(*)::int from public.patient_identity where base_id=$1 and patient_code=$2) identities,
       (select count(*)::int from public.curation_task t join public.raw_submission s on s.id=t.submission_id
         join public.patient p on p.id=s.target_patient_id where p.base_id=$1 and p.patient_code=$2) tasks`,
    [state.baseId, code],
  )).rows[0];
  expect(counts).toEqual({ patients: 1, identities: 1, tasks: 1 });
});

test('@lot13 import nominal par le frontend deploye', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page, 'MEDECIN');
  await page.goto(`/bases/${state.baseId}/import`);
  const code = `${state.prefix}-UI-IMPORT-${Date.now()}`;
  const csv = `patient_code,Nom complet,Date de naissance,Poids renomme\n${code},Import fictif UI,2001-01-01,63\n`;
  await page.locator('input[type="file"]').setInputFiles({ name: 'lot13-import.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/lot13-import\.csv/i)).toBeVisible();
  await page.getByRole('button', { name: /Aper.u|Preview/i }).click();
  await expect(page.getByText(/Aper.u \(rien|Preview \(nothing/i)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Importer$|^Import$/i }).click();
  await expect(page.getByText(/Import termin.|Import complete/i)).toBeVisible({ timeout: 20_000 });
  expect(Number((await db.query('select count(*)::int count from public.patient where base_id=$1 and patient_code=$2', [state.baseId, code])).rows[0].count)).toBe(1);
});

test('@lot13 upload navigateur: reponse Storage perdue puis retry du meme fichier', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, 'MEDECIN');
  const patient = state.patients[0];
  await page.goto(`/bases/${state.baseId}/patients/${patient.id}/images/new`);
  const label = `${state.prefix} upload UI ${Date.now()}`;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n');
  await page.locator('input[type="file"]').setInputFiles({ name: 'lot13-clean.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByLabel(/Libell. du document|Document label/i).fill(label);
  await page.getByLabel(/masqu.|masked/i).check();

  let lost = false;
  await page.route('**/storage/v1/object/clinical-attachments/**', async (route) => {
    if (lost || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    lost = true;
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    await route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'LOT13 simulated Storage timeout' }) });
  });
  const send = page.getByRole('button', { name: /Envoyer le document|Upload document/i });
  await send.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/storage/v1/object/clinical-attachments/**');
  await send.click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}$`, 'i'));
  const uploadedFigure = page.getByRole('figure', { name: label });
  await expect(uploadedFigure).toBeVisible();
  await expect(uploadedFigure.getByText(/Accept.|Accepted/i)).toBeVisible({ timeout: 30_000 });
  expect(Number((await db.query(
    `select count(*)::int count from public.clinical_attachment a
      join public.patient p on p.id=a.patient_id where p.base_id=$1 and a.label=$2 and a.deleted_at is null`,
    [state.baseId, label],
  )).rows[0].count)).toBe(1);
});

test('@lot13 hors-ligne: cache minimise, refresh, outbox, reconnexion, expirations, logout et changement de compte', async ({ page, context }) => {
  test.setTimeout(180_000);
  await signIn(page, 'MEDECIN');
  const patient = state.patients[1];
  await page.goto(`/bases/${state.baseId}`);
  await page.getByRole('button', { name: /Rendre disponible hors-ligne|Make available offline/i }).click();
  await expect(page.getByText(/Disponible hors-ligne|Available offline/i)).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async () => { if ('serviceWorker' in navigator) await navigator.serviceWorker.ready; });
  await page.reload();

  const snapshots = await storeRows(page, 'snapshots');
  expect(snapshots).toHaveLength(1);
  const serialized = JSON.stringify(snapshots);
  expect(serialized).not.toMatch(/full_name|date_of_birth|phone|address|Personne fictive/i);
  expect(serialized).toContain(patient.code);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Vous .tes hors-ligne|You are offline/i)).toBeVisible();
  await expect(page.getByRole('button', { name: patient.code })).toBeVisible();
  await page.goto(`/bases/${state.baseId}/patients/${patient.id}/encounters/${patient.encounterId}/edit`);
  await expect(page.getByText(/mise en file|queued/i)).toBeVisible();
  const score = page.getByLabel(/^Score$/i).first();
  await score.fill('21');
  await page.getByLabel(/Motif de la correction|Reason for the correction/i).fill(`${state.prefix} correction offline`);
  await page.getByRole('button', { name: /Enregistrer la rencontre|Save encounter/i }).click();
  await waitForOutboxCount(page, 1);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitForOutboxCount(page, 0);
  await expect.poll(async () => Number((await db.query('select data->>\'score_a\' score from public.encounter where id=$1', [patient.encounterId])).rows[0].score)).toBe(21);

  await mutateStore(page, 'snapshots', 'expire_all');
  await context.setOffline(true);
  await page.goto(`/bases/${state.baseId}`);
  await expect(page.getByRole('button', { name: patient.code })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText(/pas disponible|not available|expir/i);

  await context.setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: /Rendre disponible hors-ligne|Make available offline/i }).click();
  await expect(page.getByText(/Disponible hors-ligne|Available offline/i)).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await page.goto(`/bases/${state.baseId}/patients/${patient.id}/encounters/${patient.encounterId}/edit`);
  await page.getByLabel(/^Score$/i).first().fill('22');
  await page.getByLabel(/Motif de la correction|Reason for the correction/i).fill(`${state.prefix} outbox expiree`);
  await page.getByRole('button', { name: /Enregistrer la rencontre|Save encounter/i }).click();
  await waitForOutboxCount(page, 1);
  await mutateStore(page, 'outbox', 'expire_all');

  await context.setOffline(false);
  await page.reload();
  await waitForOutboxCount(page, 0);
  expect(Number((await db.query('select data->>\'score_a\' score from public.encounter where id=$1', [patient.encounterId])).rows[0].score)).toBe(21);

  await context.setOffline(true);
  await page.goto(`/bases/${state.baseId}/patients/${patient.id}/encounters/${patient.encounterId}/edit`);
  await page.getByLabel(/^Score$/i).first().fill('23');
  await page.getByLabel(/Motif de la correction|Reason for the correction/i).fill(`${state.prefix} purge logout`);
  await page.getByRole('button', { name: /Enregistrer la rencontre|Save encounter/i }).click();
  await waitForOutboxCount(page, 1);
  await page.getByRole('button', { name: /Se d.connecter|Sign out/i }).click();
  const dialog = page.getByRole('dialog', { name: /Modifications locales|Unsynchronized local/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Annuler|Cancel/i }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.getByRole('button', { name: /Se d.connecter|Sign out/i }).click();
  await dialog.getByRole('button', { name: /D.truire et se d.connecter|Delete and sign out/i }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  expect(await page.evaluate(() => localStorage.getItem('meddata:offline-cache-owner'))).toBeNull();
  await expect.poll(async () => {
    return page.evaluate(async () => {
      const databases = await indexedDB.databases();
      return databases.some((entry) => entry.name === 'meddata-offline');
    });
  }).toBe(false);

  await context.setOffline(false);
  await login(page, secondDoctorEmail, secondDoctorPassword);
  await page.goto(`/bases/${state.baseId}`);
  await expect(page.getByRole('button', { name: patient.code })).toHaveCount(0);
  expect(JSON.stringify(await storeRows(page, 'snapshots'))).not.toContain(patient.code);
});

test('@lot13 suppression: motif conserve apres echec, puis suppression reussie', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page, 'MEDECIN');
  const code = `${state.prefix}-DELETE-${Date.now()}`;
  await page.goto(`/bases/${state.baseId}/patients/new/manual`);
  await page.getByLabel(/Code patient|Patient code/i).fill(code);
  await page.getByLabel(/Nom complet|Full name/i).fill(`Suppression fictive ${code}`);
  await page.getByLabel(/Date de naissance|Date of birth/i).fill('1993-03-03');
  await page.getByLabel(/Poids renomme/i).fill('62');
  await page.getByRole('button', { name: /Enregistrer le patient|Save patient/i }).click();
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}$/i);

  await page.getByRole('button', { name: /Supprimer ce patient|Delete this patient/i }).click();
  const reason = `${state.prefix} motif conserve`;
  const reasonInput = page.getByLabel(/Motif de la suppression|Reason for deletion/i);
  await reasonInput.fill(reason);
  let failed = false;
  await page.route('**/rest/v1/rpc/soft_delete_patient', async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'LOT13 simulated refusal' }) });
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: /^Confirmer$|^Confirm$/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(reasonInput).toHaveValue(reason);
  await page.unroute('**/rest/v1/rpc/soft_delete_patient');
  await page.getByRole('button', { name: /^Confirmer$|^Confirm$/i }).click();
  await expect(page).toHaveURL(new RegExp(`/bases/${state.baseId}$`));
  expect(Number((await db.query('select count(*)::int count from public.patient where base_id=$1 and patient_code=$2 and deleted_at is null', [state.baseId, code])).rows[0].count)).toBe(0);
});
