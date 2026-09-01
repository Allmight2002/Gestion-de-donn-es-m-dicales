// @vitest-environment jsdom
// F6 : la saisie d'un diagnostic passe par une recherche, jamais par du texte libre, et
// c'est le couple code + libelle qui remonte — le code seul serait illisible, le libelle
// seul casserait les statistiques au premier renommage.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TerminologyInput } from './TerminologyInput';
import type { TerminologyOption, TerminologyRepository } from '../../data/terminology';
import { clearCache, downloadReference } from '../../data/terminologyCache';

const CHOLERA: TerminologyOption = { id: 'c1', code: '1A00', label: 'Cholera', kind: 'category', depth: 3 };
const DIABETE: TerminologyOption = { id: 'c2', code: '5A11', label: 'Diabete de type 2', kind: 'category', depth: 3 };
const RELEASE = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'diagnostics-fr',
  version: '1',
  conceptCount: 1,
};

function renderInput(repo: Partial<TerminologyRepository>, value: unknown = null, isMultiple = false) {
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <RepositoryProvider terminology={{
        search: async () => [],
        activeRelease: async () => RELEASE,
        listEntries: async () => ({ entries: [], total: 0 }),
        ...repo,
      } as TerminologyRepository}>
        <TerminologyInput field={{ label: 'Diagnostic', isMultiple }} value={value} onChange={onChange} />
      </RepositoryProvider>
    </I18nProvider>,
  );
  return onChange;
}

beforeEach(async () => { await clearCache(); });

// L21 : un patient porte souvent plusieurs diagnostics. Le RANG porte la convention « le
// premier est le principal », donc l'ordre de saisie ne se retrie jamais.
//
// Ce bloc passe AVANT celui de F6, et ce n'est pas cosmetique : les tests de copie locale
// achevent leur telechargement apres leur propre fin, et cette ecriture tardive retombe dans
// le test suivant, qui chercherait alors dans une copie locale au lieu du serveur.
describe('TerminologyInput — listes de diagnostics (L21)', () => {
  const CHOLERA_V = { code: CHOLERA.code, label: CHOLERA.label };
  const DIABETE_V = { code: DIABETE.code, label: DIABETE.label };

  test('les valeurs choisies s affichent numerotees, dans l ordre de saisie', () => {
    renderInput({}, [CHOLERA_V, DIABETE_V], true);
    const etiquettes = screen.getAllByRole('listitem');

    expect(etiquettes).toHaveLength(2);
    expect(etiquettes[0]).toHaveTextContent('1.');
    expect(etiquettes[0]).toHaveTextContent('Cholera');
    expect(etiquettes[1]).toHaveTextContent('2.');
    expect(etiquettes[1]).toHaveTextContent('Diabete de type 2');
    expect(screen.getByText('Le premier diagnostic de la liste est le diagnostic principal.')).toBeInTheDocument();
  });

  // Le mode unitaire REMPLACE la recherche par une etiquette ; en liste elle doit rester,
  // sinon ajouter un diagnostic obligerait a en retirer un autre.
  test('la zone de recherche reste visible sous les etiquettes', () => {
    renderInput({}, [CHOLERA_V], true);
    expect(screen.getByRole('combobox', { name: 'Diagnostic' })).toBeInTheDocument();
  });

  test('choisir un second diagnostic l ajoute a la fin de la liste', async () => {
    const onChange = renderInput({ search: async () => [DIABETE] }, [CHOLERA_V], true);
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), 'di');
    await userEvent.click(await screen.findByRole('option', { name: 'Diabete de type 2' }));

    expect(onChange).toHaveBeenCalledWith([CHOLERA_V, DIABETE_V]);
  });

  test('un concept deja choisi n est plus propose', async () => {
    renderInput({ search: async () => [CHOLERA, DIABETE] }, [CHOLERA_V], true);
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), 'ch');

    expect(await screen.findByRole('option', { name: 'Diabete de type 2' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cholera' })).toBeNull();
  });

  test('retirer une valeur conserve les autres et leur ordre', async () => {
    const onChange = renderInput({}, [CHOLERA_V, DIABETE_V], true);
    await userEvent.click(screen.getByRole('button', { name: 'Retirer Cholera' }));

    expect(onChange).toHaveBeenCalledWith([DIABETE_V]);
  });

  // Le point a ne pas rater : la base refuse le tableau vide, deliberement. Le client doit
  // demander le RETRAIT de la variable, jamais ecrire `[]`.
  test('retirer la derniere valeur demande la suppression au lieu d ecrire un tableau vide', async () => {
    const onChange = renderInput({}, [CHOLERA_V], true);
    await userEvent.click(screen.getByRole('button', { name: 'Retirer Cholera' }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith([]);
  });

  test('le mode unitaire n est pas touche : la valeur reste une etiquette sans recherche', () => {
    renderInput({}, CHOLERA_V);
    expect(screen.getByText('Cholera')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

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

  test('une copie perimee en ligne est ignoree au profit de la recherche serveur', async () => {
    await downloadReference({
      search: async () => [],
      activeRelease: async () => RELEASE,
      listEntries: async () => ({
        entries: [{ code: CHOLERA.code, label: CHOLERA.label, searchText: 'cholera' }],
        total: 1,
      }),
    });
    const search = vi.fn(async () => [DIABETE]);
    renderInput({
      search,
      activeRelease: async () => ({ ...RELEASE, id: '00000000-0000-4000-8000-000000000002' }),
    });
    await screen.findByRole('button', { name: 'Télécharger pour rechercher hors connexion' });
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), 'di');
    expect(await screen.findByRole('option', { name: DIABETE.label })).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith('di');
  });

  test('rafraichit automatiquement une copie perimee et le signale au-dessus de la recherche', async () => {
    await downloadReference({
      search: async () => [],
      activeRelease: async () => RELEASE,
      listEntries: async () => ({
        entries: [{ code: CHOLERA.code, label: CHOLERA.label, searchText: 'cholera' }], total: 1,
      }),
    });
    let finishDownload: (() => void) | undefined;
    const page = new Promise<{ entries: { code: string; label: string; searchText: string }[]; total: number }>((resolve) => { finishDownload = () => resolve({ entries: [{ code: CHOLERA.code, label: CHOLERA.label, searchText: 'cholera' }], total: 1 }); });
    renderInput({
      activeRelease: async () => ({ ...RELEASE, id: '00000000-0000-4000-8000-000000000002' }),
      listEntries: async () => page,
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Mise à jour de la copie locale des diagnostics');
    expect(screen.getByRole('status').compareDocumentPosition(screen.getByRole('combobox')) & 4).toBeTruthy();
    finishDownload?.();
    expect(await screen.findByText('Recherche hors connexion disponible.')).toBeInTheDocument();
  });

  test('annonce hors ligne qu une copie perimee sera rafraichie au retour du reseau', async () => {
    await downloadReference({
      search: async () => [],
      activeRelease: async () => RELEASE,
      listEntries: async () => ({
        entries: [{ code: CHOLERA.code, label: CHOLERA.label, searchText: 'cholera' }], total: 1,
      }),
    });
    let finishDownload: (() => void) | undefined;
    const page = new Promise<{ entries: { code: string; label: string; searchText: string }[]; total: number }>((resolve) => { finishDownload = () => resolve({ entries: [{ code: CHOLERA.code, label: CHOLERA.label, searchText: 'cholera' }], total: 1 }); });
    renderInput({
      activeRelease: async () => ({ ...RELEASE, id: '00000000-0000-4000-8000-000000000002' }),
      listEntries: async () => page,
    });
    await screen.findByRole('status');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));

    expect(await screen.findByText('La copie locale des diagnostics doit être mise à jour dès le retour du réseau.')).toBeInTheDocument();
    finishDownload?.();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
  });
});

