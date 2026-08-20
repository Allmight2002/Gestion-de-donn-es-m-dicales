// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { TerminologyRepository } from '../../data/terminology';
import type { TemplateField } from '../../data/types';
import { EncounterFields, HiddenValuesNotice } from './EncounterFields';

describe('EncounterFields description', () => {
  test('opens the accessible guidance without extending the form initially', async () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[{
            id: 'glasgow', fieldKey: 'glasgow', label: 'Score de Glasgow',
            description: 'Premier score documenté avant toute sédation', scope: 'encounter', section: 'clinique',
            type: 'integer', unit: null, allowedValues: null, required: false, minValue: null, maxValue: null,
            allowMissingCodes: false, displayOrder: 0,
          }]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    const help = screen.getByRole('button', { name: 'Afficher la consigne de saisie' });
    await userEvent.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Premier score documenté avant toute sédation');
  });
});

const imagerie = [
  {
    id: 'imagerie_faite', fieldKey: 'imagerie_faite', label: 'Imagerie faite', scope: 'encounter' as const,
    section: 'paraclinique' as const, type: 'boolean' as const, unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
  },
  {
    id: 'imagerie_type', fieldKey: 'imagerie_type', label: 'Type d’imagerie', scope: 'encounter' as const,
    section: 'paraclinique' as const, type: 'text' as const, unit: null, allowedValues: null,
    required: true, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 1,
  },
];

describe('EncounterFields — affichage conditionnel (L32)', () => {
  test('une variable masquee n\'est pas rendue du tout', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={imagerie}
          values={{}}
          hiddenKeys={new Set(['imagerie_type'])}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Imagerie faite')).toBeInTheDocument();
    expect(screen.queryByText('Type d’imagerie')).toBeNull();
  });

  test('sans masquage, la meme variable est bien la', () => {
    render(
      <I18nProvider>
        <EncounterFields fields={imagerie} values={{}} onChange={() => undefined} onRemove={() => undefined} />
      </I18nProvider>,
    );
    expect(screen.getByText('Type d’imagerie')).toBeInTheDocument();
  });
});

describe('HiddenValuesNotice — l\'effacement s\'annonce (L32)', () => {
  test('nomme le nombre de valeurs et les variables concernees', () => {
    render(
      <I18nProvider>
        <HiddenValuesNotice removedKeys={['imagerie_type']} fields={imagerie} />
      </I18nProvider>,
    );
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('1 valeur(s)');
    expect(notice).toHaveTextContent('Type d’imagerie');
  });

  test('rien a retirer -> aucun bandeau : on n\'inquiete pas sans raison', () => {
    render(
      <I18nProvider>
        <HiddenValuesNotice removedKeys={[]} fields={imagerie} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// L31 — sections personnalisables
// ---------------------------------------------------------------------------

const champ = (over: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label' | 'section'>): TemplateField => ({
  scope: 'encounter', type: 'text', unit: null, allowedValues: null, required: false,
  minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...over,
});

describe('EncounterFields — sections personnalisables (L31)', () => {
  test('une section personnalisee est rendue avec SON libelle, pas son code', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[champ({ id: 'a', fieldKey: 'tdm', label: 'TDM', section: 'imagerie_cerebrale' })]}
          sections={[{ id: 's1', sectionKey: 'imagerie_cerebrale', label: 'Imagerie cérébrale', displayOrder: 0 }]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('group', { name: 'Imagerie cérébrale' })).toBeInTheDocument();
  });

  test('les trois sections historiques gardent leur libelle TRADUIT, pas celui stocke', () => {
    // Une base existante ne doit pas changer d'apparence : le libelle stocke par la
    // migration ne doit pas se substituer a la traduction.
    render(
      <I18nProvider>
        <EncounterFields
          fields={[champ({ id: 'a', fieldKey: 'sexe', label: 'Sexe', section: 'clinique' })]}
          sections={[{ id: 's1', sectionKey: 'clinique', label: 'PEU IMPORTE', displayOrder: 0 }]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('group', { name: 'Clinique' })).toBeInTheDocument();
  });

  test('LE FILET : une variable sans section reste affichee sous « Autre »', () => {
    // C'est le point 4 du lot. Une variable invisible n'est jamais saisie, et personne
    // ne s'en apercoit : ce repli doit survivre a toute evolution du regroupement.
    render(
      <I18nProvider>
        <EncounterFields
          fields={[champ({ id: 'a', fieldKey: 'orpheline', label: 'Variable orpheline', section: '' })]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('group', { name: 'Autre' })).toBeInTheDocument();
    expect(screen.getByText('Variable orpheline')).toBeInTheDocument();
  });

  test('une section inconnue de la liste reste affichee, sous son code', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[champ({ id: 'a', fieldKey: 'x', label: 'Variable X', section: 'section_retiree' })]}
          sections={[{ id: 's1', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 }]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('group', { name: 'section_retiree' })).toBeInTheDocument();
    expect(screen.getByText('Variable X')).toBeInTheDocument();
  });

  test('sans liste de sections, l ordre historique est conserve', () => {
    // Sans ce repli, une base qui n'a rien change verrait son formulaire se reorganiser
    // tout seul au deploiement : ici la paraclinique est declaree en premier.
    render(
      <I18nProvider>
        <EncounterFields
          fields={[
            champ({ id: 'a', fieldKey: 'imagerie', label: 'Imagerie', section: 'paraclinique', displayOrder: 0 }),
            champ({ id: 'b', fieldKey: 'symptome', label: 'Symptome', section: 'clinique', displayOrder: 1 }),
          ]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    const groups = screen.getAllByRole('group').map((g) => g.textContent ?? '');
    expect(groups[0]).toContain('Symptome');
    expect(groups[1]).toContain('Imagerie');
  });

  test('l ordre voulu par le proprietaire prime sur l ordre historique', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[
            champ({ id: 'a', fieldKey: 'symptome', label: 'Symptome', section: 'clinique', displayOrder: 0 }),
            champ({ id: 'b', fieldKey: 'imagerie', label: 'Imagerie', section: 'paraclinique', displayOrder: 1 }),
          ]}
          sections={[
            { id: 's1', sectionKey: 'paraclinique', label: 'Paraclinique', displayOrder: 0 },
            { id: 's2', sectionKey: 'clinique', label: 'Clinique', displayOrder: 1 },
          ]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    const groups = screen.getAllByRole('group').map((g) => g.textContent ?? '');
    expect(groups[0]).toContain('Imagerie');
    expect(groups[1]).toContain('Symptome');
  });

  test('le filet ferme la marche, meme reordonne', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[
            champ({ id: 'a', fieldKey: 'orpheline', label: 'Orpheline', section: '', displayOrder: 0 }),
            champ({ id: 'b', fieldKey: 'symptome', label: 'Symptome', section: 'clinique', displayOrder: 1 }),
          ]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    const groups = screen.getAllByRole('group').map((g) => g.textContent ?? '');
    expect(groups[0]).toContain('Symptome');
    expect(groups[1]).toContain('Orpheline');
  });
});

// L21 — « pas de valeur » n'a qu'UNE representation : la cle absente, ou un code de donnee
// manquante. Le tableau vide est refuse par la base, deliberement ; c'est au client de ne
// jamais le produire.
describe('EncounterFields — listes de diagnostics (L21)', () => {
  const CHOLERA = { code: '1A00', label: 'Cholera' };
  const DIABETE = { code: '5A11', label: 'Diabete de type 2' };
  const INERTE = {
    search: async () => [],
    activeRelease: async () => null,
    listEntries: async () => ({ entries: [], total: 0 }),
  } as unknown as TerminologyRepository;

  const diagnostic: TemplateField = {
    id: 'diagnostic', fieldKey: 'diagnostic', label: 'Diagnostic', scope: 'encounter',
    section: 'clinique', type: 'terminology', isMultiple: true, unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: true,
    missingReasons: ['non_fait'], displayOrder: 0,
  };

  function renderFields(values: Record<string, unknown>) {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    render(
      <I18nProvider>
        <RepositoryProvider terminology={INERTE}>
          <EncounterFields fields={[diagnostic]} values={values} onChange={onChange} onRemove={onRemove} />
        </RepositoryProvider>
      </I18nProvider>,
    );
    return { onChange, onRemove };
  }

  test('retirer la derniere valeur supprime la CLE, sans ecrire de tableau vide', async () => {
    const { onChange, onRemove } = renderFields({ diagnostic: [CHOLERA] });
    await userEvent.click(screen.getByRole('button', { name: 'Retirer Cholera' }));

    expect(onRemove).toHaveBeenCalledWith('diagnostic');
    expect(onChange).not.toHaveBeenCalled();
  });

  test('retirer une valeur parmi deux enregistre la liste restante', async () => {
    const { onChange, onRemove } = renderFields({ diagnostic: [CHOLERA, DIABETE] });
    await userEvent.click(screen.getByRole('button', { name: 'Retirer Cholera' }));

    expect(onChange).toHaveBeenCalledWith('diagnostic', [DIABETE]);
    expect(onRemove).not.toHaveBeenCalled();
  });

  // ValueInput est conserve tel quel : un code de donnee manquante REMPLACE la liste, il ne
  // s'y ajoute pas.
  test('un code de donnee manquante remplace la liste', async () => {
    const { onChange } = renderFields({ diagnostic: [CHOLERA] });
    await userEvent.selectOptions(screen.getByLabelText('Diagnostic — valeur manquante'), 'non_fait');

    expect(onChange).toHaveBeenCalledWith('diagnostic', { __missing__: 'non_fait' });
  });
});

// --- L35 : variables calculees ---------------------------------------------------------
const sejour: TemplateField[] = [
  {
    id: 'date_entree', fieldKey: 'date_entree', label: 'Date d’entrée', scope: 'encounter',
    section: 'clinique', type: 'date', unit: null, allowedValues: null, required: false,
    minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
  },
  {
    id: 'date_sortie', fieldKey: 'date_sortie', label: 'Date de sortie', scope: 'encounter',
    section: 'clinique', type: 'date', unit: null, allowedValues: null, required: false,
    minValue: null, maxValue: null, allowMissingCodes: true,
    missingReasons: ['non_documente'], displayOrder: 1,
  },
  {
    id: 'duree_sejour', fieldKey: 'duree_sejour', label: 'Durée de séjour', scope: 'encounter',
    section: 'clinique', type: 'integer', unit: 'jours', allowedValues: null, required: false,
    minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 2,
    formula: 'date_sortie - date_entree',
  },
];

const renderSejour = (values: Record<string, unknown>) =>
  render(
    <I18nProvider>
      <EncounterFields fields={sejour} values={values} onChange={() => undefined} onRemove={() => undefined} />
    </I18nProvider>,
  );

describe('EncounterFields — variable calculee (L35)', () => {
  test('la variable calculee n’est PAS saisissable : aucun champ, aucune raison manquante', () => {
    renderSejour({ date_entree: '2024-02-01', date_sortie: '2024-03-01' });
    // Les operandes, eux, restent saisissables.
    expect(screen.getByLabelText('Date d’entrée')).toBeInTheDocument();
    // La variable calculee n'a ni champ de saisie, ni selecteur de valeur manquante.
    const calculee = screen.getByRole('status', { name: 'Durée de séjour' });
    expect(calculee.querySelector('input')).toBeNull();
    expect(screen.queryByLabelText('Durée de séjour — valeur manquante')).toBeNull();
  });

  test('le resultat s’affiche et se met a jour quand un operande change', () => {
    const { unmount } = renderSejour({ date_entree: '2024-02-01', date_sortie: '2024-03-01' });
    expect(screen.getByRole('status', { name: 'Durée de séjour' })).toHaveTextContent('29');
    unmount();
    // Une correction d'un operande change le resultat, sans qu'il y ait rien a resynchroniser.
    renderSejour({ date_entree: '2024-02-01', date_sortie: '2024-02-11' });
    expect(screen.getByRole('status', { name: 'Durée de séjour' })).toHaveTextContent('10');
  });

  test('operande absent -> resultat ABSENT, jamais zero', () => {
    renderSejour({ date_entree: '2024-02-01' });
    const calculee = screen.getByRole('status', { name: 'Durée de séjour' });
    expect(calculee).toHaveTextContent('en attente des éléments du calcul');
    expect(calculee.textContent).not.toContain('0');
  });

  test('code de valeur manquante sur un operande -> resultat ABSENT', () => {
    renderSejour({ date_entree: '2024-02-01', date_sortie: { __missing__: 'non_documente' } });
    expect(screen.getByRole('status', { name: 'Durée de séjour' }))
      .toHaveTextContent('en attente des éléments du calcul');
  });
});
