// @vitest-environment jsdom
// F6 : la saisie d'un diagnostic passe par une recherche, jamais par du texte libre, et
// c'est le couple code + libelle qui remonte — le code seul serait illisible, le libelle
// seul casserait les statistiques au premier renommage.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TerminologyInput } from './TerminologyInput';
import type { TerminologyOption, TerminologyRepository } from '../../data/terminology';

const CHOLERA: TerminologyOption = { id: 'c1', code: '1A00', label: 'Cholera', kind: 'category', depth: 3 };
const DIABETE: TerminologyOption = { id: 'c2', code: '5A11', label: 'Diabete de type 2', kind: 'category', depth: 3 };

function renderInput(repo: Partial<TerminologyRepository>, value: unknown = null) {
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <RepositoryProvider terminology={{ search: async () => [], ...repo } as TerminologyRepository}>
        <TerminologyInput field={{ label: 'Diagnostic' }} value={value} onChange={onChange} />
      </RepositoryProvider>
    </I18nProvider>,
  );
  return onChange;
}

describe('TerminologyInput (F6)', () => {
  test('ne consulte pas le serveur en deca de deux caracteres', async () => {
    const search = vi.fn(async () => [CHOLERA]);
    renderInput({ search });
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), 'c');

    expect(await screen.findByText('Saisissez au moins 2 caractères.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();
  });

  test('propose les resultats de la recherche', async () => {
    renderInput({ search: async () => [CHOLERA, DIABETE] });
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), 'ch');

    expect(await screen.findByRole('option', { name: 'Cholera' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Diabete de type 2' })).toBeInTheDocument();
  });

  test('choisir une proposition remonte le couple code et libelle', async () => {
    const onChange = renderInput({ search: async () => [CHOLERA] });
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), 'ch');
    await userEvent.click(await screen.findByRole('option', { name: 'Cholera' }));

    expect(onChange).toHaveBeenCalledWith({ code: '1A00', label: 'Cholera' });
  });

  test('une valeur deja choisie s affiche par son libelle et reste modifiable', async () => {
    const onChange = renderInput({}, { code: '1A00', label: 'Cholera' });
    expect(screen.getByText('Cholera')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Changer' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  test('une recherche sans resultat le dit au lieu de rester muette', async () => {
    renderInput({ search: async () => [] });
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), 'zzz');
    expect(await screen.findByText(/Aucun diagnostic trouvé/)).toBeInTheDocument();
  });

  test('une panne de recherche est annoncee, pas silencieuse', async () => {
    renderInput({ search: async () => { throw new Error('Reseau indisponible'); } });
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), 'ch');
    expect(await screen.findByRole('alert')).toHaveTextContent('Reseau indisponible');
  });

  // Sur une connexion lente, une reponse ancienne peut arriver apres une plus recente :
  // afficher la premiere donnerait des propositions sans rapport avec ce qui est tape.
  test('une reponse tardive ne remplace pas le resultat de la derniere frappe', async () => {
    const search = vi.fn(async (q: string) => {
      if (q === 'ch') { await new Promise((r) => setTimeout(r, 300)); return [CHOLERA]; }
      return [DIABETE];
    });
    renderInput({ search });
    const box = screen.getByRole('combobox', { name: 'Diagnostic' });
    await userEvent.type(box, 'ch');
    await userEvent.type(box, 'di');

    expect(await screen.findByRole('option', { name: 'Diabete de type 2' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Cholera' })).toBeNull());
  });
});
