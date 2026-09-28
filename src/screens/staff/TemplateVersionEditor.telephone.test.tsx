// @vitest-environment jsdom
//
// Audit UI mobile, lot 6 (docs/audits/audit-ui-mobile-2026-09-27.md, 5.13) — l'éditeur des jeux
// de variables sur téléphone, joué sur la fixture fictive de 216 variables. Sous 768 px : filtres
// en panneau bas, actions de ligne dans « ⋯ » et mode « Réorganiser », sections repliées. À
// toutes les tailles : règles regroupées par condition (affichage seulement) et paginées par 20,
// fiche d'une variable resserrée, un seul bouton principal.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { TemplateRepository } from '../../data/templates';
import { TopBarRegistryProvider, useTopBarRegistry } from '../../components/TopBar';
import { TemplateVersionEditor } from './TemplateVersionEditor';
import { createEditorRegistryRepository, editorRegistryRules, editorRegistryVersion } from '../../test/fixtures/editorRegistry';

const originalMatchMedia = window.matchMedia;
function phone(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow && query === '(max-width: 767px)', media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
beforeEach(() => phone(true));
afterEach(() => { window.matchMedia = originalMatchMedia; });

function TopBarProbe({ children }: { children: ReactNode }) {
  const { active, registry } = useTopBarRegistry();
  return (
    <TopBarRegistryProvider registry={registry}>
      {children}
      <p data-testid="barre">{active ? `${active.title} | ${active.closeLabel}` : 'vide'}</p>
    </TopBarRegistryProvider>
  );
}

function renderEditor(repo: TemplateRepository = createEditorRegistryRepository(), preparationMode = false) {
  render(
    <I18nProvider>
      <RepositoryProvider templates={repo}>
        <TopBarProbe>
          <TemplateVersionEditor
            versionId={editorRegistryVersion.id}
            templateName="Registre multipathologies"
            onBack={() => {}}
            showVersionActions={false}
            onNewVersion={() => {}}
            preparationMode={preparationMode}
          />
        </TopBarProbe>
      </RepositoryProvider>
    </I18nProvider>,
  );
  return screen.findByRole('heading', { level: 2, name: 'Registre multipathologies' });
}

const panneau = (espace: 'structure' | 'sections' | 'rules' | 'diagnosis') =>
  within(document.getElementById(`editor-panel-${espace}`) as HTMLElement);
const lignesDeRegles = () => document.querySelectorAll('#editor-panel-rules li[id^="rule-"]');

/** Trois regles d'affichage de plus, sur la condition exacte d'une regle existante. */
async function withSharedCondition(sourceId: string, targets: string[]) {
  const repo = createEditorRegistryRepository();
  const source = editorRegistryRules.find((rule) => rule.id === sourceId)!.rule as { if: unknown };
  for (const target of targets) {
    await repo.addRule(editorRegistryVersion.id, { if: source.if, then: { field: target, operator: 'visible' } }, '', 'block');
  }
  return repo;
}

describe('Éditeur sur téléphone — en-tête et structure', () => {
  test('la barre haute porte le nom du jeu et la sortie ; un seul bouton principal, la version suivante dans ⋯', async () => {
    const user = userEvent.setup();
    await renderEditor();
    expect(screen.getByTestId('barre')).toHaveTextContent('Registre multipathologies | Retour');
    // Le titre reste pour les lecteurs d'ecran, la version rejoint la ligne d'etat.
    expect(screen.getByRole('heading', { level: 2, name: 'Registre multipathologies' })).toHaveClass('max-lg:sr-only');
    expect(screen.getByText('Version 7 · Brouillon').closest('[aria-live]')).not.toBeNull();

    const add = screen.getByRole('button', { name: 'Ajouter une variable' });
    expect(add).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: /^Créer la version suivante/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Plus d’actions' }));
    expect(screen.getByRole('button', { name: /^Créer la version suivante/ })).toBeInTheDocument();

    // Hors de la structure, « Ajouter une variable » reste disponible mais n'est plus plein.
    await user.click(screen.getByRole('tab', { name: /^Règles/ }));
    expect(add).toHaveClass('btn-secondary');
  });

  test('en préparation de formulaire, la barre haute reste celle de l’écran hôte', async () => {
    await renderEditor(createEditorRegistryRepository(), true);
    expect(screen.getByTestId('barre')).toHaveTextContent('vide');
  });

  test('filtres et tri passent dans un panneau bas, qui compte les filtres actifs et les remet à zéro', async () => {
    const user = userEvent.setup();
    await renderEditor();
    // Rien de tout cela n'encombre plus la page.
    expect(screen.queryByLabelText('Filtrer par type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Trier l’affichage')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Filtres' }));
    let sheet = screen.getByRole('dialog', { name: 'Filtres et tri' });
    await user.selectOptions(within(sheet).getByLabelText('Filtrer par type'), 'select');
    await user.click(within(sheet).getByRole('checkbox', { name: 'Variables obligatoires uniquement' }));
    await user.click(within(sheet).getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Le bouton dit combien de filtres sont actifs ; la liste passe a « Toutes les variables ».
    expect(screen.getByRole('button', { name: 'Filtres · 2 actif(s)' })).toBeInTheDocument();
    expect(panneau('structure').getByRole('heading', { level: 3, name: 'Toutes les variables' })).toBeInTheDocument();

    // On remet a zero dans le panneau.
    await user.click(screen.getByRole('button', { name: 'Filtres · 2 actif(s)' }));
    sheet = screen.getByRole('dialog', { name: 'Filtres et tri' });
    await user.click(within(sheet).getByRole('button', { name: 'Réinitialiser les filtres' }));
    expect(within(sheet).getByRole('button', { name: 'Réinitialiser les filtres' })).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: 'Fermer' }));
    expect(screen.getByRole('button', { name: 'Filtres' })).toBeInTheDocument();
  });

  test('l’index des sections s’ouvre en panneau bas et y choisit un bloc', async () => {
    const user = userEvent.setup();
    await renderEditor();
    expect(screen.queryByRole('navigation', { name: 'Sommaire du formulaire' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Index des sections' }));
    const sheet = screen.getByRole('dialog', { name: 'Index des sections' });
    await user.click(within(sheet).getByRole('button', { name: /^Bloc 02 · 26 variable/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(panneau('structure').getByRole('heading', { level: 3, name: 'Bloc 02' })).toBeInTheDocument();
  });

  test('une ligne par variable : ⋯ pour déplacer ou supprimer, les flèches en mode Réorganiser', async () => {
    const user = userEvent.setup();
    await renderEditor();
    const structure = panneau('structure');
    expect(structure.queryByRole('button', { name: /^Monter · / })).not.toBeInTheDocument();

    await user.click(structure.getByRole('button', { name: 'Actions · Bloc 01 · Variable directe 01' }));
    expect(structure.getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();
    await user.click(structure.getByRole('button', { name: 'Déplacer' }));
    expect(await screen.findByRole('dialog', { name: /Déplacer « Bloc 01 · Variable directe 01 »/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));

    const reorder = structure.getByRole('button', { name: 'Réorganiser' });
    await user.click(reorder);
    expect(structure.getByRole('button', { name: 'Terminer' })).toHaveAttribute('aria-pressed', 'true');
    expect(structure.getByRole('button', { name: 'Monter · Bloc 01 · Variable directe 02' })).toBeInTheDocument();
    expect(structure.getByRole('button', { name: 'Déplacer · Bloc 01 · Variable directe 02' })).toBeInTheDocument();
    expect(structure.queryByRole('button', { name: /^Actions · / })).not.toBeInTheDocument();
  });
});

describe('Éditeur sur téléphone — sections', () => {
  test('une ligne « nom · N variables » par section, ses commandes et le ⓘ du groupe répétable à la demande', async () => {
    const user = userEvent.setup();
    await renderEditor();
    await user.click(screen.getByRole('tab', { name: /^Sections/ }));
    const sections = panneau('sections');
    const row = sections.getByRole('button', { name: /^Bloc 01 · 8 variable/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(sections.queryByRole('button', { name: 'Renommer' })).not.toBeInTheDocument();

    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(sections.getByRole('button', { name: 'Renommer' })).toBeInTheDocument();
    // L'explication n'est plus ecrite en toutes lettres : elle s'ouvre derriere ⓘ.
    expect(sections.getByText(/l’analyse comptera les occurrences/)).toHaveClass('sr-only');
    await user.click(sections.getByRole('button', { name: 'Groupe répétable' }));
    expect(within(screen.getByRole('dialog', { name: 'Groupe répétable' })).getByText(/occurrences elles-mêmes/)).toBeInTheDocument();
  });

  test('la liste d’abord : créer ou importer une section s’ouvre depuis « Ajouter »', async () => {
    const user = userEvent.setup();
    await renderEditor();
    await user.click(screen.getByRole('tab', { name: /^Sections/ }));
    const sections = panneau('sections');
    expect(sections.queryByLabelText('Nom de la section')).not.toBeInTheDocument();
    await user.click(sections.getByRole('button', { name: 'Ajouter' }));
    expect(sections.getByRole('button', { name: 'Importer un bloc' })).toBeInTheDocument();
    await user.click(sections.getByRole('button', { name: 'Nouvelle section' }));
    await user.type(sections.getByLabelText('Nom de la section'), 'Suivi à un an');
    await user.click(sections.getByRole('button', { name: 'Ajouter la section' }));
    // La section creee, le formulaire se referme sur la liste, qui la montre.
    expect(await sections.findByRole('button', { name: /^Suivi à un an · 0 variable/ })).toBeInTheDocument();
    expect(sections.queryByLabelText('Nom de la section')).not.toBeInTheDocument();
  });
});

describe('Règles regroupées par condition (5.13-B), à toutes les tailles', () => {
  test('les règles d’une même condition tiennent sur une ligne et restent unitaires', async () => {
    phone(false);
    const user = userEvent.setup();
    await renderEditor(await withSharedCondition('rule-generic-02', ['bloc_02_direct_01', 'bloc_02_direct_02', 'bloc_02_direct_03']));
    await user.click(screen.getByRole('tab', { name: /^Règles/ }));

    const group = panneau('rules').getByRole('button', {
      name: 'Si Bloc 01 · Variable directe 04 est égal à « oui » → affiche 3 variable(s), rend 1 variable(s) obligatoire(s)',
    });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('rule-rule-generic-02')).toBeNull();

    await user.click(group);
    // Quatre regles, chacune avec sa ligne et son identifiant ; la condition n'est pas repetee.
    const unit = document.getElementById('rule-rule-generic-02') as HTMLElement;
    expect(unit).toHaveTextContent('→ Bloc 01 · Variable directe 05 est obligatoire');
    expect(unit).not.toHaveTextContent('Si Bloc 01');
    expect(within(group.closest('li') as HTMLElement).getAllByRole('button', { name: 'Modifier la règle' })).toHaveLength(4);
    expect(panneau('rules').getByText('29 règle(s) affichée(s) sur 29')).toBeInTheDocument();

    // 29 regles, 26 lignes : vingt, puis les six suivantes a la demande.
    expect(panneau('rules').getByText('20 lignes affichées sur 26')).toBeInTheDocument();
    await user.click(panneau('rules').getByRole('button', { name: 'Afficher 6 de plus' }));
    expect(lignesDeRegles()).toHaveLength(25 + 4);
    expect(panneau('rules').queryByText(/lignes affichées sur/)).not.toBeInTheDocument();
  });

  test('vingt lignes à la fois ; une règle atteinte depuis la collecte ouvre sa page et son groupe', async () => {
    phone(false);
    const user = userEvent.setup();
    // Les associations diagnostiques passent en fin de liste, au-dela de la premiere page, et
    // celle du bloc 01 partage sa condition avec une autre regle.
    const base = await withSharedCondition('rule-diagnosis-bloc-01', ['bloc_07_direct_01']);
    const repo = {
      ...base,
      async getVersion(id: string) {
        const loaded = await base.getVersion(id);
        return { ...loaded, rules: [...loaded.rules.slice(3), ...loaded.rules.slice(0, 3)] };
      },
    } as TemplateRepository;
    await renderEditor(repo);

    await user.click(screen.getByRole('tab', { name: /^Règles/ }));
    expect(lignesDeRegles()).toHaveLength(20);
    expect(panneau('rules').getByText('20 lignes affichées sur 26')).toBeInTheDocument();
    expect(document.getElementById('rule-rule-diagnosis-bloc-01')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Collecte diagnostique' }));
    await user.click(panneau('diagnosis').getByRole('button', { name: 'Voir la règle d’activation · Bloc 01' }));
    await waitFor(() => expect(document.getElementById('rule-rule-diagnosis-bloc-01')).toBeTruthy());
    expect(screen.getByRole('tab', { name: /^Règles/ })).toHaveAttribute('aria-selected', 'true');
    // Sa page est affichee et son groupe deplie : la regle qui partage sa condition aussi.
    const group = document.getElementById('rule-rule-diagnosis-bloc-01')!.closest('ul')!.closest('li') as HTMLElement;
    expect(within(group).getByRole('button', { expanded: true })).toHaveTextContent('→ affiche 1 variable(s), affiche 1 bloc(s)');
    expect(panneau('rules').queryByText(/lignes affichées sur/)).not.toBeInTheDocument();
  });
});

describe('Fiche d’une variable', () => {
  test('libellé avant clé technique, « aucune règle » sur une ligne, précédente et suivante en bas', async () => {
    phone(false);
    const user = userEvent.setup();
    await renderEditor();
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher une variable' }), 'Bloc 07 · Variable directe 01');
    await user.click(panneau('structure').getByRole('button', { name: 'Modifier la variable · Bloc 07 · Variable directe 01' }));
    const panel = screen.getByRole('dialog', { name: 'Modifier la variable' });

    expect(within(panel).getAllByRole('textbox')[0]).toBe(within(panel).getByLabelText('Libellé'));
    const none = within(panel).getByText(/^Aucune règle ne concerne cette variable/);
    expect(none.tagName).toBe('P');
    expect(within(none).getByRole('button', { name: 'Voir dans l’espace Règles' })).toBeInTheDocument();

    const save = within(panel).getByRole('button', { name: 'Enregistrer' });
    const next = within(panel).getByRole('button', { name: 'Variable suivante' });
    expect(save.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(next.parentElement).toBe(within(panel).getByRole('button', { name: 'Variable précédente' }).parentElement);
  });
});
