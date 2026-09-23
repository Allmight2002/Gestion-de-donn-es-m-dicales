// @vitest-environment jsdom
// L29 — apercu du formulaire. Deux exigences sont verifiees ici :
//  1. l'apercu rend le formulaire REEL (memes composants de saisie, meme filtre par type) ;
//  2. il n'ecrit RIEN — ni depot, ni brouillon local, ni requete reseau.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../../data/types';
import { FormPreview } from './FormPreview';

const version: TemplateVersion = { id: 'v1', templateId: 't1', versionNumber: 3, status: 'draft' };

const field = (over: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label'>): TemplateField => ({
  scope: 'encounter', section: 'clinique', type: 'text', unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
  ...over,
});

const fields: TemplateField[] = [
  field({ id: 'f1', fieldKey: 'antecedents', label: 'Antécédents', scope: 'patient', displayOrder: 1 }),
  field({ id: 'f2', fieldKey: 'glasgow', label: 'Score de Glasgow', type: 'integer', required: true, minValue: 3, maxValue: 15, displayOrder: 2 }),
  field({ id: 'f3', fieldKey: 'motif_admission', label: 'Motif d’admission', encounterTypes: ['hospitalisation'], displayOrder: 3 }),
  field({ id: 'f4', fieldKey: 'diagnostic', label: 'Diagnostic', type: 'terminology', displayOrder: 4 }),
];

const rules: ValidationRule[] = [];

const renderPreview = () => render(
  <I18nProvider>
    <FormPreview version={version} fields={fields} rules={rules} onClose={() => undefined} />
  </I18nProvider>,
);

describe('FormPreview — fidélité au formulaire réel', () => {
  test('rend les variables de rencontre et suit le type choisi', async () => {
    renderPreview();
    // Type par defaut « consultation » : la variable reservee a l'hospitalisation ne doit
    // pas apparaitre, exactement comme dans EncounterForm.
    expect(screen.getByLabelText('Score de Glasgow')).toBeInTheDocument();
    expect(screen.queryByLabelText('Motif d’admission')).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('Type de rencontre'), 'hospitalisation');
    expect(screen.getByLabelText('Motif d’admission')).toBeInTheDocument();
  });

  test('l’onglet fiche patient rend les variables permanentes, sans code de valeur manquante', async () => {
    renderPreview();
    await userEvent.click(screen.getByRole('tab', { name: /Fiche patient/ }));
    expect(screen.getByLabelText('Antécédents')).toBeInTheDocument();
    // Les donnees permanentes passent par FieldInput (cf. NewPatient), pas par ValueInput :
    // aucun selecteur « valeur manquante » ne doit apparaitre.
    expect(screen.queryByLabelText(/valeur manquante/)).toBeNull();
  });

  test('la vue mobile contraint la largeur du rendu', async () => {
    const { container } = renderPreview();
    expect(container.querySelector('[data-viewport="desktop"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    const frame = container.querySelector('[data-viewport="mobile"]') as HTMLElement | null;
    expect(frame).not.toBeNull();
    expect(frame!.style.width).toBe('390px');
    // Les deux vues rendent le meme formulaire, avec les memes composants de saisie.
    expect(within(frame!).getByLabelText('Score de Glasgow')).toBeInTheDocument();
  });

  test('les contrôles du formulaire sont rejoués à la demande', async () => {
    renderPreview();
    // Statut « finalisé » : c'est la frontiere ou EncounterForm exige la completude.
    await userEvent.selectOptions(screen.getByLabelText('Statut du dossier'), 'curated');
    await userEvent.click(screen.getByRole('button', { name: 'Tester les contrôles' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Score de Glasgow');

    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2026-08-14' } });
    await userEvent.type(screen.getByLabelText('Score de Glasgow'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Tester les contrôles' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('Aucun blocage ni avertissement avec ces valeurs.')).toBeInTheDocument();
  });
});

describe('FormPreview — aucune écriture', () => {
  const appels: string[] = [];
  let fetchSpy: ReturnType<typeof vi.fn>;

  // Chaque depot de l'application est remplace par un mandataire qui note et rejette tout
  // appel : si l'apercu touchait la moindre methode d'un depot reel, le test le dirait.
  // Seule exception attendue : le depot de terminologie INERTE que l'apercu injecte
  // lui-meme, plus pres du composant, et qui masque donc celui de ce test.
  const interdit = (nom: string) => new Proxy({}, {
    get: (_cible, prop) => {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return (...args: unknown[]) => {
        appels.push(`${nom}.${String(prop)}(${args.length})`);
        throw new Error(`Appel interdit depuis l’aperçu : ${nom}.${String(prop)}`);
      };
    },
  }) as never;

  beforeEach(() => {
    appels.length = 0;
    localStorage.clear();
    fetchSpy = vi.fn(() => Promise.reject(new Error('réseau interdit depuis l’aperçu')));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test('ni dépôt appelé, ni brouillon local, ni requête réseau', async () => {
    render(
      <I18nProvider>
        <RepositoryProvider
          templates={interdit('templates')} bases={interdit('bases')} patients={interdit('patients')}
          attachments={interdit('attachments')} cohorts={interdit('cohorts')} exports={interdit('exports')}
          access={interdit('access')} curation={interdit('curation')} admin={interdit('admin')}
          audit={interdit('audit')} groups={interdit('groups')} terminology={interdit('terminology')}
          missions={interdit('missions')} clientErrors={interdit('clientErrors')}
        >
          <FormPreview version={version} fields={fields} rules={rules} onClose={() => undefined} />
        </RepositoryProvider>
      </I18nProvider>,
    );

    // Un parcours complet : saisir, changer de type, de vue, d'onglet, rejouer les
    // controles — tout ce qu'un utilisateur peut declencher depuis cet ecran.
    await userEvent.type(screen.getByLabelText('Score de Glasgow'), '12');
    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2026-08-14' } });
    await userEvent.type(screen.getByLabelText('Diagnostic'), 'hema');
    // Le champ diagnostic a bien cherche — et c'est le depot INERTE qui a repondu, sans rien
    // ramener ni rien telecharger.
    expect(await screen.findByText('Aucun diagnostic trouvé pour cette recherche.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Type de rencontre'), 'hospitalisation');
    await userEvent.type(screen.getByLabelText('Motif d’admission'), 'traumatisme');
    await userEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tester les contrôles' }));
    await userEvent.click(screen.getByRole('tab', { name: /Fiche patient/ }));
    await userEvent.type(screen.getByLabelText('Antécédents'), 'HTA');

    expect(appels).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // `registre.lang` est ecrit par le I18nProvider de ce test, pas par l'apercu : aucun
    // brouillon (`meddata:draft:…`) ni aucune autre cle ne doit apparaitre.
    expect(Object.keys(localStorage).filter((k) => k !== 'registre.lang')).toEqual([]);
  });
});

// L67 — un bloc repetable ne se saisit pas champ par champ mais ligne par ligne. L'apercu
// doit montrer CETTE forme, et rester ce qu'il est : un apercu qui ne cree rien.
describe('FormPreview — bloc répétable (L67)', () => {
  const groupSections: TemplateSection[] = [
    { id: 's1', sectionKey: 'lesions', label: 'Lésions', displayOrder: 0, parentSectionKey: null, isRepeatable: true },
    { id: 's2', sectionKey: 'examen', label: 'Examen', displayOrder: 1, parentSectionKey: null },
  ];

  const groupFields: TemplateField[] = [
    field({ id: 'g1', fieldKey: 'niveau', label: 'Niveau', section: 'lesions', required: true, displayOrder: 1 }),
    field({ id: 'g2', fieldKey: 'morphologie', label: 'Morphologie', section: 'lesions', displayOrder: 2 }),
    field({ id: 'g3', fieldKey: 'conscience', label: 'Conscience', section: 'examen', displayOrder: 3 }),
  ];

  const renderGroups = () => render(
    <I18nProvider>
      <FormPreview version={version} fields={groupFields} rules={[]} sections={groupSections} onClose={() => undefined} />
    </I18nProvider>,
  );

  test('les variables du groupe ne sont pas reclamees sur une vraie rencontre (§5)', () => {
    renderGroups();
    // Onglet « Rencontre » par defaut : seule la variable du bloc ordinaire y figure.
    expect(screen.getByText('Conscience')).toBeInTheDocument();
    expect(screen.queryByText('Morphologie')).toBeNull();
  });

  test('le bloc est rendu en tableau : en-tete, une ligne d exemple vide, ajout inactif', async () => {
    renderGroups();
    await userEvent.click(screen.getByRole('tab', { name: /Fiche patient/ }));

    const table = screen.getByRole('table', { name: 'Lésions' });
    expect(within(table).getByRole('columnheader', { name: /Niveau/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Morphologie' })).toBeInTheDocument();
    // Une seule ligne de corps, et elle est vide.
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(1);
    expect(within(bodyRows[0]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['—', '—']);
    expect(screen.getByText('Ligne d’exemple, vide')).toBeInTheDocument();

    // L'apercu ne cree rien : la commande d'ajout est rendue, mais inactive.
    expect(screen.getByRole('button', { name: 'Ajouter une occurrence' })).toBeDisabled();
  });
});

// L72b — l'apercu confiait les groupes a une boucle placee APRES le formulaire : un groupe se
// lisait toujours en pied de fiche, quel que soit son rang. Il passe desormais par la meme prop
// que la saisie (`repeatableGroup`) et devient une etape a son rang (decision D9).
describe('FormPreview — rang des groupes répétables (L72b)', () => {
  const stepsOf = () => within(screen.getByRole('navigation', { name: 'Sommaire du formulaire' }))
    .getAllByRole('button').map((button) => button.textContent);

  const renderWith = async (sections: TemplateSection[], sectionFields: TemplateField[]) => {
    render(
      <I18nProvider>
        <FormPreview version={version} fields={sectionFields} rules={[]} sections={sections} onClose={() => undefined} />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('tab', { name: /Fiche patient/ }));
  };

  test('un groupe racine est rendu a son rang declare, et non plus en pied de formulaire', async () => {
    await renderWith([
      { id: 's1', sectionKey: 'examen', label: 'Examen', displayOrder: 0, parentSectionKey: null },
      { id: 's2', sectionKey: 'lesions', label: 'Lésions', displayOrder: 1, parentSectionKey: null, isRepeatable: true },
      { id: 's3', sectionKey: 'suites', label: 'Suites', displayOrder: 2, parentSectionKey: null },
    ], [
      field({ id: 'f1', fieldKey: 'conscience', label: 'Conscience', scope: 'patient', section: 'examen', displayOrder: 1 }),
      field({ id: 'f2', fieldKey: 'niveau', label: 'Niveau', section: 'lesions', displayOrder: 2 }),
      field({ id: 'f3', fieldKey: 'sequelles', label: 'Séquelles', scope: 'patient', section: 'suites', displayOrder: 3 }),
    ]);

    expect(stepsOf()).toEqual(['Examen', 'Lésions', 'Suites']);
    // Le tableau inerte est DANS l'etape du groupe, pas apres le formulaire.
    await userEvent.click(screen.getByRole('button', { name: 'Bloc suivant' }));
    const table = screen.getByRole('table', { name: 'Lésions' });
    expect(table.closest('fieldset')).toHaveAccessibleName('Lésions');
    expect(within(table.closest('fieldset') as HTMLElement).getByRole('button', { name: 'Ajouter une occurrence' })).toBeDisabled();
  });

  test('sans aucune variable permanente, le groupe reste montre', async () => {
    await renderWith([
      { id: 's2', sectionKey: 'lesions', label: 'Lésions', displayOrder: 0, parentSectionKey: null, isRepeatable: true },
    ], [field({ id: 'f2', fieldKey: 'niveau', label: 'Niveau', section: 'lesions' })]);

    expect(screen.getByText('Aucune variable permanente dans ce jeu de variables.')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Lésions' })).toBeInTheDocument();
  });

  // A (A1, G1, A2) : le groupe enfant est une etape entre A1 et A2. FormPreview le confie a
  // SectionedFields ; le placer est le travail de `repeatableSectionsOf` et
  // `withRepeatableSteps`, dont L72c leve le filtre racine. Sans L72c, G1 n'est pas rendu :
  // `.fails` le constate. Des que L72c est fusionne, ce test « reussit a tort » et casse —
  // retirer alors `.fails` (verifie passant sur l'arbre combine L72b + L72c).
  test.fails('A (A1, G1, A2) : G1 est une etape entre A1 et A2 — attend L72c', async () => {
    await renderWith([
      { id: 'a', sectionKey: 'trauma', label: 'Traumatisme', displayOrder: 0, parentSectionKey: null },
      { id: 'a1', sectionKey: 'bilan', label: 'Bilan', displayOrder: 1, parentSectionKey: 'trauma' },
      { id: 'g1', sectionKey: 'lesions', label: 'Lésions', displayOrder: 2, parentSectionKey: 'trauma', isRepeatable: true },
      { id: 'a2', sectionKey: 'suites', label: 'Suites', displayOrder: 3, parentSectionKey: 'trauma' },
    ], [
      field({ id: 'f1', fieldKey: 'mecanisme', label: 'Mécanisme', scope: 'patient', section: 'bilan', displayOrder: 1 }),
      field({ id: 'f2', fieldKey: 'niveau', label: 'Niveau', section: 'lesions', displayOrder: 2 }),
      field({ id: 'f3', fieldKey: 'sequelles', label: 'Séquelles', scope: 'patient', section: 'suites', displayOrder: 3 }),
    ]);

    expect(stepsOf()).toEqual(['Bilan', 'Lésions', 'Suites']);
  });
});
