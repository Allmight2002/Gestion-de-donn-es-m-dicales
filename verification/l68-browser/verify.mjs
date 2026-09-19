import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.env.L68_BROWSER_URL ?? 'http://127.0.0.1:4173/verification/l68-browser/';
const artifactDirectory = path.resolve(
  process.env.L68_BROWSER_ARTIFACT_DIR ?? path.join(process.cwd(), 'verification', 'l68-browser', 'artifacts'),
);
await mkdir(artifactDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const blockedRemoteRequests = [];
const pageErrors = [];
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (local || url.protocol === 'data:') {
    await route.continue();
    return;
  }
  blockedRemoteRequests.push(url.href);
  await route.abort();
});

const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    blockedRemoteRequests.push(url.href);
  }
});

const report = (label) => console.log(`PASS ${label}`);
const saveShot = async (name) => {
  const filePath = path.join(artifactDirectory, name);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`SCREENSHOT ${filePath}`);
};
const expectNoDocumentOverflow = async (label) => {
  const width = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(width.document <= width.viewport, `${label}: document width ${width.document}px exceeds viewport ${width.viewport}px`);
  report(`${label}: aucun débordement horizontal du document (${width.document}/${width.viewport}px)`);
};
const waitForRowCount = async (expected) => {
  await page.waitForFunction((count) => {
    const table = document.querySelector('table');
    return table?.querySelectorAll('tbody tr').length === count;
  }, expected);
};

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('table', { name: 'Occurrences de Groupe fictif' }).waitFor();
  assert.match(await page.getByRole('main').innerText(), /Persistance simulée en mémoire/);
  report('fixture visible et persistance explicitement simulée');

  const initialTable = page.getByRole('table', { name: 'Occurrences de Groupe fictif' });
  assert.equal(await initialTable.getByRole('row').count(), 2, 'un en-tête et une occurrence initiale sont attendus');
  assert.equal(await page.getByText('Fixture initiale — A', { exact: true }).count(), 1);
  report('rendu desktop initial: véritable tableau avec une occurrence fictive');
  await expectNoDocumentOverflow('desktop initial');
  await saveShot('01-desktop-table-initiale.png');

  await page.getByRole('button', { name: 'Ajouter une occurrence' }).click();
  const newGroup = page.getByRole('group', { name: 'Nouvelle occurrence de Groupe fictif' });
  await newGroup.waitFor();
  await newGroup.getByLabel('Repère de démonstration').fill('Fixture ajoutée par le navigateur');
  await newGroup.getByLabel('Mesure d’essai — valeur fictive').fill('7.5');
  await newGroup.getByLabel('Contexte simulé').fill('Contexte fictif créé dans le navigateur avec une phrase qui se replie sans débordement horizontal et garde les mots lisibles sur mobile.');
  await newGroup.getByLabel('Note de fixture').fill('Note simulée par Playwright.');
  await newGroup.getByLabel('Origine de démonstration').fill('Harness local isolé.');
  await newGroup.getByLabel('Texte long de contrôle').fill('Texte fictif long avec plusieurs mots lisibles pour contrôler le retour à la ligne sur petits écrans. '.repeat(3));
  await saveShot('02-desktop-formulaire-ajout.png');
  await newGroup.getByRole('button', { name: 'Enregistrer l’occurrence' }).click();
  await waitForRowCount(2);
  assert.equal(await page.getByText('Fixture ajoutée par le navigateur', { exact: true }).count(), 1);
  report('ajout: EncounterFields a alimenté le dépôt mémoire injecté et la ligne apparaît au tableau');

  await page.getByRole('button', { name: 'Modifier l’occurrence 1 de Groupe fictif' }).click();
  const editGroup = page.getByRole('group', { name: 'Occurrence 1 de Groupe fictif' });
  await editGroup.waitFor();
  await editGroup.getByLabel('Repère de démonstration').fill('Fixture corrigée dans le navigateur');
  await editGroup.getByLabel('Motif de la correction').fill('Correction fictive de vérification locale.');
  await editGroup.getByRole('button', { name: 'Enregistrer l’occurrence' }).click();
  await waitForRowCount(2);
  assert.equal(await page.getByText('Fixture corrigée dans le navigateur', { exact: true }).count(), 1);
  report('édition: modification et motif requis transmis au dépôt mémoire, sans écriture distante');
  await saveShot('03-desktop-apres-edition.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('listitem', { name: 'Occurrence 1' }).waitFor();
  assert.equal(await page.getByRole('table').count(), 0, 'à 390 px, le rendu doit utiliser des cartes');
  assert.equal(await page.getByRole('listitem').count(), 2, 'les deux occurrences doivent être visibles en cartes');
  assert.equal(await page.getByText('Fixture ajoutée par le navigateur', { exact: true }).count(), 1);
  await expectNoDocumentOverflow('mobile 390 px avec texte long');
  await saveShot('04-mobile-390-cartes.png');
  report('mobile 390 px: deux cartes exposent les valeurs et libellés du tableau');

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole('table', { name: 'Occurrences de Groupe fictif' }).waitFor();
  const tabletWidths = await page.locator('table').evaluate((table) => ({
    table: table.scrollWidth,
    wrapper: table.parentElement?.clientWidth ?? 0,
    wrapperScroll: table.parentElement?.scrollWidth ?? 0,
  }));
  await expectNoDocumentOverflow('tablette 768 px');
  assert.equal(await page.getByRole('listitem').count(), 0, 'à 768 px, le rendu doit rester en tableau');
  report(`tablette 768 px: tableau actif; conteneur ${tabletWidths.wrapper}px, tableau ${tabletWidths.table}px, zone défilable ${tabletWidths.wrapperScroll}px`);
  await saveShot('05-tablette-768-tableau.png');

  await page.setViewportSize({ width: 767, height: 1024 });
  await page.getByRole('listitem', { name: 'Occurrence 1' }).waitFor();
  assert.equal(await page.getByRole('table').count(), 0, 'à 767 px, le rendu doit basculer en cartes');
  await expectNoDocumentOverflow('frontière mobile 767 px');
  report('frontière 767/768 px vérifiée: cartes à 767 px, tableau à 768 px');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('table', { name: 'Occurrences de Groupe fictif' }).waitFor();
  await page.getByRole('button', { name: 'Supprimer l’occurrence 2 de Groupe fictif' }).click();
  await page.getByLabel('Motif de la suppression').fill('Suppression fictive de la seconde occurrence.');
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await waitForRowCount(1);
  assert.equal(await page.getByText('Fixture ajoutée par le navigateur', { exact: true }).count(), 0);
  report('suppression: motif requis accepté et seconde occurrence retirée du dépôt mémoire');

  await page.getByRole('button', { name: 'Supprimer l’occurrence 1 de Groupe fictif' }).click();
  await page.getByLabel('Motif de la suppression').fill('Nettoyage fictif du scénario navigateur.');
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('table') === null);
  const emptyStateText = await page.getByRole('main').innerText();
  assert.match(emptyStateText, /Aucune occurrence saisie/, `texte d’état vide observé: ${emptyStateText}`);
  assert.equal(await page.getByRole('table').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Ajouter une occurrence' }).count(), 1);
  report('état vide: message explicite et action Ajouter une occurrence disponibles');
  await saveShot('06-desktop-etat-vide.png');

  assert.deepEqual(blockedRemoteRequests, [], `requêtes distantes bloquées ou observées: ${blockedRemoteRequests.join(', ')}`);
  assert.deepEqual(pageErrors, [], `erreurs JavaScript navigateur: ${pageErrors.join(' | ')}`);
  report('aucune requête HTTP distante et aucune erreur JavaScript observée');
  console.log(`ARTIFACT_DIRECTORY ${artifactDirectory}`);
} finally {
  await context.close();
  await browser.close();
}

