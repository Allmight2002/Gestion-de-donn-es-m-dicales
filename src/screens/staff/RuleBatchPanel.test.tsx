// @vitest-environment jsdom
// UX-14(c) côté écran : la condition est reprise d'une règle existante, les cibles se
// choisissent sans perdre la sélection, et rien n'est annoncé créé avant le reçu du serveur.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RuleBatchPanel } from './RuleBatchPanel';
import type { TemplateRepository } from '../../data/templates';
import type { RuleBatchPayload, RuleBatchPlan, RuleBatchReceipt, TemplateField, TemplateSection, ValidationRule } from '../../data/types';

const sections: TemplateSection[] = [
  { id: 's1', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 },
];

function field(key: string, label: string): TemplateField {
  return {
    id: key, fieldKey: key, label, scope: 'encounter', section: 'clinique', type: 'text',
    unit: null, allowedValues: null, required: false, minValue: null, maxValue: null,
    allowMissingCodes: false, displayOrder: 0,
  };
}

const fields: TemplateField[] = [
  field('chirurgie', 'Chirurgie réalisée'),
  field('date_intervention', 'Date d’intervention'),
  field('technique', 'Technique opératoire'),
  field('operateur', 'Opérateur'),
  field('commentaire', 'Commentaire libre'),
];

const source: ValidationRule = {
  id: 'r1',
  rule: { if: { field: 'chirurgie', operator: 'equals', value: 'oui' }, then: { field: 'date_intervention', operator: 'required' } },
  message: null,
  severity: 'block',
};

const plan = (over: Partial<RuleBatchPlan> = {}): RuleBatchPlan => ({
  fingerprint: 'empreinte-1', severity: 'block', create: [], duplicates: [], invalid: [],
  locked: false, inUse: false, ...over,
});

function renderPanel(repo: Partial<TemplateRepository>, onApplied = vi.fn()) {
  render(
    <I18nProvider>
      <RuleBatchPanel
        versionId="v1"
        source={source}
        fields={fields}
        sections={sections}
        repo={repo as TemplateRepository}
        onClose={() => {}}
        onApplied={onApplied}
      />
    </I18nProvider>,
  );
  return onApplied;
}

describe('RuleBatchPanel (UX-14(c))', () => {
  test('T27 : filtrer ne perd pas la sélection et la confirmation est un seul geste', async () => {
    const user = userEvent.setup();
    const previewRuleBatch = vi.fn(async (_v: string, payload: { targets: string[] }): Promise<RuleBatchPlan> => plan({
      create: payload.targets.filter((target) => target !== 'date_intervention').map((target) => ({ target })),
      duplicates: payload.targets.includes('date_intervention') ? [{ target: 'date_intervention', ruleId: 'r1' }] : [],
    }));
    const createRuleBatch = vi.fn(async (
      _version: string, _operation: string, _payload: RuleBatchPayload, _fingerprint: string,
    ): Promise<RuleBatchReceipt> => ({
      created: [{ id: 'n1', target: 'technique' }, { id: 'n2', target: 'operateur' }],
      duplicates: [{ target: 'date_intervention', ruleId: 'r1' }],
      fingerprint: 'empreinte-2',
    }));
    const onApplied = renderPanel({ previewRuleBatch, createRuleBatch });

    await user.click(screen.getByRole('checkbox', { name: /Technique opératoire/ }));
    // La recherche masque la variable déjà cochée : elle reste sélectionnée et récapitulée.
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher une variable' }), 'Opérateur');
    expect(screen.queryByRole('checkbox', { name: /Technique opératoire/ })).not.toBeInTheDocument();
    expect(screen.getByText('1 variable(s) sélectionnée(s)')).toBeInTheDocument();
    // « Sélectionner les résultats » annonce exactement combien, sans toucher aux masquées.
    await user.click(screen.getByRole('button', { name: 'Sélectionner les 1 variables affichées' }));
    expect(screen.getByText('2 variable(s) sélectionnée(s)')).toBeInTheDocument();

    const confirmer = await screen.findByRole('button', { name: 'Créer les 2 règles' });
    await waitFor(() => expect(previewRuleBatch).toHaveBeenCalled());
    await user.click(confirmer);

    await waitFor(() => expect(createRuleBatch).toHaveBeenCalledTimes(1));
    // L'empreinte présentée est celle de l'aperçu : le serveur refuse une version modifiée.
    expect(createRuleBatch.mock.calls[0][3]).toBe('empreinte-1');
    expect(createRuleBatch.mock.calls[0][2]).toMatchObject({
      effect: 'required', targets: ['technique', 'operateur'],
      condition: { field: 'chirurgie', operator: 'equals', value: 'oui' },
    });
    // Le bilan vient du REÇU serveur, jamais d'une estimation locale.
    expect(await screen.findByRole('status'))
      .toHaveTextContent('2 règle(s) créée(s), 1 règle(s) identique(s) déjà présente(s).');
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  test('T28 : une cible refusée bloque la confirmation et donne son motif', async () => {
    const user = userEvent.setup();
    // Le serveur juge chaque cible : le refus disparaît dès que la cible fautive est retirée.
    const previewRuleBatch = vi.fn(async (_v: string, payload: { targets: string[] }): Promise<RuleBatchPlan> => plan({
      create: payload.targets.filter((target) => target !== 'commentaire').map((target) => ({ target })),
      invalid: payload.targets.includes('commentaire')
        ? [{ target: 'commentaire', reason: 'Champ inconnu dans la regle (then) : commentaire' }]
        : [],
    }));
    const createRuleBatch = vi.fn();
    renderPanel({ previewRuleBatch, createRuleBatch });

    await user.click(screen.getByRole('checkbox', { name: /Technique opératoire/ }));
    await user.click(screen.getByRole('checkbox', { name: /Commentaire libre/ }));

    const refus = await screen.findByRole('alert');
    expect(refus).toHaveTextContent('Commentaire libre');
    expect(refus).toHaveTextContent(/Champ inconnu/);
    expect(screen.getByRole('button', { name: /Créer les/ })).toBeDisabled();
    expect(createRuleBatch).not.toHaveBeenCalled();

    // Retirer la cible refusée débloque la confirmation, sans reprendre la condition.
    await user.click(within(refus).getByRole('button', { name: 'Retirer Commentaire libre' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Créer les 1 règles' })).toBeEnabled());
  });

  test('T29 : un conflit conserve condition et cibles, et le rejeu garde la même clé', async () => {
    const user = userEvent.setup();
    let fingerprint = 'empreinte-1';
    const previewRuleBatch = vi.fn(async (): Promise<RuleBatchPlan> => plan({ fingerprint, create: [{ target: 'technique' }] }));
    const conflit = Object.assign(new Error('RULE_BATCH_CONFLICT'), {
      details: JSON.stringify({ code: 'rule_batch_conflict', action: 'refresh_required' }),
    });
    // Le refus vient justement d'une version modifiée entre-temps : l'empreinte change au
    // moment du conflit, et l'aperçu rejoué doit rapporter la nouvelle.
    const createRuleBatch = vi.fn()
      .mockImplementationOnce(async () => { fingerprint = 'empreinte-3'; throw conflit; })
      .mockResolvedValueOnce({ created: [{ id: 'n1', target: 'technique' }], duplicates: [], fingerprint: 'empreinte-4' });
    renderPanel({ previewRuleBatch, createRuleBatch });

    await user.click(screen.getByRole('checkbox', { name: /Technique opératoire/ }));
    await user.click(await screen.findByRole('button', { name: 'Créer les 1 règles' }));

    expect(await screen.findByText(/La condition et les cibles sont conservées/)).toBeInTheDocument();
    expect(screen.getByText('1 variable(s) sélectionnée(s)')).toBeInTheDocument();
    await waitFor(() => expect(previewRuleBatch).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'Créer les 1 règles' }));
    await waitFor(() => expect(createRuleBatch).toHaveBeenCalledTimes(2));
    // Même charge, donc MÊME clé d'opération : le rejeu ne crée jamais un second lot.
    expect(createRuleBatch.mock.calls[1][1]).toBe(createRuleBatch.mock.calls[0][1]);
    // L'empreinte, elle, est celle de l'aperçu actualisé.
    expect(createRuleBatch.mock.calls[1][3]).toBe('empreinte-3');
  });

  test('une version gelée annonce le refus au lieu de promettre une création', async () => {
    const user = userEvent.setup();
    const previewRuleBatch = vi.fn(async (): Promise<RuleBatchPlan> => plan({ create: [{ target: 'technique' }], inUse: true }));
    renderPanel({ previewRuleBatch, createRuleBatch: vi.fn() });

    await user.click(screen.getByRole('checkbox', { name: /Technique opératoire/ }));
    expect(await screen.findByText(/déjà utilisée par des dossiers/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer les/ })).toBeDisabled();
  });

  test('les cibles sont groupées par section et les règles créées restent atteignables', async () => {
    const user = userEvent.setup();
    const onOpenRule = vi.fn();
    const previewRuleBatch = vi.fn(async (_v: string, payload: { targets: string[] }): Promise<RuleBatchPlan> => plan({
      create: payload.targets.map((target) => ({ target })),
    }));
    const createRuleBatch = vi.fn(async (): Promise<RuleBatchReceipt> => ({
      created: [{ id: 'n1', target: 'technique' }], duplicates: [], fingerprint: 'empreinte-2',
    }));
    render(
      <I18nProvider>
        <RuleBatchPanel
          versionId="v1" source={source} fields={fields} sections={sections}
          repo={{ previewRuleBatch, createRuleBatch } as unknown as TemplateRepository}
          onClose={() => {}} onApplied={() => {}} onOpenRule={onOpenRule}
        />
      </I18nProvider>,
    );

    // Sur un gros modèle, une liste plate ne dit pas d'où vient une variable.
    expect(screen.getByText('Clinique')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Technique opératoire/ }));
    await user.click(await screen.findByRole('button', { name: 'Créer les 1 règles' }));

    // Le lot ne se termine pas sur un cul-de-sac : la règle créée s'ouvre dans la liste.
    await user.click(await screen.findByRole('button', { name: 'Technique opératoire' }));
    expect(onOpenRule).toHaveBeenCalledWith('n1');
  });
});
