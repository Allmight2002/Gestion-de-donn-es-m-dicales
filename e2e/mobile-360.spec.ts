// Audit UI mobile, lot 7 (T10) — garde-fous automatiques des ecrans sur telephone.
//
// Chaque ecran s'ouvre a 360 x 800, en tactile, dans le banc `mobile-harness.html` : les vraies
// routes, la vraie coquille et les vrais ecrans, sur des donnees ENTIEREMENT FICTIVES et sans
// serveur (src/dev/MobileHarness.tsx). Toute requete hors du serveur de developpement local est
// bloquee, et le test echoue si l'une a ete tentee. Quatre budgets de l'audit
// (docs/audits/audit-ui-mobile-2026-09-27.md, §3 et T10) :
//   1. aucun debordement horizontal ;
//   2. le premier contenu utile commence avant 400 px ;
//   3. aucune aide clavier visible au doigt (`kbd`, `.keyboard-hint`, « Ctrl … ») ;
//   4. jamais plus d'un bouton plein visible a la fois, l'ecran defilant de haut en bas.
//
// Un budget qu'un ecran ne tient pas encore est declare dans `pending`, avec le lot qui le
// traitera : il reste mesure et signale, sans faire echouer le test. Des qu'il est tenu, le test
// echoue pour qu'on retire la mention : la liste des dettes ne peut que raccourcir.
//
// L'editeur des jeux de variables (lot 6) n'a pas d'adresse propre : il s'ouvre depuis « Mes
// jeux de variables », et chacun de ses espaces est mesure comme un ecran.
//
// Usage : `npm run e2e:mobile` (Playwright demarre le serveur de developpement s'il ne tourne
// pas). Le banc n'existe que sur ce serveur local : contre une URL externe, le fichier est ignore.
import { expect, test, type Locator, type Page } from '@playwright/test';

test.skip(Boolean(process.env.E2E_BASE_URL), 'Banc local : servi uniquement par le serveur de developpement.');
const VIEWPORT = { width: 360, height: 800 };
test.use({ viewport: VIEWPORT, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'fr-FR' });

const FIRST_CONTENT_MAX = 400;

type Budget = 'overflow' | 'firstContent' | 'keyboard' | 'filled';
const BUDGETS: Record<Budget, string> = {
  overflow: 'aucun debordement horizontal',
  firstContent: `premier contenu utile avant ${FIRST_CONTENT_MAX} px`,
  keyboard: 'aucune aide clavier au doigt',
  filled: 'un seul bouton plein visible',
};

/** Le premier contenu utile : un texte (expression reguliere) ou un selecteur CSS, dans `main`. */
type Target = { text: string } | { selector: string };

interface Screen {
  name: string;
  path: string;
  /** Ecran sans adresse propre (editeur des jeux de variables) : le geste qui l'affiche. */
  open?: (page: Page) => Promise<void>;
  /** Ce pour quoi on ouvre l'ecran : la premiere base, le premier patient, le premier champ… */
  first: Target;
  /** Budgets pas encore tenus, avec le lot de l'audit qui les traite. */
  pending?: Partial<Record<Budget, string>>;
}

// Le premier champ commence a son libelle.
const FIELD = ':is(label, input:not([type=hidden]), select, textarea)';
const FIRST_FIELD: Target = { selector: FIELD };

// Lot 6 : l'editeur s'ouvre depuis « Mes jeux de variables », sur un brouillon fictif de 216
// variables, 24 sections et 38 regles ; chaque espace est un onglet.
const openEditor = (tab?: string) => async (page: Page) => {
  await page.getByRole('listitem').filter({ hasText: 'Registre multipathologies' })
    .getByRole('button', { name: 'Ouvrir le jeu de variables' }).click();
  if (tab) await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
};

// Revue post-optimisation (C2) : un formulaire de saisie s'edite depuis sa ligne.
const openEntryForm = async (page: Page) => {
  await page.getByRole('button', { name: 'Modifier Sortie (fictif)' }).click();
};

// Lot 8 : le mode Terrain s'active dans le menu, comme le ferait la personne.
const enableTerrain = async (page: Page) => {
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('dialog', { name: 'Ouvrir le menu' }).getByRole('switch', { name: 'Mode Terrain' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Plus', exact: true })).toBeVisible();
};

const SCREENS: Screen[] = [
  // Lot 8 : le tableau de bord est la page « A faire » ; ce qui attend la personne vient en premier.
  { name: 'tableau de bord', path: '/', first: { selector: 'section[aria-labelledby="todo-title"] li' } },
  { name: 'liste des patients', path: '/bases/b1', first: { text: '^P-0001$' } },
  { name: 'liste des patients — mode Terrain', path: '/bases/b1', open: enableTerrain, first: { text: '^P-0001$' } },
  { name: 'fiche patient', path: '/bases/b1/patients/p1', first: { selector: 'dd' } },
  { name: 'nouveau patient', path: '/bases/b1/patients/new/manual', first: FIRST_FIELD },
  { name: 'nouveau patient — formulaire court', path: '/bases/b1/patients/new/manual?form=ef1', first: FIRST_FIELD },
  { name: 'nouvelle rencontre', path: '/bases/b1/patients/p1/encounters/new/manual', first: FIRST_FIELD },
  { name: 'donnees permanentes', path: '/bases/b1/patients/p1/edit', first: FIRST_FIELD },
  { name: 'modification d’une rencontre', path: '/bases/b1/patients/p1/encounters/e1/edit', first: FIRST_FIELD },
  { name: 'correction de l’identite', path: '/bases/b1/patients/p1/identity/edit', first: FIRST_FIELD },
  // Revue post-optimisation (C4) : les champs CIM-11, tels que « Coder » les ouvre.
  { name: 'diagnostic principal', path: '/bases/b1/patients/p1/edit?field=diagnostic',
    first: { text: '^Hémorragie sousdurale non traumatique$' } },
  { name: 'diagnostics associes', path: '/bases/b1/patients/p1/encounters/e2/edit?field=diagnostics',
    first: { text: '^Commotion cérébrale$' } },
  { name: 'dossiers a completer', path: '/bases/b1/queue', first: { text: '^P-0001$' } },
  { name: 'diagnostics a coder', path: '/bases/b1/codings', first: { text: '^P-0001$' } },
  { name: 'journal', path: '/bases/b1/activity', first: { selector: 'li' } },
  { name: 'cohortes', path: '/bases/b1/cohorts', first: { text: 'Glasgow ≤ 12' } },
  { name: 'statistiques', path: '/bases/b1/stats', first: { text: '^Patients inclus$' } },
  { name: 'export', path: '/bases/b1/export', first: FIRST_FIELD },
  // Lot 5 : les reglages en lignes, et la liste avant le formulaire de creation.
  { name: 'parametres', path: '/bases/b1/parametres', first: { text: '^Modèle d’observation$' } },
  { name: 'formulaire', path: '/bases/b1/template', first: { text: '^Formulaire :' } },
  // Revue post-optimisation (C2) : les formulaires de saisie courts, la liste puis l'edition.
  { name: 'formulaires de saisie', path: '/bases/b1/formulaires', first: { text: '^Admission \\(fictif\\)$' } },
  { name: 'formulaire de saisie — edition', path: '/bases/b1/formulaires', open: openEntryForm, first: FIRST_FIELD },
  { name: 'acces', path: '/bases/b1/access', first: { text: 'Dr Collègue' } },
  { name: 'comptes de mission', path: '/missions', first: { text: 'Enquêteur 1' } },
  { name: 'synchronisation', path: '/sync', first: { text: '^Écritures en attente$' } },
  { name: 'mes jeux de variables', path: '/templates', first: { text: 'Neurotraumatologie' } },
  { name: 'bibliotheque', path: '/templates/library', first: { text: '^Registre neurologique$' } },
  { name: 'jeu depuis un fichier', path: '/templates/from-file', first: FIRST_FIELD },
  // Lot 6 : en Structure, le titre du bloc affiche ; ses variables suivent sa condition.
  { name: 'editeur — structure', path: '/templates', open: openEditor(), first: { selector: '#editor-structure-heading' } },
  { name: 'editeur — sections', path: '/templates', open: openEditor('Sections'), first: { selector: '#editor-panel-sections li' } },
  { name: 'editeur — regles', path: '/templates', open: openEditor('Règles'), first: { selector: '#editor-panel-rules li' } },
  { name: 'editeur — collecte diagnostique', path: '/templates', open: openEditor('Collecte diagnostique'),
    first: { text: '^Collecte diagnostique optionnelle$' } },
  { name: 'editeur — apercu', path: '/templates', open: openEditor('Aperçu'), first: { selector: `#editor-panel-preview ${FIELD}` } },
];

interface Measures {
  coarsePointer: boolean;
  documentWidth: number;
  firstTop: number | null;
  hints: string[];
  filled: { scrollY: number; labels: string[] };
}

/**
 * Mesures, executees DANS la page (fonction autonome). « Visible » = rendu et plus grand que
 * 2 px : un texte reserve aux lecteurs d'ecran (`sr-only`, 1 px) ne compte pas.
 *
 * Les largeurs et hauteurs d'ecran viennent de la configuration, pas de `innerWidth` : en
 * emulation mobile, une page qui deborde est dezoomee et `innerWidth` grandit avec elle.
 */
function measureBudgets({ target, viewport }: { target: Target; viewport: { width: number; height: number } }): Measures {
  const shown = (element: Element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && box.width > 2 && box.height > 2;
  };
  const shownText = (root: Node, pattern: RegExp) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found: Element[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && pattern.test((node.textContent ?? '').trim()) && shown(parent)) found.push(parent);
    }
    return found;
  };
  const label = (element: Element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();

  window.scrollTo(0, 0);
  const main = document.querySelector('main') ?? document.body;
  const first = 'text' in target
    ? shownText(main, new RegExp(target.text))[0]
    : [...main.querySelectorAll(target.selector)].find(shown);
  const firstTop = first ? Math.round(first.getBoundingClientRect().top + window.scrollY) : null;

  const hints = [
    ...[...document.querySelectorAll('kbd, .keyboard-hint')].filter(shown),
    ...shownText(document.body, /\b(Ctrl|Cmd)\b|⌘/),
  ].map(label);

  // Boutons pleins ensemble a l'ecran, a chaque demi-ecran de defilement.
  let filled = { scrollY: 0, labels: [] as string[] };
  const last = Math.max(0, document.documentElement.scrollHeight - viewport.height);
  for (let y = 0; ; y = Math.min(y + viewport.height / 2, last)) {
    window.scrollTo(0, y);
    const labels = [...document.querySelectorAll('.btn-primary, .btn-danger')].filter((element) => {
      const box = element.getBoundingClientRect();
      return shown(element) && box.bottom > 0 && box.top < viewport.height;
    }).map(label);
    if (labels.length > filled.labels.length) filled = { scrollY: Math.round(window.scrollY), labels };
    if (y >= last) break;
  }
  window.scrollTo(0, 0);

  return {
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    documentWidth: document.documentElement.scrollWidth,
    firstTop,
    hints: [...new Set(hints)],
    filled,
  };
}

/** Revue post-optimisation (C4) : boutons d'une zone de moins de 40 px de cote, trop petits au doigt. */
const smallTargets = (zone: Locator) => zone.locator('button').evaluateAll((buttons) => buttons.flatMap((button) => {
  const box = button.getBoundingClientRect();
  if (box.width === 0 || box.height === 0 || (box.width >= 40 && box.height >= 40)) return [];
  const name = (button.getAttribute('aria-label') ?? button.textContent ?? '').replace(/\s+/g, ' ').trim();
  return [`${name} : ${Math.round(box.width)} x ${Math.round(box.height)} px`];
}));

/** Ouvre un ecran du banc ; renvoie les incidents (erreur JavaScript, depot non simule, reseau). */
async function openScreen(page: Page, path: string): Promise<string[]> {
  const incidents: string[] = [];
  page.on('pageerror', (error) => incidents.push(`erreur JavaScript : ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('[banc mobile]')) incidents.push(message.text());
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    incidents.push(`requete hors banc bloquee : ${url.origin}`);
    return route.abort();
  });
  await page.goto(`/mobile-harness.html#${path}`);
  return incidents;
}

/** Mesures prises une fois l'ecran charge et stable (deux releves identiques de suite). */
async function settledMeasures(page: Page, screen: Screen): Promise<Measures> {
  let measures: Measures | null = null;
  let previous = '';
  await expect.poll(async () => {
    measures = await page.evaluate(measureBudgets, { target: screen.first, viewport: VIEWPORT });
    const current = JSON.stringify(measures);
    const settled = measures.firstTop !== null && current === previous;
    previous = current;
    return settled;
  }, { message: `${screen.name} : premier contenu utile introuvable`, timeout: 15_000, intervals: [250] }).toBe(true);
  return measures!;
}

function checkBudget(screen: Screen, budget: Budget, holds: boolean, detail: string) {
  const pending = screen.pending?.[budget];
  if (!pending) {
    expect.soft(holds, `${screen.name} — ${BUDGETS[budget]} : ${detail}`).toBe(true);
    return;
  }
  test.info().annotations.push({ type: 'dette connue', description: `${screen.name} — ${BUDGETS[budget]} : ${detail} (${pending})` });
  expect.soft(holds, `${screen.name} — « ${BUDGETS[budget]} » est desormais tenu : retirer ${budget} de pending`).toBe(false);
}

test.describe('@mobile budgets de l’audit a 360 px', () => {
  for (const screen of SCREENS) {
    test(`${screen.name} (${screen.path})`, async ({ page }) => {
      const incidents = await openScreen(page, screen.path);
      await screen.open?.(page);
      const measures = await settledMeasures(page, screen);
      test.info().annotations.push({ type: 'mesures', description: JSON.stringify(measures) });

      expect(measures.coarsePointer, 'le contexte doit emuler un ecran tactile (pointer: coarse)').toBe(true);
      checkBudget(screen, 'overflow', measures.documentWidth <= VIEWPORT.width,
        `document de ${measures.documentWidth} px pour un ecran de ${VIEWPORT.width} px`);
      checkBudget(screen, 'firstContent', (measures.firstTop ?? Infinity) <= FIRST_CONTENT_MAX,
        `premier contenu utile a ${measures.firstTop} px`);
      checkBudget(screen, 'keyboard', measures.hints.length === 0, `visible : ${measures.hints.join(' | ')}`);
      checkBudget(screen, 'filled', measures.filled.labels.length <= 1,
        `${measures.filled.labels.length} ensemble a ${measures.filled.scrollY} px de defilement : ${measures.filled.labels.join(' | ')}`);
      expect(incidents, 'aucune erreur JavaScript, aucun depot non simule, aucune requete hors banc').toEqual([]);
    });
  }

  // Audit UI mobile, lot 4 : ce qui s'ouvre a la demande (details, « ⋯ », liste complete)
  // tient lui aussi dans l'ecran — l'empreinte SHA-256 depliee debordait.
  const ON_DEMAND: { screen: string; open: (page: Page) => Promise<void> }[] = [
    // Lot 8 : un brouillon de la page « A faire » rouvre son formulaire ; l'identite du patient
    // ne se lit qu'au toucher de sa ligne.
    { screen: 'tableau de bord', open: async (page) => {
      await expect(page.getByRole('link', { name: /^Mission : \d+ jour\(s\) restant\(s\)/ })).toBeVisible();
      await page.getByRole('link', { name: /^Nouvelle rencontre · P-0001/ }).click();
      await expect(page.getByLabel('Type de rencontre')).toBeVisible();
    } },
    { screen: 'fiche patient', open: async (page) => {
      await expect(page.getByText('Awa Démo (fictive)')).toHaveCount(0);
      await page.getByRole('button', { name: 'Identité (zone restreinte)' }).click();
      await expect(page.getByText('Awa Démo (fictive)')).toBeVisible();
      // Revue post-optimisation (C3) : « Compléter avec » rejoint « Finaliser » dans « ⋯ ».
      await expect(page.getByRole('button', { name: 'Compléter avec' })).toBeHidden();
      await page.getByRole('banner').getByRole('button', { name: 'Plus d’actions' }).click();
      await expect(page.getByRole('button', { name: 'Compléter avec Admission (fictif)' })).toBeVisible();
    } },
    // Revue post-optimisation (C3) : un diagnostic a coder ouvre le formulaire de sa rencontre, sur
    // le champ a coder (que le banc porte depuis C4).
    { screen: 'diagnostics a coder', open: async (page) => {
      await page.getByRole('link', { name: /Coder$/ }).first().click();
      // Champ de rencontre : seul le formulaire de la rencontre le porte.
      await expect(page.getByRole('combobox', { name: 'Diagnostics associés' })).toBeFocused();
    } },
    // Revue post-optimisation (C4) : le texte ecrit se lit sans survol, chaque action d'une entree
    // est une cible de 40 px au moins, et le telechargement n'apparait qu'une fois.
    { screen: 'diagnostic principal', open: async (page) => {
      const zone = page.locator('[id$="-field-diagnostic"]');
      await expect(zone.getByText('Saisi : HSD chronique droit (fictif)')).toBeVisible();
      await expect(zone.getByRole('button', { name: 'Confirmer Hémorragie sousdurale non traumatique' })).toBeVisible();
      expect(await smallTargets(zone), 'diagnostic principal : cibles de moins de 40 px').toEqual([]);
      // « Changer » rouvre la recherche, que le lien de telechargement accompagne.
      await zone.getByRole('button', { name: 'Changer', exact: true }).click();
      await expect(zone.getByRole('combobox', { name: 'Diagnostic principal' })).toHaveValue('HSD chronique droit (fictif)');
      await expect(page.getByRole('button', { name: 'Télécharger pour rechercher hors connexion' })).toHaveCount(1);
      expect(await smallTargets(zone), 'diagnostic principal en correction : cibles de moins de 40 px').toEqual([]);
    } },
    { screen: 'diagnostics associes', open: async (page) => {
      const zone = page.locator('[id$="-field-diagnostics"]');
      await expect(zone.getByText('Saisi : commotion (fictif)')).toBeVisible();
      // Le texte non code rouvert : ses correspondances sont reproposees, en boutons pleine largeur.
      await expect(zone.getByRole('button', { name: /^Céphalée post-traumatique aiguë/ })).toBeVisible();
      // Un texte libre que la nomenclature ne connait pas : analyse, puis nouvelle recherche possible.
      const champ = zone.getByRole('combobox', { name: 'Diagnostics associés' });
      await champ.fill('Douleur cervicale (fictif)');
      await champ.press('Enter');
      await expect(zone.getByRole('button', { name: 'Rechercher une correspondance' })).toBeVisible();
      expect(await smallTargets(zone), 'diagnostics associes : cibles de moins de 40 px').toEqual([]);
      await expect(page.getByRole('button', { name: 'Télécharger pour rechercher hors connexion' })).toHaveCount(1);
    } },
    // Lot 8 : en mode Terrain, « Plus » mene aux autres destinations de la base.
    { screen: 'liste des patients — mode Terrain', open: async (page) => {
      await page.getByRole('button', { name: 'Plus', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Analyse' })).toBeVisible();
      await page.getByRole('button', { name: 'Paramètres' }).click();
      await expect(page.getByRole('navigation', { name: 'Paramètres' })).toBeVisible();
    } },
    { screen: 'export', open: async (page) => {
      await page.getByText('Détails techniques').first().click();
      await expect(page.getByText(/^1{8}a{56}$/)).toBeVisible();
    } },
    { screen: 'cohortes', open: async (page) => {
      await page.getByRole('button', { name: /^Actions · Glasgow ≤ 12/ }).click();
      await expect(page.getByRole('button', { name: 'Exporter' })).toBeVisible();
    } },
    { screen: 'statistiques', open: async (page) => {
      await page.getByRole('button', { name: /^Voir les \d+ variables$/ }).click();
      await expect(page.getByRole('heading', { level: 3, name: 'Imagerie' })).toBeVisible();
    } },
    // Lot 5 : lignes de reglage, droits d'un membre, missions terminees et edition du formulaire.
    { screen: 'parametres', open: async (page) => {
      await page.getByRole('button', { name: /^Hors-ligne/ }).click();
      await expect(page.getByRole('button', { name: 'Rendre disponible hors-ligne' })).toBeVisible();
    } },
    { screen: 'acces', open: async (page) => {
      await page.getByRole('button', { name: 'Modifier les droits' }).first().click();
      await expect(page.getByRole('checkbox', { name: 'Gestion des accès' })).toBeVisible();
      await page.getByRole('button', { name: 'Inviter' }).click();
      await expect(page.getByLabel('E-mail')).toBeVisible();
    } },
    { screen: 'comptes de mission', open: async (page) => {
      await page.getByRole('button', { name: /^Terminées/ }).click();
      await expect(page.getByText('Enquêteur 2 (fictif)')).toBeVisible();
      await page.getByRole('button', { name: 'Actions · Enquêteur 1 (fictif)' }).click();
      await expect(page.getByRole('button', { name: 'Régénérer le mot de passe' })).toBeVisible();
    } },
    { screen: 'formulaire', open: async (page) => {
      await page.getByRole('button', { name: 'Modifier le formulaire' }).click();
      await expect(page.getByTestId('form-preparation-session')).toBeVisible();
      // Plein ecran : ni fil d'Ariane ni onglets de la base pendant l'edition.
      await expect(page.getByRole('navigation', { name: 'Traumatismes crâniens CHU-R (fictif)' })).toHaveCount(0);
    } },
    // Revue post-optimisation (C2) : « ⋯ » d'un formulaire de saisie ; sections a deplier et
    // recherche qui deplie tout.
    { screen: 'formulaires de saisie', open: async (page) => {
      await page.getByRole('button', { name: 'Actions · Admission (fictif)' }).click();
      await expect(page.getByRole('button', { name: 'Supprimer' })).toBeVisible();
    } },
    { screen: 'formulaire de saisie — edition', open: async (page) => {
      await page.getByRole('button', { name: /^Démographie/ }).click();
      await expect(page.getByRole('checkbox', { name: 'Localité / quartier' })).toBeVisible();
      await page.getByRole('searchbox', { name: 'Rechercher une variable' }).fill('vomi');
      await expect(page.getByRole('checkbox', { name: 'Vomissements' })).toBeVisible();
    } },
    // Lot 6 : panneaux bas, menus « ⋯ », mode Réorganiser, fiche d'une variable, sections
    // depliees, groupe de regles, formulaire de regle et sa liste recherchable.
    { screen: 'editeur — structure', open: async (page) => {
      await page.getByRole('button', { name: 'Filtres' }).click();
      await expect(page.getByRole('dialog', { name: 'Filtres et tri' }).getByLabel('Trier l’affichage')).toBeVisible();
      await page.getByRole('dialog', { name: 'Filtres et tri' }).getByRole('button', { name: 'Fermer' }).click();
      await page.getByRole('button', { name: 'Index des sections' }).click();
      await page.getByRole('dialog', { name: 'Index des sections' }).getByRole('button', { name: /^Bloc 02 · \d+ variable/ }).click();
      await expect(page.getByRole('heading', { level: 3, name: 'Bloc 02' })).toBeVisible();
      await page.getByRole('button', { name: 'Actions · Bloc 02 · Variable directe 01' }).click();
      await expect(page.getByRole('button', { name: 'Déplacer' })).toBeVisible();
      await page.getByRole('button', { name: 'Réorganiser' }).click();
      await expect(page.getByRole('button', { name: 'Monter · Bloc 02 · Variable directe 02' })).toBeVisible();
      await page.getByRole('button', { name: 'Modifier la variable · Bloc 02 · Variable directe 01' }).click();
      await expect(page.getByRole('button', { name: 'Variable suivante' })).toBeVisible();
    } },
    { screen: 'editeur — sections', open: async (page) => {
      await page.getByRole('button', { name: /^Bloc 01 · 8 variable/ }).click();
      await expect(page.getByRole('button', { name: 'Renommer' })).toBeVisible();
      // Revue post-optimisation (C5) : un groupe repetable resume ses libelles de saisie ; leur
      // formulaire ne s'ouvre qu'a la demande.
      await page.getByRole('button', { name: /^Consultations de suivi \(fictif\) · / }).click();
      await expect(page.getByText('Libellés : « Ajouter une consultation » · « Consultation 1 »')).toBeVisible();
      await expect(page.getByLabel('Texte du bouton d’ajout')).toHaveCount(0);
      await page.getByRole('button', { name: 'Modifier les libellés · Consultations de suivi (fictif)' }).click();
      await expect(page.getByLabel('Texte du bouton d’ajout')).toHaveValue('Ajouter une consultation');
      await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await page.getByRole('button', { name: 'Nouvelle section' }).click();
      await expect(page.getByLabel('Nom de la section')).toBeVisible();
    } },
    { screen: 'editeur — regles', open: async (page) => {
      await page.getByRole('button', { name: /^Si Bloc 01 · Variable directe 04 .* → affiche 12 variable/ }).click();
      await expect(page.getByText('→ Bloc 02 · Sous-section A · Variable 01 est affichée')).toBeVisible();
      await page.getByRole('button', { name: 'Filtres' }).click();
      await page.getByRole('dialog', { name: 'Filtres' }).getByRole('button', { name: 'Fermer' }).click();
      await page.getByRole('button', { name: 'Ajouter une règle' }).click();
      await page.getByRole('combobox', { name: 'Variable à contrôler' }).click();
      await expect(page.getByRole('listbox', { name: 'Variable à contrôler' })).toBeVisible();
    } },
  ];
  for (const { screen: name, open } of ON_DEMAND) {
    test(`${name} : contenu ouvert a la demande`, async ({ page }) => {
      const screen = SCREENS.find((entry) => entry.name === name)!;
      const incidents = await openScreen(page, screen.path);
      await screen.open?.(page);
      await settledMeasures(page, screen);
      await open(page);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, `${name} : document de ${width} px une fois ouvert, pour ${VIEWPORT.width} px`).toBeLessThanOrEqual(VIEWPORT.width);
      expect(incidents, 'aucune erreur JavaScript, aucun depot non simule, aucune requete hors banc').toEqual([]);
    });
  }

  // Revue post-optimisation (C2) : un panneau de menu s'affiche en entier. La largeur du document
  // ne le dit pas : un panneau sorti par la gauche ne l'elargit pas, et un panneau recouvert par
  // la suite de la page non plus (« + Nouveau » des jeux de variables, « ⋯ » de l'editeur).
  const MENUS: { screen: string; trigger: (page: Page) => Locator }[] = [
    { screen: 'mes jeux de variables', trigger: (page) => page.getByRole('button', { name: 'Nouveau', exact: true }) },
    { screen: 'editeur — structure',
      trigger: (page) => page.getByTestId('template-editor-toolbar').getByRole('button', { name: 'Plus d’actions' }) },
    { screen: 'fiche patient', trigger: (page) => page.getByRole('banner').getByRole('button', { name: 'Plus d’actions' }) },
    { screen: 'formulaires de saisie', trigger: (page) => page.getByRole('button', { name: 'Actions · Admission (fictif)' }) },
    // Revue post-optimisation (C4) : « Changer » et « Retirer » d'un diagnostic de la liste.
    { screen: 'diagnostics associes', trigger: (page) => page.getByRole('button', { name: 'Actions · Commotion cérébrale' }) },
    { screen: 'cohortes', trigger: (page) => page.getByRole('button', { name: /^Actions · Glasgow ≤ 12/ }) },
    { screen: 'comptes de mission', trigger: (page) => page.getByRole('button', { name: 'Actions · Enquêteur 1 (fictif)' }) },
  ];
  for (const { screen: name, trigger } of MENUS) {
    test(`${name} : panneau de menu entierement visible`, async ({ page }) => {
      const screen = SCREENS.find((entry) => entry.name === name)!;
      const incidents = await openScreen(page, screen.path);
      await screen.open?.(page);
      await settledMeasures(page, screen);
      const button = trigger(page);
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      // Le panneau suit son declencheur dans le meme conteneur (src/components/Menu.tsx).
      const report = await button.locator('xpath=following-sibling::div[1]').evaluate((panel) => {
        const box = panel.getBoundingClientRect();
        const hidden: string[] = [];
        for (const fx of [0.05, 0.5, 0.95]) {
          for (const fy of [0.1, 0.5, 0.9]) {
            const x = box.left + box.width * fx;
            const y = box.top + box.height * fy;
            const hit = document.elementFromPoint(x, y);
            if (!hit || !panel.contains(hit)) hidden.push(`${Math.round(x)},${Math.round(y)} : ${hit ? hit.tagName.toLowerCase() : 'hors de l’ecran'}`);
          }
        }
        return { left: Math.round(box.left), right: Math.round(box.right), hidden };
      });
      expect(report.left, `${name} : panneau a ${report.left} px du bord gauche`).toBeGreaterThanOrEqual(0);
      expect(report.right, `${name} : panneau jusqu'a ${report.right} px, pour ${VIEWPORT.width} px`).toBeLessThanOrEqual(VIEWPORT.width);
      expect(report.hidden, `${name} : points du panneau caches ou recouverts`).toEqual([]);
      expect(incidents, 'aucune erreur JavaScript, aucun depot non simule, aucune requete hors banc').toEqual([]);
    });
  }

  test('tiroir de navigation et palette de recherche', async ({ page }) => {
    const screen = SCREENS.find((entry) => entry.name === 'liste des patients')!;
    const incidents = await openScreen(page, screen.path);
    await settledMeasures(page, screen);

    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Ouvrir le menu' });
    await expect(drawer.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
    const hints = async () => (await page.evaluate(measureBudgets, { target: { selector: 'nav' }, viewport: VIEWPORT })).hints;
    expect(await hints(), 'tiroir : aucune aide clavier au doigt').toEqual([]);

    await drawer.getByRole('button', { name: /Rechercher/ }).click();
    await expect(page.getByPlaceholder('Rechercher une base, un écran…')).toBeVisible();
    expect(await hints(), 'palette : aucune aide clavier au doigt').toEqual([]);
    expect(incidents, 'aucune erreur JavaScript, aucun depot non simule, aucune requete hors banc').toEqual([]);
  });
});
