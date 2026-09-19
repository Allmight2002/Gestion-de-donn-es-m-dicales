#!/usr/bin/env node
// PAP-0 — mesure de la BASELINE papier des formulaires MedData.
//
// CE QUE CE SCRIPT MESURE. L'etat reel d'aujourd'hui : MedData n'a ni action « Imprimer le
// formulaire », ni CSS d'impression, ni page A4. La seule maniere d'obtenir un formulaire
// vierge sur papier est d'imprimer l'ecran d'apercu depuis le navigateur. Le script ouvre donc
// le banc `paper-baseline-harness.html`, qui monte le VRAI `FormPreview` sur les trois cas
// fictifs de `src/test/fixtures/paperForms.ts`, puis :
//
//   1. deplie tout ce que l'utilisateur peut deplier (« un bloc a la fois » decoche, « tout
//      deplier » clique) — sinon l'impression ne contiendrait qu'un seul bloc ;
//   2. imprime en PDF A4 par Chromium et COMPTE LES PAGES du fichier produit ;
//   3. releve dans le DOM, en media `print` et a la largeur utile d'une page A4, ce que la
//      fiche de baseline demande : hauteur occupee, pages presque vides, titres orphelins,
//      coupures ambigues, zones d'ecriture, listes perdues et consignes ;
//   4. mesure separement le COUT DU CONTENU : la hauteur qu'occupent les memes libelles,
//      consignes, cases et zones d'ecriture, sans aucun decor applicatif.
//
// CE QUE CE SCRIPT N'EST PAS. L'instrument du point 4 n'est pas le modele de placement de
// PAP-1 : il ne gere ni saut de page, ni titre orphelin, ni compatibilite entre champs. Il
// sert uniquement a separer ce qui coute au contenu de ce qui coute a la mise en page.
//
// Donnees fictives uniquement ; aucune ecriture, aucun reseau hors du serveur de
// developpement local.
//
// Usage :
//   npm run dev            # dans un autre terminal, ou laisser le script le demarrer
//   node scripts/paper-baseline.mjs [--out docs/pap-0-baseline-releves.json] [--pdf-dir <rep>]

// Le corps de `measure()` est envoye a Chromium par `page.evaluate` : il s'execute DANS LA
// PAGE, pas dans Node. Les globals du navigateur y sont donc legitimes.
/* global document, window, HTMLInputElement */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- Parametres d'impression, fixes et documentes ---------------------------------------
// A4 portrait, marges de 10 mm sur les quatre cotes, echelle 100 %. Ce sont les parametres
// « recommandes » de la specification ; les changer change la baseline, ils sont donc
// reproduits a l'identique dans la fiche de mesure.
const PAGE = { widthMm: 210, heightMm: 297, marginMm: 10, scale: 1 };
const PX_PER_MM = 96 / 25.4;
const USABLE_W_PX = Math.round((PAGE.widthMm - 2 * PAGE.marginMm) * PX_PER_MM);
const USABLE_H_PX = Math.round((PAGE.heightMm - 2 * PAGE.marginMm) * PX_PER_MM);

/** Une page dont le contenu occupe moins de ce taux est comptee « presque vide ». */
const NEARLY_EMPTY_RATIO = 0.3;
/** Un titre dont le bas tombe a moins de cette distance du bas de page est « en bord de page ». */
const ORPHAN_MARGIN_MM = 20;
/**
 * Hauteur d'une ligne manuscrite retenue pour la mesure du cout du contenu. Valeur de
 * travail, volontairement BASSE : elle donne une borne basse du nombre de pages. Le seuil de
 * lisibilite reellement retenu est discute dans la fiche de baseline et devra etre confirme
 * par le remplissage etudiant de PAP-4.
 */
const WRITING_LINE_MM = 8;

const CASES = ['court', 'moyen', 'volumineux'];
const SCOPES = [
  { key: 'patient', tab: 'Fiche patient' },
  { key: 'rencontre', tab: 'Rencontre' },
];

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BASE_URL = process.env.PAPER_BASELINE_URL ?? 'http://127.0.0.1:5173';
const OUT_JSON = resolve(ROOT, argValue('--out', 'docs/pap-0-baseline-releves.json'));
const PDF_DIR = resolve(ROOT, argValue('--pdf-dir', 'test-results/pap-0-baseline'));
/** `--cas court,moyen` limite la campagne ; sans lui, les trois cas sont mesures. */
const SELECTED = argValue('--cas', CASES.join(',')).split(',').map((value) => value.trim()).filter(Boolean);
for (const key of SELECTED) if (!CASES.includes(key)) throw new Error(`Cas inconnu : ${key}`);

async function serverAlive(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function startDevServer() {
  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
    cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32',
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await serverAlive(BASE_URL)) return child;
    await new Promise((done) => setTimeout(done, 1000));
  }
  child.kill();
  throw new Error(`Le serveur de developpement n'a pas repondu sur ${BASE_URL}.`);
}

/**
 * Nombre de pages d'un PDF Chromium. Deux lectures independantes : le `/Count` de l'arbre de
 * pages et le nombre d'objets `/Type /Page`. Un desaccord signale un PDF que l'on ne sait pas
 * lire, et vaut mieux qu'un chiffre invente.
 */
function pdfPageCount(buffer) {
  const text = buffer.toString('latin1');
  const counts = [...text.matchAll(/\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  const objects = [...text.matchAll(/\/Type\s*\/Page(?![s])/g)].length;
  const declared = counts.length > 0 ? Math.max(...counts) : null;
  if (declared !== null && objects > 0 && declared !== objects) {
    throw new Error(`Nombre de pages ambigu dans le PDF : /Count=${declared}, objets=${objects}.`);
  }
  const pages = declared ?? objects;
  if (!pages) throw new Error('Nombre de pages introuvable dans le PDF produit.');
  return pages;
}

const round = (value, digits = 1) => Number(value.toFixed(digits));

async function measure(page, scopeKey) {
  return page.evaluate(([usableH, usableW, pxPerMm, nearlyEmptyRatio, orphanMarginMm, writingLineMm, scope]) => {
    const root = document.querySelector('[data-paper-case]');
    const summary = window.__PAPER_BASELINE_CASE__;
    const docHeight = document.documentElement.scrollHeight;
    const pages = Math.max(1, Math.ceil(docHeight / usableH));
    const toMm = (px) => px / pxPerMm;
    const absolute = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, height: rect.height, width: rect.width };
    };

    // --- Contenu rendu ------------------------------------------------------------------
    const frames = [...root.querySelectorAll('[data-field-key]')];
    const legends = [...root.querySelectorAll('legend')];

    const fieldsByKey = new Map(summary.fields.map((item) => [item.fieldKey, item]));
    const rendered = frames.map((frame) => {
      const box = absolute(frame);
      const key = frame.dataset.fieldKey;
      const definition = fieldsByKey.get(key) ?? null;
      const controls = [...frame.querySelectorAll('input, select, textarea, [role="combobox"], output')];
      const writable = controls.filter((control) => !(control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox')));
      const choiceBoxes = controls.filter((control) => control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox'));
      const controlHeights = writable.map((control) => control.getBoundingClientRect().height);
      const controlWidths = writable.map((control) => control.getBoundingClientRect().width);
      return {
        fieldKey: key,
        type: definition?.type ?? null,
        calculated: definition?.calculated ?? false,
        optionCount: definition?.options.length ?? 0,
        // Deux controles ou plus pour une seule question : la raison de valeur manquante
        // ajoute son propre menu sous le champ.
        controlCount: writable.length,
        visibleChoices: choiceBoxes.length,
        hasDescription: Boolean(definition?.description),
        descriptionPrinted: frame.textContent?.includes(definition?.description ?? ' ') ?? false,
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        controlHeight: controlHeights.length ? Math.max(...controlHeights) : 0,
        controlWidth: controlWidths.length ? Math.max(...controlWidths) : 0,
      };
    });

    // --- Couverture verticale : contenu, decor applicatif, reste -------------------------
    const merge = (intervals) => {
      const sorted = intervals.filter((i) => i.bottom > i.top).sort((a, b) => a.top - b.top);
      const merged = [];
      for (const interval of sorted) {
        const last = merged[merged.length - 1];
        if (last && interval.top <= last.bottom) last.bottom = Math.max(last.bottom, interval.bottom);
        else merged.push({ top: interval.top, bottom: interval.bottom });
      }
      return merged;
    };
    const contentIntervals = merge([
      ...rendered.map((item) => ({ top: item.top, bottom: item.bottom })),
      ...legends.map((legend) => absolute(legend)).map((box) => ({ top: box.top, bottom: box.bottom })),
    ]);
    // Decor de l'ecran applicatif : bandeaux, onglets, sommaire, boutons de parcours. Ce sont
    // des elements que le papier n'a aucune raison de porter.
    const chromeNodes = [
      ...root.querySelectorAll('[role="status"], [role="tablist"], [role="alert"], nav[aria-label]'),
      ...[...root.querySelectorAll('button')].filter((button) => !button.closest('legend') && !button.closest('[data-field-key]')),
    ];
    const chromeIntervals = merge(chromeNodes.map((node) => absolute(node)).map((box) => ({ top: box.top, bottom: box.bottom })));
    const span = (intervals, from, to) => intervals.reduce(
      (total, interval) => total + Math.max(0, Math.min(interval.bottom, to) - Math.max(interval.top, from)), 0,
    );

    const perPage = [];
    for (let index = 0; index < pages; index += 1) {
      const from = index * usableH;
      const to = from + usableH;
      const content = span(contentIntervals, from, to);
      const chrome = span(chromeIntervals, from, to);
      perPage.push({
        page: index + 1,
        contentMm: content / pxPerMm,
        chromeMm: chrome / pxPerMm,
        fillRatio: content / usableH,
        nearlyEmpty: content / usableH < nearlyEmptyRatio,
      });
    }

    // --- Coupures ambigues et titres orphelins -------------------------------------------
    const boundaries = Array.from({ length: pages - 1 }, (_, index) => (index + 1) * usableH);
    const splitFields = rendered
      .filter((item) => boundaries.some((boundary) => item.top < boundary && item.bottom > boundary))
      .map((item) => item.fieldKey);

    const orphanTitles = [];
    for (const legend of legends) {
      const box = absolute(legend);
      const fieldset = legend.closest('fieldset');
      const firstField = fieldset?.querySelector('[data-field-key]');
      const firstTop = firstField ? absolute(firstField).top : null;
      const legendPage = Math.floor(box.top / usableH);
      const distanceToBreakMm = ((legendPage + 1) * usableH - box.bottom) / pxPerMm;
      const separated = firstTop !== null && Math.floor(firstTop / usableH) > legendPage;
      if (separated || distanceToBreakMm < orphanMarginMm) {
        // Le libelle seul, sans le compteur « n requis restant(s) » que l'ecran y accroche.
        const titleNode = legend.querySelector('[id$="-title"]');
        orphanTitles.push({
          title: (titleNode ?? legend).textContent?.trim().replace(/^[▾▸]\s*/, '').slice(0, 80) ?? '',
          separatedFromFirstField: separated,
          distanceToBreakMm: Number(distanceToBreakMm.toFixed(1)),
        });
      }
    }

    // --- Zones d'ecriture et listes ------------------------------------------------------
    const writingLinePx = writingLineMm * pxPerMm;
    const answerable = rendered.filter((item) => !item.calculated && item.controlHeight > 0);
    const tooSmall = answerable.filter((item) => item.controlHeight < writingLinePx).map((item) => item.fieldKey);
    const textFields = rendered.filter((item) => item.type === 'text' && !item.calculated);
    const choiceFields = rendered.filter((item) => item.type === 'select' || item.type === 'multiselect');
    const lostChoices = choiceFields
      .filter((item) => item.optionCount > 0 && item.visibleChoices === 0)
      .map((item) => ({ fieldKey: item.fieldKey, optionCount: item.optionCount }));
    const printedChoices = choiceFields
      .filter((item) => item.visibleChoices > 0)
      .map((item) => ({ fieldKey: item.fieldKey, optionCount: item.optionCount, visible: item.visibleChoices }));

    // --- Consignes ------------------------------------------------------------------------
    const scopeFields = summary.fields.filter((item) => (scope === 'patient' ? item.scope === 'patient' : item.scope === 'encounter'));
    // Une variable « valeur proposee » est rendue DANS sa variable source : elle n'a pas de
    // cadre propre, mais elle est bien imprimee. La compter comme absente serait faux.
    const companionKeys = [...root.querySelectorAll('[data-proposal-key]')].map((node) => node.dataset.proposalKey);
    const withDescription = scopeFields.filter((item) => item.description);
    const descriptionsPrinted = rendered.filter((item) => item.hasDescription && item.descriptionPrinted).length;

    // --- Cout du CONTENU seul -------------------------------------------------------------
    // Un gabarit hors flux, a la largeur utile d'une page, avec la meme police : on mesure la
    // hauteur reelle du texte et des zones d'ecriture, sans decor, sans espacement, sans
    // cadre. C'est une BORNE BASSE, pas une proposition de mise en page.
    const bench = document.createElement('div');
    bench.setAttribute('data-paper-bench', '');
    bench.style.cssText = `position:absolute;left:-10000px;top:0;width:${usableW}px;font-size:14px;line-height:1.35;`;
    document.body.appendChild(bench);
    const measureBlock = (html, widthPx) => {
      const holder = document.createElement('div');
      holder.style.cssText = `width:${widthPx}px;`;
      holder.innerHTML = html;
      bench.appendChild(holder);
      const height = holder.getBoundingClientRect().height;
      bench.removeChild(holder);
      return height;
    };
    const escape = (value) => String(value ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const shortTypes = new Set(['number', 'integer', 'date', 'datetime', 'boolean', 'terminology']);
    const contentHeightOf = (item, widthPx) => {
      const unit = item.unit ? ` (${escape(item.unit)})` : '';
      const required = item.required ? ' *' : '';
      let html = `<div>${escape(item.label)}${unit}${required}</div>`;
      if (item.description) html += `<div style="font-size:12px">${escape(item.description)}</div>`;
      if (item.calculated) html += '<div style="font-size:12px">Calcule</div>';
      else if (item.type === 'boolean') html += '<div>☐ Oui ☐ Non</div>';
      else if (item.options.length > 0) html += `<div>${item.options.map((option) => `☐ ${escape(option)}`).join(' &nbsp; ')}</div>`;
      else html += `<div style="height:${writingLinePx}px"></div>`;
      return measureBlock(html, widthPx);
    };
    const sectionTitleHeight = (label, widthPx) => measureBlock(`<div style="font-weight:600">${escape(label)}</div>`, widthPx);

    const sectionsOfScope = summary.sections.filter((section) => scopeFields.some((item) => item.section === section.sectionKey));
    let titlesHeight = 0;
    for (const section of sectionsOfScope) titlesHeight += sectionTitleHeight(section.label, usableW);

    let fullWidthHeight = titlesHeight;
    for (const item of scopeFields) fullWidthHeight += contentHeightOf(item, usableW);

    // Borne « deux colonnes » : les reponses courtes partagent une ligne, comme le prevoit la
    // grille de 12 unites de la specification. Les reponses ouvertes gardent la pleine largeur.
    const halfWidth = Math.floor((usableW - 16) / 2);
    let twoColumnHeight = titlesHeight;
    let pending = null;
    for (const item of scopeFields) {
      const short = shortTypes.has(item.type) || item.calculated || (item.options.length > 0 && item.options.length <= 3);
      if (!short) {
        if (pending !== null) { twoColumnHeight += pending; pending = null; }
        twoColumnHeight += contentHeightOf(item, usableW);
        continue;
      }
      const height = contentHeightOf(item, halfWidth);
      if (pending === null) pending = height;
      else { twoColumnHeight += Math.max(pending, height); pending = null; }
    }
    if (pending !== null) twoColumnHeight += pending;
    document.body.removeChild(bench);

    return {
      scope,
      documentHeightMm: toMm(docHeight),
      derivedPages: pages,
      usableHeightMm: toMm(usableH),
      renderedFields: rendered.length,
      expectedFields: scopeFields.length,
      companionFields: companionKeys,
      missingFields: scopeFields
        .filter((item) => !rendered.some((entry) => entry.fieldKey === item.fieldKey) && !companionKeys.includes(item.fieldKey))
        .map((item) => item.fieldKey),
      perPage,
      contentMm: toMm(contentIntervals.reduce((total, interval) => total + interval.bottom - interval.top, 0)),
      chromeMm: toMm(chromeIntervals.reduce((total, interval) => total + interval.bottom - interval.top, 0)),
      splitFields,
      orphanTitles,
      writing: {
        answerable: answerable.length,
        tooSmall,
        medianControlHeightMm: answerable.length
          ? toMm([...answerable.map((item) => item.controlHeight)].sort((a, b) => a - b)[Math.floor(answerable.length / 2)])
          : 0,
        // Largeur reellement offerte a la reponse : c'est elle qui montre qu'une date occupe
        // la meme place qu'un paragraphe.
        medianControlWidthMm: answerable.length
          ? toMm([...answerable.map((item) => item.controlWidth)].sort((a, b) => a - b)[Math.floor(answerable.length / 2)])
          : 0,
        textFields: textFields.length,
        medianTextControlHeightMm: textFields.length
          ? toMm([...textFields.map((item) => item.controlHeight)].sort((a, b) => a - b)[Math.floor(textFields.length / 2)])
          : 0,
      },
      choices: { lostChoices, printedChoices },
      // Une case seule, sans « Oui / Non » imprime a cote, ne distingue pas « non » de
      // « pas renseigne » une fois sur le papier.
      lonelyCheckboxes: rendered.filter((item) => item.type === 'boolean').length,
      // Questions dont la reponse demande deux controles a l'ecran (valeur + raison).
      twoControlFields: rendered.filter((item) => item.controlCount > 1).length,
      descriptions: {
        declared: withDescription.length,
        printed: descriptionsPrinted,
      },
      contentCost: {
        fullWidthMm: toMm(fullWidthHeight),
        fullWidthPages: Math.max(1, Math.ceil(fullWidthHeight / usableH)),
        twoColumnMm: toMm(twoColumnHeight),
        twoColumnPages: Math.max(1, Math.ceil(twoColumnHeight / usableH)),
      },
    };
  }, [USABLE_H_PX, USABLE_W_PX, PX_PER_MM, NEARLY_EMPTY_RATIO, ORPHAN_MARGIN_MM, WRITING_LINE_MM, scopeKey]);
}

async function run() {
  const started = await serverAlive(BASE_URL) ? null : await startDevServer();
  await mkdir(PDF_DIR, { recursive: true });
  await mkdir(dirname(OUT_JSON), { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: USABLE_W_PX, height: USABLE_H_PX } });
    const page = await context.newPage();
    for (const caseKey of SELECTED) {
      for (const scope of SCOPES) {
        await page.goto(`${BASE_URL}/paper-baseline-harness.html?cas=${caseKey}`, { waitUntil: 'load' });
        await page.waitForSelector(`[data-paper-case="${caseKey}"]`, { timeout: 60_000 });
        await page.getByRole('tab', { name: scope.tab }).click();
        // Sans ces deux gestes, l'impression ne contiendrait qu'UN bloc : c'est le meilleur
        // etat que l'utilisateur peut obtenir aujourd'hui, et donc la baseline honnete.
        const single = page.getByRole('checkbox', { name: 'Un bloc à la fois' });
        if (await single.count() > 0 && await single.isChecked()) await single.uncheck();
        const expand = page.getByRole('button', { name: 'Tout déplier' });
        if (await expand.count() > 0) await expand.click();
        await page.evaluate(() => {
          for (const node of document.querySelectorAll('[data-harness-chrome]')) node.remove();
        });
        await page.emulateMedia({ media: 'print' });
        await page.waitForTimeout(250);

        const measured = await measure(page, scope.key);
        const pdfPath = join(PDF_DIR, `pap0-${caseKey}-${scope.key}.pdf`);
        const pdf = await page.pdf({
          path: pdfPath,
          format: 'A4',
          printBackground: true,
          scale: PAGE.scale,
          margin: {
            top: `${PAGE.marginMm}mm`, bottom: `${PAGE.marginMm}mm`,
            left: `${PAGE.marginMm}mm`, right: `${PAGE.marginMm}mm`,
          },
        });
        await page.emulateMedia({ media: null });
        const pdfPages = pdfPageCount(pdf);
        results.push({
          case: caseKey,
          scope: scope.key,
          pdfPages,
          // Chemin relatif a la racine du depot, en separateurs `/` : le releve doit se relire
          // a l'identique quelle que soit la plateforme.
          pdfPath: pdfPath.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '').replaceAll('\\', '/'),
          ...measured,
          perPage: measured.perPage.map((entry) => ({
            ...entry,
            contentMm: round(entry.contentMm),
            chromeMm: round(entry.chromeMm),
            fillRatio: round(entry.fillRatio, 3),
          })),
          documentHeightMm: round(measured.documentHeightMm),
          contentMm: round(measured.contentMm),
          chromeMm: round(measured.chromeMm),
          usableHeightMm: round(measured.usableHeightMm),
          writing: {
            ...measured.writing,
            medianControlHeightMm: round(measured.writing.medianControlHeightMm),
            medianControlWidthMm: round(measured.writing.medianControlWidthMm),
            medianTextControlHeightMm: round(measured.writing.medianTextControlHeightMm),
          },
          contentCost: {
            fullWidthMm: round(measured.contentCost.fullWidthMm),
            fullWidthPages: measured.contentCost.fullWidthPages,
            twoColumnMm: round(measured.contentCost.twoColumnMm),
            twoColumnPages: measured.contentCost.twoColumnPages,
          },
        });
        const last = results[results.length - 1];
        process.stdout.write(
          `${caseKey.padEnd(11)} ${scope.key.padEnd(9)} PDF ${String(last.pdfPages).padStart(3)} p.  `
          + `derive ${String(last.derivedPages).padStart(3)} p.  `
          + `champs ${last.renderedFields + last.companionFields.length}/${last.expectedFields}  `
          + `presque vides ${last.perPage.filter((entry) => entry.nearlyEmpty).length}  `
          + `contenu ${last.contentCost.fullWidthPages}/${last.contentCost.twoColumnPages} p.\n`,
        );
      }
    }
  } finally {
    await browser.close();
    if (started) started.kill();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    page: PAGE,
    usable: { widthPx: USABLE_W_PX, heightPx: USABLE_H_PX, widthMm: PAGE.widthMm - 2 * PAGE.marginMm, heightMm: PAGE.heightMm - 2 * PAGE.marginMm },
    thresholds: { nearlyEmptyRatio: NEARLY_EMPTY_RATIO, orphanMarginMm: ORPHAN_MARGIN_MM, writingLineMm: WRITING_LINE_MM },
    results,
  };
  await writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nReleves ecrits dans ${OUT_JSON}\nPDF de controle dans ${PDF_DIR}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
