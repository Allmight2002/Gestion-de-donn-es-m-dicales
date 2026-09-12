// @vitest-environment jsdom
//
// Critères d'acceptation de la refonte de l'éditeur des jeux de variables
// (docs/design/editeur-registre/README.md), joués sur la fixture fictive dimensionnante :
// 216 variables, 24 sections (8 blocs racines + 16 sous-sections) et 26 règles.
//
// Ce fichier ne teste PAS la structure exacte du JSX : il joue les parcours nommés par le
// dossier — atteindre une sous-section de fin de modèle, retrouver une variable dans un bloc
// fermé, conserver une saisie, remonter d'une section à ses règles, constater qu'une
// association diagnostique et l'index des règles désignent le même objet, et vérifier les
// combinaisons de diagnostics avec le moteur réel sans rien écrire.
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { TemplateRepository } from '../../data/templates';
import { validateRule } from '../../domain/templateRules';
import { TemplateVersionEditor } from './TemplateVersionEditor';
import {
  EDITOR_REGISTRY_FIELD_COUNT,
  EDITOR_REGISTRY_RULE_COUNT,
  EDITOR_REGISTRY_SECTION_COUNT,
  createEditorRegistryRepository,
  editorRegistryFields,
  editorRegistryRules,
  editorRegistrySections,
  editorRegistryVersion,
} from '../../test/fixtures/editorRegistry';

function renderEditor(repo: TemplateRepository = createEditorRegistryRepository()) {
  render(
    <I18nProvider>
      <RepositoryProvider templates={repo}>
        <TemplateVersionEditor
          versionId={editorRegistryVersion.id}
          templateName="Registre multipathologies"
          onBack={() => {}}
        />
      </RepositoryProvider>
    </I18nProvider>,
  );
  return screen.findByRole('heading', { name: 'Registre multipathologies' });
}

/**
 * Les quatre espaces restent MONTÉS pour ne perdre aucune saisie en changeant d'onglet ; les
 * panneaux inactifs portent `hidden`, que `getByText` ne respecte pas. Les lectures de liste
 * se font donc dans le panneau visé, jamais sur toute la page.
 */
const panneau = (espace: 'structure' | 'rules' | 'diagnosis' | 'preview') =>
  within(document.getElementById(`editor-panel-${espace}`) as HTMLElement);
const sommaire = () => within(screen.getByRole('navigation', { name: 'Sommaire du formulaire' }));
const rechercheVariable = () => screen.getByRole('searchbox', { name: 'Rechercher une variable' });

describe('Éditeur de registre — dimensionnement de la fixture', () => {
  test('216 variables, au moins 21 sections et au moins 26 règles, toutes lisibles par le moteur', () => {
    expect(editorRegistryFields).toHaveLength(EDITOR_REGISTRY_FIELD_COUNT);
    expect(EDITOR_REGISTRY_FIELD_COUNT).toBe(216);
    expect(editorRegistrySections.length).toBe(EDITOR_REGISTRY_SECTION_COUNT);
    expect(editorRegistrySections.length).toBeGreaterThanOrEqual(21);
    expect(editorRegistryRules.length).toBe(EDITOR_REGISTRY_RULE_COUNT);
    expect(editorRegistryRules.length).toBeGreaterThanOrEqual(26);

    // Une fixture dont les règles ne passent pas `validateRule` ferait afficher « règle non
    // présentable » partout : l'écran paraîtrait cassé et la vérification ne prouverait rien.
    const refusees = editorRegistryRules
      .map((regle) => ({ id: regle.id, verdict: validateRule(regle.rule) }))
      .filter((entree) => !entree.verdict.ok);
    expect(refusees).toEqual([]);

    // Le pilote diagnostique et les blocs qu'il couvre partagent la même portée : sans cela,
    // `diagnosticBlockRules` ne reconnaîtrait aucune association.
    const pilote = editorRegistryVersion.diagnosisContext?.[0];
    expect(pilote).toBeDefined();
    const blocsAssocies = ['bloc_01', 'bloc_04'];
    for (const bloc of blocsAssocies) {
      expect(editorRegistryFields.some((champ) => champ.section === bloc && champ.scope === pilote!.scope))
        .toBe(true);
    }
  });
});

describe('Éditeur de registre — structure du formulaire', () => {
  // Critère 1 du README.
  test('ouvre directement une sous-section de fin de modèle sans traverser les précédentes', async () => {
    await renderEditor();

    // L'écran s'ouvre sur une section, pas sur les 216 lignes.
    expect(panneau('structure').queryByText('Bloc 08 · Sous-section B · Variable 01')).not.toBeInTheDocument();

    const cible = sommaire().getByRole('button', { name: 'Bloc 08 · Sous-section B · 9 variable(s)' });
    fireEvent.click(cible);

    expect(cible).toHaveAttribute('aria-current', 'page');
    expect(panneau('structure').getByRole('heading', { name: 'Bloc 08 · Sous-section B' })).toBeInTheDocument();
    expect(panneau('structure').getByText('Bloc 08 · Sous-section B · Variable 01')).toBeInTheDocument();
    // Le chemin est affiché, et les variables des autres sections ne sont pas dans la page.
    expect(panneau('structure').getByText('Bloc 08 / Bloc 08 · Sous-section B')).toBeInTheDocument();
    expect(panneau('structure').queryByText('Bloc 01 · Variable directe 01')).not.toBeInTheDocument();
  });

  // Critère 2 du README.
  test('retrouve une variable d’un bloc fermé, montre son chemin, l’ouvre et revient au même résultat', async () => {
    await renderEditor();

    fireEvent.change(rechercheVariable(), { target: { value: 'bloc_07_a_variable_05' } });
    expect(screen.getByText('1 variables affichées sur 216')).toBeInTheDocument();

    const ligne = panneau('structure').getByText('Bloc 07 · Sous-section A · Variable 05')
      .closest('[role="row"]') as HTMLElement;
    // Un résultat porte son chemin : la recherche n'est pas limitée au bloc ouvert.
    expect(within(ligne).getByText('Bloc 07 / Bloc 07 · Sous-section A')).toBeInTheDocument();

    fireEvent.click(within(ligne).getByRole('button', { name: /^Modifier la variable · / }));
    const dialogue = await screen.findByRole('dialog', { name: 'Modifier la variable' });
    expect(within(dialogue).getByLabelText('Libellé')).toHaveValue('Bloc 07 · Sous-section A · Variable 05');

    fireEvent.click(within(dialogue).getByRole('button', { name: 'Fermer le panneau' }));
    // Le filtre et son résultat sont intacts au retour.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Modifier la variable' })).toBeNull());
    expect(rechercheVariable()).toHaveValue('bloc_07_a_variable_05');
    expect(screen.getByText('1 variables affichées sur 216')).toBeInTheDocument();
    expect(panneau('structure').getByText('Bloc 07 · Sous-section A · Variable 05')).toBeInTheDocument();
  });

  // Critère 3 du README : une saisie ne se perd jamais sans décision explicite.
  test('conserve une saisie non enregistrée quand on tente de changer de contexte', async () => {
    const repo = createEditorRegistryRepository();
    const updateField = vi.spyOn(repo, 'updateField');
    await renderEditor(repo);

    fireEvent.click(sommaire().getByRole('button', { name: 'Bloc 02 · 26 variable(s)' }));
    const ligne = panneau('structure').getByText('Bloc 02 · Variable directe 01')
      .closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(ligne).getByRole('button', { name: /^Modifier la variable · / }));

    const dialogue = await screen.findByRole('dialog', { name: 'Modifier la variable' });
    fireEvent.change(within(dialogue).getByLabelText('Libellé'), { target: { value: 'Libellé en cours de saisie' } });
    expect(within(dialogue).getByText('Modifications non enregistrées')).toBeInTheDocument();

    // Fermer demande confirmation ; annuler la fermeture garde tout.
    fireEvent.click(within(dialogue).getByRole('button', { name: 'Fermer le panneau' }));
    const garde = await screen.findByRole('dialog', { name: 'Quitter cette variable ?' });
    fireEvent.click(within(garde).getByRole('button', { name: 'Annuler' }));

    expect(within(panneau('structure').getByRole('dialog', { name: 'Modifier la variable' }))
      .getByLabelText('Libellé')).toHaveValue('Libellé en cours de saisie');
    expect(updateField).not.toHaveBeenCalled();
  });

  // Critère 3, second volet : un refus serveur conserve tous les inputs locaux.
  test('un refus d’enregistrement garde le panneau, ses valeurs et son motif', async () => {
    const repo = createEditorRegistryRepository();
    vi.spyOn(repo, 'updateField').mockRejectedValue(new Error('Version utilisée : modification refusée'));
    await renderEditor(repo);

    fireEvent.click(sommaire().getByRole('button', { name: 'Bloc 03 · 26 variable(s)' }));
    const ligne = panneau('structure').getByText('Bloc 03 · Variable directe 02')
      .closest('[role="row"]') as HTMLElement;
    fireEvent.click(within(ligne).getByRole('button', { name: /^Modifier la variable · / }));

    const dialogue = await screen.findByRole('dialog', { name: 'Modifier la variable' });
    fireEvent.change(within(dialogue).getByLabelText('Libellé'), { target: { value: 'Libellé refusé' } });
    fireEvent.click(within(dialogue).getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Version utilisée : modification refusée')).toBeInTheDocument();
    expect(within(dialogue).getByLabelText('Libellé')).toHaveValue('Libellé refusé');
    await waitFor(() => expect(within(dialogue).getByText('Échec de l’enregistrement')).toBeInTheDocument());
  });
});

describe('Éditeur de registre — règles', () => {
  // Critère 4 du README.
  test('depuis une section, retrouve sa condition de bloc et ses règles, puis revient à la section', async () => {
    await renderEditor();

    fireEvent.click(sommaire().getByRole('button', { name: 'Bloc 01 · 26 variable(s)' }));
    // La condition du bloc est résumée par le MOTEUR RÉEL, pas par un texte recopié.
    expect(panneau('structure').getByText(/Si Diagnostics contient au moins un de ces codes/))
      .toBeInTheDocument();
    expect(panneau('structure').getByText(/Bloc 01 est affichée/)).toBeInTheDocument();

    fireEvent.click(panneau('structure').getByRole('button', { name: 'Voir les règles de cette section' }));

    expect(screen.getByRole('tab', { name: /^Règles/ })).toHaveAttribute('aria-selected', 'true');
    expect(panneau('rules').getByText(/Règles liées à/)).toBeInTheDocument();
    // La règle de bloc est là, et elle n'est pas recopiée sur chaque variable du bloc.
    expect(document.getElementById('rule-rule-diagnosis-bloc-01')).toBeTruthy();

    fireEvent.click(panneau('rules').getByRole('button', { name: /Retour à la structure/ }));
    expect(screen.getByRole('tab', { name: /Structure du formulaire/ })).toHaveAttribute('aria-selected', 'true');
    expect(panneau('structure').getByRole('heading', { name: 'Bloc 01' })).toBeInTheDocument();
  });

  // Critère 5 du README : un seul objet règle, vu depuis deux écrans.
  test('l’association diagnostique et l’index des règles désignent la même règle', async () => {
    await renderEditor();

    fireEvent.click(screen.getByRole('tab', { name: 'Collecte diagnostique' }));
    const association = panneau('diagnosis').getByText('DX-AVC, DX-NEURO').closest('li') as HTMLElement;
    expect(within(association).getByText('Bloc 01')).toBeInTheDocument();

    fireEvent.click(within(association).getByRole('button', { name: 'Voir la règle d’activation' }));

    expect(screen.getByRole('tab', { name: /^Règles/ })).toHaveAttribute('aria-selected', 'true');
    // Le renvoi mène à CETTE règle, identifiée par son id de version.
    const regle = document.getElementById('rule-rule-diagnosis-bloc-01');
    expect(regle).toBeTruthy();
    expect(regle).toHaveTextContent(/DX-AVC/);
    expect(regle).toHaveTextContent(/Bloc 01 est affichée/);

    // Aucun doublon : le bloc 01 n'est conditionné que par UNE règle dans l'index.
    const conditionsBloc01 = panneau('rules').getAllByText(/Bloc 01 est affichée/);
    expect(conditionsBloc01).toHaveLength(1);

    // Et le retour explicite ramène à la collecte diagnostique.
    fireEvent.click(panneau('rules').getByRole('button', { name: /Retour à la collecte diagnostique/ }));
    expect(screen.getByRole('tab', { name: 'Collecte diagnostique' })).toHaveAttribute('aria-selected', 'true');
  });

  test('le formulaire de règle ne s’ouvre qu’à la demande, sous toute la liste', async () => {
    await renderEditor();

    fireEvent.click(screen.getByRole('tab', { name: /^Règles/ }));
    expect(screen.getByText('26 règle(s) affichée(s) sur 26')).toBeInTheDocument();
    expect(panneau('rules').queryByLabelText('Type de règle')).toBeNull();

    fireEvent.click(panneau('rules').getByRole('button', { name: 'Ajouter une règle' }));
    expect(panneau('rules').getByLabelText('Type de règle')).toBeInTheDocument();
  });
});

describe('Éditeur de registre — aperçu', () => {
  // Critère 7 du README : les combinaisons de diagnostics, avec le moteur réel, sans écriture.
  test('vérifie diagnostic couvert, multiple, non couvert et mixte, sans rien enregistrer', async () => {
    const repo = createEditorRegistryRepository();
    const ecritures = [
      vi.spyOn(repo, 'updateField'), vi.spyOn(repo, 'addField'), vi.spyOn(repo, 'deleteField'),
      vi.spyOn(repo, 'addRule'), vi.spyOn(repo, 'updateRule'), vi.spyOn(repo, 'deleteRule'),
      vi.spyOn(repo, 'reorderFields'),
    ];
    await renderEditor(repo);

    fireEvent.click(screen.getByRole('tab', { name: 'Aperçu' }));
    fireEvent.click(await panneau('preview').findByRole('tab', { name: /Fiche patient/ }));

    const scenario = within(panneau('preview').getByRole('group', { name: 'Aperçu selon les diagnostics' }));
    const cocher = (code: string) => fireEvent.click(
      within(scenario.getByText(code).closest('label') as HTMLElement).getByRole('checkbox'),
    );

    // Aucun diagnostic : rien n'est ni couvert ni signalé comme manquant.
    expect(panneau('preview').queryByText(/sans bloc spécialisé/)).toBeNull();

    // Le moteur d'applicabilite annonce les blocs devenus disponibles : c'est le meme signal
    // que la saisie clinique, pas un affichage propre a l'apercu.
    const blocsDisponibles = () => panneau('preview').queryAllByText(/Bloc disponible :/)
      .map((noeud) => noeud.closest('div')?.textContent ?? '').join(' | ');

    // Un diagnostic couvert rend son bloc applicable.
    cocher('DX-AVC');
    await waitFor(() => expect(blocsDisponibles()).toMatch(/Bloc 01/));
    expect(panneau('preview').queryByText(/sans bloc spécialisé/)).toBeNull();

    // Plusieurs diagnostics, plusieurs blocs.
    cocher('DX-DIAB');
    await waitFor(() => expect(blocsDisponibles()).toMatch(/Bloc 04/));

    // Cas mixte : un diagnostic sans bloc s'ajoute sans annuler la couverture des autres.
    cocher('DX-SANS-BLOC');
    const avis = await waitFor(() => panneau('preview').getByText(/1 diagnostic\(s\) sans bloc spécialisé/));
    // L'avis nomme le code non couvert, et seulement lui : les diagnostics couverts n'y sont pas.
    const texteAvis = avis.closest('[role="status"]')?.textContent ?? '';
    expect(texteAvis).toMatch(/DX-SANS-BLOC/);
    expect(texteAvis).not.toMatch(/DX-AVC/);
    expect(blocsDisponibles()).toMatch(/Bloc 04/);

    // L'aperçu n'écrit RIEN : ni variable, ni règle, ni ordre.
    for (const ecriture of ecritures) expect(ecriture).not.toHaveBeenCalled();
  });
});

describe('Éditeur de registre — permissions et restrictions de version', () => {
  // Critère 6 du README.
  test('une version publiée reste consultable mais n’offre aucune action de modification', async () => {
    const repo = createEditorRegistryRepository();
    const base = repo.getVersion;
    vi.spyOn(repo, 'getVersion').mockImplementation(async (id: string) => {
      const charge = await base.call(repo, id);
      return { ...charge, version: { ...charge.version, status: 'published' as const } };
    });
    await renderEditor(repo);

    expect(screen.getByText(/Version publiée/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une variable' })).toBeNull();

    fireEvent.click(sommaire().getByRole('button', { name: 'Bloc 05 · 26 variable(s)' }));
    const ligne = panneau('structure').getByText('Bloc 05 · Variable directe 01')
      .closest('[role="row"]') as HTMLElement;
    // La variable reste consultable…
    expect(within(ligne).getByRole('button', { name: /^Consulter la variable · / })).toBeInTheDocument();
    // … mais aucune commande d'écriture n'est rendue sur la ligne.
    expect(within(ligne).queryByRole('button', { name: /^Supprimer · / })).toBeNull();
    expect(within(ligne).queryByRole('button', { name: /^Monter · / })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /^Règles/ }));
    expect(panneau('rules').queryByRole('button', { name: 'Ajouter une règle' })).toBeNull();
  });
});
