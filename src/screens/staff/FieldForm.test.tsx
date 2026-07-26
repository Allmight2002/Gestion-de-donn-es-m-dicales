// @vitest-environment jsdom
// F4 : le formulaire de variable doit permettre de GARNIR une liste controlee sans la taper
// entierement a la main — sinon l'utilisateur retombe sur du texte libre, donc sur des donnees
// non analysables.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { FieldForm } from './FieldForm';

function renderForm(onSubmit = vi.fn()) {
  render(
    <I18nProvider>
      <FieldForm onSubmit={onSubmit} />
    </I18nProvider>,
  );
  return onSubmit;
}

async function chooseSelectType() {
  await userEvent.selectOptions(screen.getByLabelText('Type'), 'select');
}

describe('FieldForm — jeux de valeurs (F4)', () => {
  test('les listes pretes a l emploi n apparaissent que pour un champ a choix', async () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Insérer' })).toBeNull();
    await chooseSelectType();
    expect(screen.getByRole('button', { name: 'Insérer' })).toBeInTheDocument();
  });

  test('inserer une liste remplit les valeurs autorisees et les compte', async () => {
    renderForm();
    await chooseSelectType();
    await userEvent.selectOptions(screen.getByLabelText("Liste prête à l'emploi"), 'oui-non-inconnu');
    await userEvent.click(screen.getByRole('button', { name: 'Insérer' }));

    expect(screen.getByLabelText('Valeurs autorisées')).toHaveValue('Oui\nNon\nInconnu');
    expect(screen.getByText('3 valeur(s) définie(s)')).toBeInTheDocument();
  });

  test('l insertion complete la saisie existante au lieu de l ecraser', async () => {
    renderForm();
    await chooseSelectType();
    await userEvent.type(screen.getByLabelText('Valeurs autorisées'), 'Oui');
    await userEvent.selectOptions(screen.getByLabelText("Liste prête à l'emploi"), 'oui-non-inconnu');
    await userEvent.click(screen.getByRole('button', { name: 'Insérer' }));

    expect(screen.getByLabelText('Valeurs autorisées')).toHaveValue('Oui\nNon\nInconnu');
  });

  test('les valeurs inserees sont transmises au gabarit une par une', async () => {
    const onSubmit = renderForm();
    await chooseSelectType();
    await userEvent.type(screen.getByLabelText('Clé technique'), 'issue');
    await userEvent.type(screen.getByLabelText('Libellé'), 'Issue');
    await userEvent.selectOptions(screen.getByLabelText("Liste prête à l'emploi"), 'oui-non-inconnu');
    await userEvent.click(screen.getByRole('button', { name: 'Insérer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ fieldKey: 'issue', type: 'select', allowedValues: ['Oui', 'Non', 'Inconnu'] }),
    );
  });
});
