// Banc de VERIFICATION LOCALE de l'editeur des jeux de variables.
//
// Il monte le VRAI `TemplateVersionEditor`, avec le vrai i18n, les vrais composants de saisie
// et le vrai moteur de regles, sur la fixture fictive de 216 variables / 24 sections /
// 26 regles. Aucun acces reseau, aucun Supabase, aucune donnee reelle : le depot memoire de
// la fixture repond a la place du serveur.
//
// Ce fichier n'est atteignable que depuis `editor-harness.html`, servie par le serveur de
// developpement. Le build de production n'a qu'une seule entree (`index.html`) et ne
// l'embarque donc pas.

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n/I18nProvider';
import { RepositoryProvider } from '../data/RepositoryProvider';
import { TemplateVersionEditor } from '../screens/staff/TemplateVersionEditor';
import {
  EDITOR_REGISTRY_FIELD_COUNT,
  EDITOR_REGISTRY_RULE_COUNT,
  EDITOR_REGISTRY_SECTION_COUNT,
  createEditorRegistryRepository,
  editorRegistryVersion,
} from '../test/fixtures/editorRegistry';
import { initTheme } from '../lib/theme';
import '../index.css';

initTheme();

function Harness() {
  // Un seul depot pour toute la session : les ecritures de l'ecran (ordre, sections, regles)
  // restent visibles d'une relecture a l'autre, exactement comme face au serveur.
  const [repo] = useState(() => createEditorRegistryRepository());
  return (
    <I18nProvider>
      <RepositoryProvider templates={repo}>
        <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Banc de verification locale — donnees ENTIEREMENT FICTIVES
            ({EDITOR_REGISTRY_FIELD_COUNT} variables, {EDITOR_REGISTRY_SECTION_COUNT} sections,
            {' '}{EDITOR_REGISTRY_RULE_COUNT} regles). Aucun serveur, aucun dossier reel.
          </p>
          <TemplateVersionEditor
            versionId={editorRegistryVersion.id}
            templateName="Registre multipathologies (fictif)"
            onBack={() => {}}
          />
        </div>
      </RepositoryProvider>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
