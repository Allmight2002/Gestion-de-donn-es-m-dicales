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
// Usage : `npm run e2e:mobile` (Playwright demarre le serveur de developpement s'il ne tourne
// pas). Le banc n'existe que sur ce serveur local : contre une URL externe, le fichier est ignore.
import { expect, test, type Page } from '@playwright/test';

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
  /** Ce pour quoi on ouvre l'ecran : la premiere base, le premier patient, le premier champ… */
  first: Target;
  /** Budgets pas encore tenus, avec le lot de l'audit qui les traite. */
  pending?: Partial<Record<Budget, string>>;
}

// Le premier champ commence a son libelle.
const FIRST_FIELD: Target = { selector: ':is(label, input:not([type=hidden]), select, textarea)' };
// Lot 5 de l'audit (« Reglages et gestion ») : la liste avant le formulaire de creation.
const LIST_FIRST = 'lot 5 : la liste avant le formulaire de création';

const SCREENS: Screen[] = [
  { name: 'tableau de bord', path: '/', first: { text: 'Traumatismes crâniens CHU-R' } },
  { name: 'liste des patients', path: '/bases/b1', first: { text: '^P-0001$' } },
  { name: 'fiche patient', path: '/bases/b1/patients/p1', first: { selector: 'dd' } },
  { name: 'nouveau patient', path: '/bases/b1/patients/new/manual', first: FIRST_FIELD },
  { name: 'nouvelle rencontre', path: '/bases/b1/patients/p1/encounters/new/manual', first: FIRST_FIELD },
  { name: 'donnees permanentes', path: '/bases/b1/patients/p1/edit', first: FIRST_FIELD },
  { name: 'modification d’une rencontre', path: '/bases/b1/patients/p1/encounters/e1/edit', first: FIRST_FIELD },
  { name: 'correction de l’identite', path: '/bases/b1/patients/p1/identity/edit', first: FIRST_FIELD },
  { name: 'dossiers a completer', path: '/bases/b1/queue', first: { text: '^P-0001$' } },
  { name: 'journal', path: '/bases/b1/activity', first: { selector: 'li' } },
  { name: 'cohortes', path: '/bases/b1/cohorts', first: { text: 'Glasgow ≤ 12' } },
  { name: 'statistiques', path: '/bases/b1/stats', first: { text: '^Patients inclus$' } },
  { name: 'export', path: '/bases/b1/export', first: FIRST_FIELD },
  { name: 'parametres', path: '/bases/b1/parametres', first: FIRST_FIELD },
  { name: 'acces', path: '/bases/b1/access', first: { text: 'Dr Collègue' }, pending: { firstContent: LIST_FIRST } },
  { name: 'comptes de mission', path: '/missions', first: { text: 'Enquêteur 1' }, pending: { firstContent: LIST_FIRST } },
  { name: 'synchronisation', path: '/sync', first: { text: '^Écritures en attente$' } },
  { name: 'mes jeux de variables', path: '/templates', first: { text: 'Neurotraumatologie' }, pending: { firstContent: LIST_FIRST } },
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
  ];
  for (const { screen: name, open } of ON_DEMAND) {
    test(`${name} : contenu ouvert a la demande`, async ({ page }) => {
      const screen = SCREENS.find((entry) => entry.name === name)!;
      const incidents = await openScreen(page, screen.path);
      await settledMeasures(page, screen);
      await open(page);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, `${name} : document de ${width} px une fois ouvert, pour ${VIEWPORT.width} px`).toBeLessThanOrEqual(VIEWPORT.width);
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
