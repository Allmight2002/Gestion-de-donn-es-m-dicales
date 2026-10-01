// @vitest-environment jsdom
// Codage assiste dans le champ de diagnostic : le medecin ecrit comme il pense, MedData
// structure. Le texte n'est jamais perdu, l'ambiguite n'est jamais tranchee en silence, et
// une panne du codage n'empeche jamais d'enregistrer. Diagnostics et codes fictifs.
import 'fake-indexeddb/auto';
import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TerminologyInput } from './TerminologyInput';
import type { TerminologyCodingResult, TerminologyOption, TerminologyRepository } from '../../data/terminology';
import { clearCache } from '../../data/terminologyCache';

const HSD = { code: 'FIC.02', label: 'Hémorragie sousdurale non traumatique', uri: null, score: 1 };
const HIC = { code: 'FIC.00', label: 'Hémorragie intracérébrale', uri: null, score: 0.8 };
const HSA = { code: 'FIC.01', label: 'Hémorragie sous-arachnoïdienne', uri: null, score: 0.8 };
const RAW = 'HSD chronique spontané droit';

const coded = (status: 'automatic' | 'suggested' | 'ambiguous' | 'unmatched', extra = {}): TerminologyCodingResult => ({
  method: 'ai_assisted',
  release: '2026-01',
  language: 'fr',
  items: [{
    normalized: 'Hématome sous-dural chronique spontané droit',
    status,
    score: status === 'unmatched' ? 0.2 : 1,
    best: status === 'unmatched' ? null : HSD,
    alternatives: status === 'ambiguous' ? [HIC, HSA, HSD] : [],
    ...extra,
  }],
});

/** Harnais A ETAT : la reponse du codage s'applique a la valeur courante, comme dans une fiche. */
function renderField(
  repo: Partial<TerminologyRepository>,
  opts: { multiple?: boolean; freeText?: boolean; initial?: unknown } = {},
) {
  const changes: unknown[] = [];
  function Harness() {
    const [value, setValue] = useState<unknown>(opts.initial ?? null);
    return (
      <TerminologyInput
        field={{ label: 'Diagnostic', isMultiple: opts.multiple }}
        value={value}
        freeText={opts.freeText}
        onChange={(v) => { changes.push(v); setValue(v); }}
      />
    );
  }
  render(
    <I18nProvider>
      <RepositoryProvider terminology={{
        search: async () => [],
        activeRelease: async () => null,
        listEntries: async () => ({ entries: [], total: 0 }),
        ...repo,
      } as TerminologyRepository}>
        <Harness />
        <button type="button">Ailleurs</button>
      </RepositoryProvider>
    </I18nProvider>,
  );
  return changes;
}

async function writeAndLeave(text: string) {
  await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), text);
  await userEvent.click(screen.getByRole('button', { name: 'Ailleurs' }));
}

beforeEach(async () => { await clearCache(); });

describe('TerminologyInput — codage assiste', () => {
  test('correspondance claire : le texte est garde, puis code automatiquement', async () => {
    const codeText = vi.fn(async () => coded('automatic'));
    const changes = renderField({ codeText });
    await writeAndLeave(RAW);

    // D'abord le texte, tel qu'ecrit : une sauvegarde pendant l'analyse ne perd rien.
    expect(changes[0]).toEqual({ raw: RAW, coding: { method: 'lexical', status: 'unmatched' } });
    expect(await screen.findByText(/Hémorragie sousdurale non traumatique/)).toBeInTheDocument();
    expect(screen.getByText('FIC.02')).toBeInTheDocument();
    expect(changes.at(-1)).toMatchObject({
      code: 'FIC.02',
      label: HSD.label,
      raw: RAW,
      coding: { method: 'ai_assisted', status: 'automatic', release: '2026-01', language: 'fr' },
    });
    expect(codeText).toHaveBeenCalledWith(RAW);
  });

  test('correspondance probable : proposee, a confirmer explicitement', async () => {
    const changes = renderField({ codeText: async () => coded('suggested', { score: 0.75 }) });
    await writeAndLeave(RAW);
    await userEvent.click(await screen.findByRole('button', { name: `Confirmer ${HSD.label}` }));
    expect(changes.at(-1)).toMatchObject({ code: 'FIC.02', raw: RAW, coding: { status: 'confirmed' } });
  });

  test('plusieurs correspondances : rien n est impose, l utilisateur choisit', async () => {
    const changes = renderField({ codeText: async () => coded('ambiguous') });
    await writeAndLeave('Hémorragie intracrânienne spontanée');

    expect(await screen.findByText('Plusieurs correspondances possibles :')).toBeInTheDocument();
    expect(changes.at(-1)).not.toHaveProperty('code');
    await userEvent.click(screen.getByRole('button', { name: `○ ${HSA.label}` }));
    expect(changes.at(-1)).toMatchObject({
      code: 'FIC.01',
      raw: 'Hémorragie intracrânienne spontanée',
      coding: { status: 'confirmed' },
    });
  });

  test('aucune correspondance fiable : le texte reste la valeur, non code', async () => {
    const changes = renderField({ codeText: async () => coded('unmatched') });
    await writeAndLeave('Syndrome fictif de test');
    expect(await screen.findByText('Aucune correspondance CIM-11 fiable trouvée.')).toBeInTheDocument();
    expect(changes.at(-1)).toMatchObject({ raw: 'Syndrome fictif de test', coding: { status: 'unmatched' } });
  });

  test('panne du codage : le diagnostic ecrit est conserve et la panne annoncee', async () => {
    const changes = renderField({ codeText: async () => { throw new Error('indisponible'); } });
    await writeAndLeave(RAW);
    expect(await screen.findByText(/Codage indisponible pour le moment/)).toBeInTheDocument();
    expect(changes.at(-1)).toEqual({ raw: RAW, coding: { method: 'lexical', status: 'unmatched' } });
  });

  test('liste : chaque diagnostic reconnu devient une entree numerotee', async () => {
    const changes = renderField({
      codeText: async () => ({
        ...coded('automatic'),
        items: [coded('automatic').items[0], { ...coded('automatic').items[0], normalized: 'HIC', best: HIC }],
      }),
    }, { multiple: true });
    await writeAndLeave('HSD droit et HIC gauche');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect((changes.at(-1) as Array<{ code: string }>).map((e) => e.code)).toEqual(['FIC.02', 'FIC.00']);
  });

  test('la recherche classique reste disponible : un clic sur une proposition ne code pas le texte', async () => {
    const option: TerminologyOption = { id: 'o1', code: 'FIC.10', label: 'Méningiomes', kind: 'category', depth: 3 };
    const codeText = vi.fn(async () => coded('automatic'));
    const changes = renderField({ search: async () => [option], codeText });
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), 'méning');
    await userEvent.click(await screen.findByRole('option', { name: 'Méningiomes' }));
    expect(changes).toEqual([{ code: 'FIC.10', label: 'Méningiomes' }]);
    expect(codeText).not.toHaveBeenCalled();
  });

  test('critere de recherche : aucun texte libre ni codage', async () => {
    const codeText = vi.fn(async () => coded('automatic'));
    const changes = renderField({ codeText }, { multiple: true, freeText: false });
    await writeAndLeave(RAW);
    expect(changes).toEqual([]);
    expect(codeText).not.toHaveBeenCalled();
  });

  test('Entree valide le texte sans soumettre le formulaire', async () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    const changes: unknown[] = [];
    render(
      <I18nProvider>
        <RepositoryProvider terminology={{
          search: async () => [],
          activeRelease: async () => null,
          listEntries: async () => ({ entries: [], total: 0 }),
        } as TerminologyRepository}>
          <form onSubmit={(e) => submit(e.nativeEvent)}>
            <TerminologyInput field={{ label: 'Diagnostic' }} value={null} onChange={(v) => changes.push(v)} />
          </form>
        </RepositoryProvider>
      </I18nProvider>,
    );
    await userEvent.type(screen.getByRole('combobox', { name: 'Diagnostic' }), `${RAW}{Enter}`);
    expect(submit).not.toHaveBeenCalled();
    // Sans service de codage, le texte est conserve tel quel.
    expect(changes[0]).toEqual({ raw: RAW, coding: { method: 'lexical', status: 'unmatched' } });
  });

  test('reouverture : les propositions d une entree non codee sont restaurees, la valeur intacte', async () => {
    const stored = {
      raw: 'Hémorragie intracrânienne spontanée',
      coding: { method: 'ai_assisted', status: 'unmatched', normalized: 'Hématome sous-dural chronique spontané droit', language: 'fr' },
    };
    const codeText = vi.fn(async () => coded('ambiguous'));
    const changes = renderField({ codeText }, { initial: stored });

    expect(await screen.findByText('Plusieurs correspondances possibles :')).toBeInTheDocument();
    expect(codeText).toHaveBeenCalledTimes(1);
    expect(codeText).toHaveBeenCalledWith(stored.raw);
    // Rien n'est ecrit tant que le medecin n'a pas choisi.
    expect(changes).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: `○ ${HSA.label}` }));
    expect(changes.at(-1)).toMatchObject({ code: 'FIC.01', raw: stored.raw, coding: { status: 'confirmed' } });
  });

  test('reouverture : une saisie conservee hors connexion n est pas reanalysee en silence', async () => {
    const codeText = vi.fn(async () => coded('automatic'));
    const changes = renderField({ codeText }, { initial: { raw: RAW, coding: { method: 'lexical', status: 'unmatched' } } });
    expect(await screen.findByText(RAW)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(codeText).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  test('reouverture : une saisie hors connexion peut etre reanalysee sur demande, sans rien imposer', async () => {
    const stored = { raw: RAW, coding: { method: 'lexical', status: 'unmatched' } };
    const codeText = vi.fn(async () => coded('automatic'));
    const changes = renderField({ codeText }, { initial: stored });

    await userEvent.click(await screen.findByRole('button', { name: 'Rechercher une correspondance' }));
    expect(codeText).toHaveBeenCalledWith(RAW);
    // Meme une correspondance claire reste une proposition : la valeur ne change pas.
    expect(await screen.findByRole('button', { name: `○ ${HSD.label}` })).toBeInTheDocument();
    expect(changes).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: `○ ${HSD.label}` }));
    expect(changes.at(-1)).toMatchObject({
      code: HSD.code, label: HSD.label, raw: RAW,
      coding: { method: 'ai_assisted', status: 'confirmed', normalized: 'Hématome sous-dural chronique spontané droit', release: '2026-01' },
    });
  });

  test('reanalyse sans correspondance ou en panne : le texte reste, la situation est dite', async () => {
    const stored = { raw: RAW, coding: { method: 'lexical', status: 'unmatched' } };
    const codeText = vi.fn(async () => coded('unmatched'));
    const changes = renderField({ codeText }, { initial: stored });
    await userEvent.click(await screen.findByRole('button', { name: 'Rechercher une correspondance' }));
    expect(await screen.findByText('Aucune correspondance CIM-11 fiable trouvée.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechercher une correspondance' })).toBeNull();
    expect(changes).toEqual([]);
  });

  test('reanalyse impossible : panne annoncee, valeur intacte', async () => {
    const stored = { raw: RAW, coding: { method: 'lexical', status: 'unmatched' } };
    const codeText = vi.fn(async (): Promise<TerminologyCodingResult> => { throw new Error('panne fictive'); });
    const changes = renderField({ codeText }, { initial: stored });
    await userEvent.click(await screen.findByRole('button', { name: 'Rechercher une correspondance' }));
    expect(await screen.findByText(/Codage indisponible pour le moment/)).toBeInTheDocument();
    expect(changes).toEqual([]);
  });
});
