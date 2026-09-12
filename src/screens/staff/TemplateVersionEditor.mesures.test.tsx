// @vitest-environment jsdom
// UX-14(d) — réactivité MESURÉE sur la fixture de référence : 216 variables et 24 règles.
//
// Ce que ce fichier fait, et ne fait pas. Il mesure le coût de rendu et de réconciliation des
// interactions nommées par la spécification — ouverture d'un bloc, recherche, filtrage,
// ouverture du panneau, navigation, enregistrement et mise à jour de la liste — dans jsdom.
// Ce n'est PAS la mesure navigateur demandée par UX-0 : jsdom ne peint pas, ne met pas en page
// et ne connaît ni 1440 px ni 390 px. Le seuil de 200 ms d'UX-0 ne peut donc pas être prononcé
// ici ; ce qui est vérifié, c'est qu'aucune interaction ne s'effondre, et surtout qu'une petite
// modification ne remet pas tout l'écran en chargement.
//
// Les durées sont imprimées (`--reporter=verbose`) pour être reportées au journal. Le plafond
// assertif est volontairement large : sur une machine chargée, un seuil serré ferait un test
// instable, et un test instable finit par être ignoré.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { TemplateRepository } from '../../data/templates';
import type { TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../../data/types';
import { TemplateVersionEditor } from './TemplateVersionEditor';

/** Plafond d'alerte, pas un objectif : il attrape un effondrement, pas une lenteur de 50 ms. */
const PLAFOND_MS = 8_000;
const SECTIONS_FIXTURE = ['clinique', 'biologie', 'imagerie', 'traitement', 'evolution', 'social'];

const version: TemplateVersion = { id: 'version-216', templateId: 'template-1', versionNumber: 1, status: 'draft' };

const sections: TemplateSection[] = SECTIONS_FIXTURE.map((sectionKey, index) => ({
  id: `section-${index}`, sectionKey, label: sectionKey[0].toUpperCase() + sectionKey.slice(1), displayOrder: index,
}));

/** 216 variables réparties sur six blocs, comme le modèle de référence du porteur. */
const fields: TemplateField[] = Array.from({ length: 216 }, (_, index) => ({
  id: `field-${index}`,
  fieldKey: `variable_${index}`,
  label: `Variable fictive ${index}`,
  scope: index % 3 === 0 ? 'patient' : 'encounter',
  section: SECTIONS_FIXTURE[index % SECTIONS_FIXTURE.length],
  type: index % 5 === 0 ? 'number' : 'text',
  unit: null,
  allowedValues: null,
  required: index % 7 === 0,
  minValue: null,
  maxValue: null,
  allowMissingCodes: false,
  displayOrder: index,
}));

/** 24 règles conditionnelles entre variables voisines. */
const rules: ValidationRule[] = Array.from({ length: 24 }, (_, index) => ({
  id: `rule-${index}`,
  severity: 'block',
  message: null,
  rule: {
    if: { field: `variable_${index}`, operator: 'equals', value: 'oui' },
    then: { field: `variable_${index + 1}`, operator: 'required' },
  },
}));

function makeRepository() {
  let current = [...fields];
  const updateField = vi.fn(async (id: string, next: Parameters<TemplateRepository['updateField']>[1]) => {
    current = current.map((field) => (field.id === id ? { ...field, ...next, id } : field));
    return current.find((field) => field.id === id)!;
  });
  const repo = {
    getVersion: vi.fn(async () => ({ version, fields: [...current], rules, sections })),
    updateField,
  } as unknown as TemplateRepository;
  return { repo, updateField };
}

/**
 * Mesure une interaction. Volontairement SANS `act` autour : `fireEvent` et `waitFor` posent
 * déjà le leur, et un `act` supplémentaire qui enveloppe un `waitFor` empêche la file de rendu
 * d'avancer — l'écriture reste alors bloquée sur « Enregistrement en cours… », et la mesure ne
 * mesure plus que son propre délai d'attente.
 */
async function mesure(nom: string, releve: Record<string, number>, action: () => void | Promise<void>) {
  const debut = performance.now();
  await action();
  releve[nom] = Math.round(performance.now() - debut);
}

describe('TemplateVersionEditor — réactivité mesurée sur 216/24 (UX-14(d))', () => {
  test('les interactions nommées par la spécification restent tenables, et enregistrer ne remet pas l\'écran en chargement', async () => {
    const releve: Record<string, number> = {};
    const { repo, updateField } = makeRepository();

    const debutRendu = performance.now();
    render(
      <I18nProvider>
        <RepositoryProvider templates={repo}>
          <TemplateVersionEditor versionId={version.id} templateName="Modèle de référence" onBack={() => {}} />
        </RepositoryProvider>
      </I18nProvider>,
    );
    await screen.findByRole('heading', { name: 'Modèle de référence' });
    releve['rendu initial (216 variables, blocs repliés)'] = Math.round(performance.now() - debutRendu);

    // L'écran s'ouvre sur UNE section, pas sur 216 lignes : le premier rendu ne paie que le
    // sommaire et le premier bloc, et c'est ce que cette mesure doit montrer.
    expect(screen.getByText('36 variables affichées sur 216')).toBeInTheDocument();

    const sommaire = within(screen.getByRole('navigation', { name: 'Sommaire du formulaire' }));
    await mesure('ouverture d’un bloc (36 variables)', releve, () => {
      fireEvent.click(sommaire.getByRole('button', { name: 'Biologie · 36 variable(s)' }));
    });
    // La sous-vue « Toutes les variables » est le pire cas de rendu : 216 lignes d'un coup.
    await mesure('sous-vue « Toutes les variables » (216 lignes)', releve, () => {
      fireEvent.click(sommaire.getByRole('button', { name: /^Toutes les variables/ }));
    });
    expect(screen.getByText('216 variables affichées sur 216')).toBeInTheDocument();

    const recherche = screen.getByRole('searchbox', { name: 'Rechercher une variable' });
    recherche.focus(); // comme une frappe réelle : le champ a le focus avant de recevoir le texte
    await mesure('recherche (un terme, 216 variables parcourues)', releve, () => {
      fireEvent.change(recherche, { target: { value: 'variable_21' } });
    });
    // La recherche garde le focus : une frappe ne doit jamais rendre la saisie à l'écran.
    expect(recherche).toHaveFocus();
    // Les panneaux inactifs restent montés (aucune saisie perdue) : le libellé apparaît aussi
    // dans les `<option>` du filtre de l'espace Règles. On lit donc la liste, pas la page.
    expect(within(document.getElementById('editor-panel-structure') as HTMLElement)
      .getByText('Variable fictive 210')).toBeInTheDocument();

    await mesure('filtrage par section', releve, () => {
      fireEvent.change(recherche, { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('Filtrer par section'), { target: { value: 'biologie' } });
    });
    expect(screen.getByText('36 variables affichées sur 216')).toBeInTheDocument();

    await mesure('ouverture du panneau de variable', releve, () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Modifier la variable · / })[0]);
    });
    const panneau = await screen.findByRole('dialog');
    expect(within(panneau).getByLabelText('Libellé')).toHaveValue('Variable fictive 1');

    await mesure('navigation vers la variable suivante', releve, async () => {
      fireEvent.click(within(panneau).getByRole('button', { name: 'Variable suivante' }));
      await waitFor(() => expect(within(panneau).getByLabelText('Libellé')).toHaveValue('Variable fictive 7'));
    });

    // Enregistrement puis mise à jour de la liste : c'est LA mesure qui compte, parce que
    // c'est celle où l'écran pourrait repartir d'un chargement complet.
    fireEvent.change(within(panneau).getByLabelText('Libellé'), { target: { value: 'Variable fictive 7 corrigée' } });
    await mesure('enregistrement et mise à jour de la liste', releve, async () => {
      fireEvent.click(within(panneau).getByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => expect(updateField).toHaveBeenCalled());
      // La liste elle-même doit porter la correction : sans cette attente, on mesurerait
      // l'accusé du dépôt, pas ce que la personne voit.
      await waitFor(() => expect(screen.getAllByText('Variable fictive 7 corrigée').length).toBeGreaterThan(0),
        { timeout: 10_000 });
    });

    // §6.3 : « Éviter qu'une petite modification remette tout l'écran en chargement. »
    // La liste reste affichée pendant la relecture ; seul le tout premier chargement montre
    // le squelette. C'est une garantie structurelle : elle ne dépend d'aucune machine.
    expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Rechercher une variable' })).toBeInTheDocument();
    expect(screen.getByText('36 variables affichées sur 216')).toBeInTheDocument();

    // Relevé imprimé pour être reporté au journal, avec sa limite : jsdom, pas un navigateur.
    console.log('UX-14(d) — relevé jsdom sur 216 variables / 24 règles (ms) :', releve);
    for (const [interaction, duree] of Object.entries(releve)) {
      expect(duree, `${interaction} : ${duree} ms`).toBeLessThan(PLAFOND_MS);
    }
  }, 120_000);
});
