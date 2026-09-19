// PAP-0 — banc de MESURE de l'impression actuelle d'un formulaire.
//
// POURQUOI CE BANC. MedData n'a aujourd'hui aucune action « Imprimer le formulaire », aucun
// CSS d'impression et aucune page A4 : la seule facon d'obtenir un formulaire vierge sur
// papier est d'imprimer l'ecran d'apercu depuis le navigateur. C'est donc CET etat qui est la
// baseline de la campagne papier, et ce banc le rend reproductible : il monte le VRAI
// `FormPreview`, avec le vrai i18n et les vrais composants de saisie, sur les trois cas
// fictifs de `src/test/fixtures/paperForms.ts`.
//
// CE BANC NE FAIT PAS DE MISE EN PAGE. Il n'ajoute ni page A4, ni regle de saut, ni style
// d'impression : ajouter l'un d'eux fabriquerait la baseline au lieu de la mesurer. Le
// formulaire papier lui-meme reste a construire par PAP-1 et PAP-2.
//
// Aucune donnee reelle, aucun reseau, aucune ecriture : les fixtures sont fictives et
// `FormPreview` n'appelle aucun depot en ecriture. Ce fichier n'est atteignable que par
// `paper-baseline-harness.html`, servie par le serveur de developpement ; le build de
// production n'a qu'une entree (`index.html`) et ne l'embarque pas.

import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n/I18nProvider';
import { FormPreview } from '../screens/staff/FormPreview';
import { fieldOptions } from '../domain/fieldOptions';
import { PAPER_FORM_CASES, paperFormCase, type PaperFormCaseKey } from '../test/fixtures/paperForms';
import { initTheme } from '../lib/theme';
import '../index.css';

initTheme();

const KEYS = PAPER_FORM_CASES.map((entry) => entry.key);

function requestedCase(): PaperFormCaseKey {
  const asked = new URLSearchParams(window.location.search).get('cas');
  return (KEYS as string[]).includes(asked ?? '') ? (asked as PaperFormCaseKey) : 'court';
}

/**
 * Resume du cas expose au script de mesure. Il evite au script de recopier la fixture : la
 * mesure et le rendu parlent donc toujours du meme contenu. Aucune valeur, aucune reponse.
 */
function publishCase(key: PaperFormCaseKey): void {
  const entry = paperFormCase(key);
  (window as unknown as Record<string, unknown>).__PAPER_BASELINE_CASE__ = {
    key: entry.key,
    label: entry.label,
    fieldCount: entry.fields.length,
    sectionCount: entry.sections.length,
    ruleCount: entry.rules.length,
    sections: entry.sections.map((section) => ({
      sectionKey: section.sectionKey,
      label: section.label,
      parentSectionKey: section.parentSectionKey ?? null,
    })),
    fields: entry.fields.map((item) => ({
      fieldKey: item.fieldKey,
      label: item.label,
      description: item.description ?? null,
      type: item.type,
      unit: item.unit,
      required: item.required,
      scope: item.scope,
      section: item.section,
      calculated: Boolean(item.formula),
      options: fieldOptions(item).map((option) => option.label),
    })),
  };
}

function Harness() {
  const key = useMemo(requestedCase, []);
  const entry = useMemo(() => paperFormCase(key), [key]);
  useMemo(() => publishCase(key), [key]);
  return (
    <I18nProvider>
      {/* `data-paper-case` sert de point d'ancrage au script de mesure : il attend que le cas
          demande soit reellement monte avant d'imprimer. */}
      <div data-paper-case={entry.key} data-paper-fields={entry.fields.length} className="mx-auto max-w-[1400px] p-4 sm:p-6">
        {/* Bandeau PROPRE AU BANC : le script de mesure le masque avant d'imprimer, sinon la
            baseline compterait une hauteur que le produit n'a pas. */}
        <p data-harness-chrome className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Banc de mesure PAP-0 — donnees ENTIEREMENT FICTIVES ({entry.label} :
          {' '}{entry.fields.length} variables, {entry.sections.length} sections,
          {' '}{entry.rules.length} regles). Aucun serveur, aucun dossier reel.
        </p>
        <FormPreview
          version={entry.version}
          fields={entry.fields}
          rules={entry.rules}
          sections={entry.sections}
          onClose={() => {}}
        />
      </div>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
