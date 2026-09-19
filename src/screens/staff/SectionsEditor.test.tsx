// @vitest-environment jsdom
// L67 — declarer un bloc repetable depuis l'editeur.
//
// Cocher la case change le SENS des lignes du bloc : ses variables ne decrivent plus le
// patient mais une occurrence. L'ecran doit donc rendre les trois consequences du §7 lisibles
// AVANT la confirmation, et refuser quand une variable du bloc porte deja des donnees —
// c'est le point 20 du §14.2.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { ObservationModel } from '../../data/bases';
import type { TemplateField, TemplateSection } from '../../data/types';
import { SectionsEditor } from './SectionsEditor';

const section = (
  over: Partial<TemplateSection> & Pick<TemplateSection, 'id' | 'sectionKey' | 'label'>,
): TemplateSection => ({ displayOrder: 0, parentSectionKey: null, ...over });

const field = (
  over: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label' | 'section'>,
): TemplateField => ({
  scope: 'encounter', type: 'text', unit: null, allowedValues: null, required: false,
  minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...over,
});

const lesions = section({ id: 's1', sectionKey: 'lesions', label: 'Lésions' });

function renderEditor(options: {
  sections?: TemplateSection[];
  fields?: TemplateField[];
  observationModel?: ObservationModel;
} = {}) {
  const onRepeatableChange = vi.fn();
  render(
    <I18nProvider>
      <SectionsEditor
        sections={options.sections ?? [lesions]}
        fields={options.fields ?? []}
        observationModel={options.observationModel ?? 'longitudinal'}
        onRepeatableChange={onRepeatableChange}
        onAdd={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onReorder={vi.fn()}
      />
    </I18nProvider>,
  );
  return onRepeatableChange;
}

const repeatableBox = () => screen.getByRole('checkbox', { name: /Groupe répétable/ });

describe('SectionsEditor — declarer un groupe repetable (L67)', () => {
  test('la case porte la regle de decision du §3.3 en libelle secondaire', () => {
    renderEditor();
    expect(repeatableBox()).toBeInTheDocument();
    expect(screen.getByText(
      'À cocher quand l’analyse comptera les occurrences elles-mêmes, et non les patients.',
    )).toBeInTheDocument();
  });

  test('§14.2 test 20 — refus explique quand une variable du bloc porte deja des donnees', async () => {
    const user = userEvent.setup();
    const onRepeatableChange = renderEditor({
      fields: [
        field({ id: 'f1', fieldKey: 'niveau', label: 'Niveau', section: 'lesions', inUse: true }),
        field({ id: 'f2', fieldKey: 'morpho', label: 'Morphologie', section: 'lesions' }),
      ],
    });

    await user.click(repeatableBox());

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Refusé : ces variables portent déjà des données')).toBeInTheDocument();
    // La variable fautive est NOMMEE : un refus qui ne dit pas laquelle n'explique rien.
    expect(within(dialog).getByRole('listitem')).toHaveTextContent('Niveau');
    expect(within(dialog).getByRole('button', { name: 'Déclarer répétable' })).toBeDisabled();
    expect(onRepeatableChange).not.toHaveBeenCalled();

    // Une fois le refus lu, la case n'a pas bascule : rien n'a ete declare.
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(repeatableBox()).not.toBeChecked();
  });

  test('les trois consequences sont lisibles avant de confirmer', async () => {
    const user = userEvent.setup();
    const onRepeatableChange = renderEditor({
      fields: [
        field({ id: 'f1', fieldKey: 'niveau', label: 'Niveau', section: 'lesions', scope: 'patient' }),
        field({ id: 'f2', fieldKey: 'morpho', label: 'Morphologie', section: 'lesions' }),
      ],
    });

    await user.click(repeatableBox());
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('Ces variables passeront en portée rencontre')).toBeInTheDocument();
    expect(within(dialog).getByRole('listitem')).toHaveTextContent('Niveau');
    expect(within(dialog).getByText(/types de rencontre concernés/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Déclarer répétable' }));
    expect(onRepeatableChange).toHaveBeenCalledTimes(1);
    const [sectionId, isRepeatable, toConvert] = onRepeatableChange.mock.calls[0];
    expect(sectionId).toBe('s1');
    expect(isRepeatable).toBe(true);
    expect(toConvert.map((f: TemplateField) => f.fieldKey)).toEqual(['niveau']);
  });

  test('une variable de rencontre qui porte des types de rencontre repasse aussi a l ecriture', async () => {
    const user = userEvent.setup();
    const onRepeatableChange = renderEditor({
      fields: [
        field({ id: 'f2', fieldKey: 'morpho', label: 'Morphologie', section: 'lesions', encounterTypes: ['suivi'] }),
      ],
    });

    await user.click(repeatableBox());
    const dialog = screen.getByRole('dialog');
    // Aucune portee ne change : l'ecran le dit au lieu de laisser la liste vide.
    expect(within(dialog).getByText('Toutes les variables de ce bloc sont déjà en portée rencontre.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Déclarer répétable' }));
    // §5 : `encounter_types` doit repartir a nul, donc la variable passe par l'ecriture.
    expect(onRepeatableChange.mock.calls[0][2].map((f: TemplateField) => f.fieldKey)).toEqual(['morpho']);
  });

  test('base transversale : la case est verrouillee et l ecran dit d ou vient le verrou', () => {
    renderEditor({ observationModel: 'cross_sectional' });
    expect(repeatableBox()).toBeDisabled();
    expect(screen.getByText(/le modèle d’observation s’est verrouillé à sa première fiche/i)).toBeInTheDocument();
  });

  test('une sous-section ne recoit pas la case : un groupe repetable est un bloc racine', () => {
    renderEditor({
      sections: [lesions, section({ id: 's2', sectionKey: 'detail', label: 'Détail', parentSectionKey: 'lesions' })],
    });
    expect(screen.getAllByRole('checkbox', { name: /Groupe répétable/ })).toHaveLength(1);
  });

  test('retirer le caractere repetable ne passe par aucune confirmation', async () => {
    const user = userEvent.setup();
    const onRepeatableChange = renderEditor({ sections: [{ ...lesions, isRepeatable: true }] });

    expect(repeatableBox()).toBeChecked();
    await user.click(repeatableBox());

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onRepeatableChange).toHaveBeenCalledWith('s1', false, []);
  });
});
