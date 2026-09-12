import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { CommonLayoutPayload, TemplateCommonLayout, TemplateField, TemplateSection } from '../../data/types';
import { I18nProvider } from '../../i18n/I18nProvider';
import { CommonLayoutEditor } from './CommonLayoutEditor';

const field = (fieldKey: string, label: string, displayOrder: number, type: TemplateField['type'] = 'text'): TemplateField => ({
  id: fieldKey, fieldKey, label, scope: 'encounter', section: null, type, unit: null,
  allowedValues: type === 'select' ? ['a'] : null, required: false, minValue: null, maxValue: null,
  allowMissingCodes: false, displayOrder,
});
const fields = [field('motif', 'Motif', 0), field('diagnostic', 'Diagnostic', 1), field('synthese', 'Synthèse', 2)];
const sections: TemplateSection[] = [{ id: 'clinique', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 }];
const layout: TemplateCommonLayout = {
  fingerprint: 'before', locked: false, inUse: false, defaultKey: 'contexte', unassigned: [],
  sections: [{ key: 'clinique', label: 'Clinique' }],
  groups: [
    { key: 'contexte', label: 'Contexte initial', anchor: 0, isDefault: true, fields: ['motif', 'diagnostic'] },
    { key: 'synthese', label: 'Synthèse', anchor: 1, isDefault: false, fields: ['synthese'] },
  ],
};

type SaveFn = (operationId: string, payload: CommonLayoutPayload, expectedFingerprint: string) => Promise<void>;

function renderEditor(overrides: {
  layout?: TemplateCommonLayout; fields?: TemplateField[]; onSave?: SaveFn;
} = {}) {
  const onSave = overrides.onSave ?? vi.fn<SaveFn>(async () => {});
  render(<I18nProvider><CommonLayoutEditor
    layout={overrides.layout ?? layout}
    fields={overrides.fields ?? fields}
    sections={sections}
    onSave={onSave}
  /></I18nProvider>);
  return onSave;
}

describe('CommonLayoutEditor — UX-16', () => {
  test('remet une charge complete et une empreinte au serveur, sans modifier les champs', async () => {
    const user = userEvent.setup();
    const onSave = renderEditor();

    const titles = screen.getAllByLabelText('Titre de la rubrique');
    await user.clear(titles[0]);
    await user.type(titles[0], 'Contexte de la consultation');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’organisation' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.any(String),
      {
        defaultKey: 'contexte',
        groups: [
          { key: 'contexte', label: 'Contexte de la consultation', anchor: 0, fields: ['motif', 'diagnostic'] },
          { key: 'synthese', label: 'Synthèse', anchor: 1, fields: ['synthese'] },
        ],
      },
      'before',
    ));
    expect(fields.map((item) => item.section)).toEqual([null, null, null]);
  });

  // T30 : nommer, creer une rubrique, y ranger une variable et la placer apres un bloc.
  test('T30 — le rendu historique se personnalise sans perdre une variable', async () => {
    const user = userEvent.setup();
    const onSave = renderEditor({
      layout: { ...layout, defaultKey: null, groups: [], unassigned: ['motif', 'diagnostic', 'synthese'] },
    });

    await user.click(screen.getByRole('button', { name: 'Personnaliser les rubriques' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter une rubrique' }));
    // La variable change de rubrique par une destination explicite, pas par un glisser-deposer.
    await user.selectOptions(screen.getByLabelText('Déplacer « Synthèse » vers'), 'Nouvelle rubrique');
    await user.selectOptions(screen.getAllByLabelText('Position dans le formulaire')[1], 'Après le bloc « Clinique »');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’organisation' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.any(String), {
      defaultKey: 'tronc_commun',
      groups: [
        { key: 'tronc_commun', label: 'Tronc commun', anchor: 0, fields: ['motif', 'diagnostic'] },
        { key: 'rubrique_1', label: 'Nouvelle rubrique', anchor: 1, fields: ['synthese'] },
      ],
    }, 'before'));
  });

  // T31 : le pilote garde sa relation fonctionnelle. Deplacer l'un sans l'autre casserait la
  // soupape « valeur hors liste » du point de vue du saisisseur.
  test('T31 — la variable diagnostique emmene son compagnon de proposition', async () => {
    const user = userEvent.setup();
    const withCompanion = [
      field('motif', 'Motif', 0),
      field('dx', 'Diagnostic retenu', 1, 'select'),
      field('dx_autre', 'Diagnostic — préciser', 2),
    ];
    const onSave = renderEditor({
      fields: withCompanion,
      layout: {
        ...layout,
        groups: [
          { key: 'contexte', label: 'Contexte initial', anchor: 0, isDefault: true, fields: ['motif', 'dx', 'dx_autre'] },
          { key: 'synthese', label: 'Synthèse', anchor: 1, isDefault: false, fields: [] },
        ],
      },
    });

    // Le lien est annonce AVANT le deplacement : on sait que les deux partiront ensemble.
    const companion = screen.getByText('Diagnostic — préciser').closest('li') as HTMLElement;
    expect(within(companion).getByText(/Déplacée avec sa variable liée/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Déplacer « Diagnostic retenu » vers'), 'Synthèse');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’organisation' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.any(String), {
      defaultKey: 'contexte',
      groups: [
        { key: 'contexte', label: 'Contexte initial', anchor: 0, fields: ['motif'] },
        { key: 'synthese', label: 'Synthèse', anchor: 1, fields: ['dx', 'dx_autre'] },
      ],
    }, 'before'));
  });

  // T33 : un refus ne laisse ni ecriture partielle ni choix perdus, et la reprise est le MEME
  // rejeu idempotent -- une seconde cle creerait une seconde operation serveur.
  test('T33 — un refus conserve les choix locaux et la reprise rejoue la meme operation', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<SaveFn>()
      .mockRejectedValueOnce(Object.assign(new Error('COMMON_LAYOUT_CONFLICT'), {
        detail: JSON.stringify({ code: 'common_layout_conflict', action: 'refresh_required' }),
      }))
      .mockResolvedValueOnce(undefined);
    renderEditor({ onSave });

    const titles = screen.getAllByLabelText('Titre de la rubrique');
    await user.clear(titles[0]);
    await user.type(titles[0], 'Contexte de la consultation');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’organisation' }));

    // Le motif est lisible : jamais le jeton technique du contrat.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/L’organisation a changé depuis l’ouverture de cet écran/);
    expect(alert).not.toHaveTextContent(/COMMON_LAYOUT/);
    // Le titre saisi est toujours la : rien n'a ete recharge par-dessus.
    expect(screen.getAllByLabelText('Titre de la rubrique')[0]).toHaveValue('Contexte de la consultation');

    await user.click(screen.getByRole('button', { name: 'Enregistrer l’organisation' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0]).toBe(onSave.mock.calls[0][0]);
  });

  test('T33 — une version gelee annonce le refus et n\'offre aucune commande d\'enregistrement', () => {
    renderEditor({ layout: { ...layout, locked: true } });

    expect(screen.getByRole('status'))
      .toHaveTextContent(/Cette version est gelée ou déjà utilisée/);
    expect(screen.queryByRole('button', { name: 'Enregistrer l’organisation' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Titre de la rubrique')).not.toBeInTheDocument();
  });
});
