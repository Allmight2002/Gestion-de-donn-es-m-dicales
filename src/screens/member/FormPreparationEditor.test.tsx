// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { BaseListing } from '../../data/bases';
import type {
  FormDefinition,
  FormPreparation,
  FormPreparationOpenResult,
  FormPreparationReceipt,
  FormPreparationRepository,
  FormPreparationSave,
} from '../../data/formPreparations';
import type { TemplateField, TemplateSection, TemplateVersion } from '../../data/types';
import type { TemplateRepository } from '../../data/templates';
import { FormPreparationError } from '../../data/formPreparations';
import { FormPreparationEditor } from './FormPreparationEditor';

const version: TemplateVersion = {
  id: 'version-source', templateId: 'template-source', versionNumber: 4, status: 'published',
  diagnosisConfiguration: [], diagnosisContext: [],
};

const sections: TemplateSection[] = [
  { id: 'section-clinical', sectionKey: 'clinical', label: 'Clinique', displayOrder: 0, parentSectionKey: null },
];

const fields: TemplateField[] = [{
  id: 'field-weight', fieldKey: 'weight', label: 'Poids', scope: 'encounter', section: 'clinical',
  sectionId: 'section-clinical', sectionLabel: 'Clinique', sectionOrder: 0, parentSectionKey: null,
  type: 'number', unit: 'kg', allowedValues: null, allowedOptions: null, required: false,
  minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, encounterTypes: null,
}];

const definition: FormDefinition = {
  sections: [{ sectionKey: 'clinical', label: 'Clinique', displayOrder: 0, parentSectionKey: null }],
  commonGroups: [],
  fields: [{
    fieldKey: 'weight', label: 'Poids', scope: 'encounter', sectionKey: 'clinical', type: 'number',
    unit: 'kg', allowedValues: null, allowedOptions: null, required: false, minValue: null, maxValue: null,
    allowMissingCodes: false, displayOrder: 0, encounterTypes: null, description: null, defaultValue: null,
    missingReasons: null, isMultiple: false, formula: null, commonGroupKey: null,
  }],
  rules: [],
  diagnosisConfiguration: [],
};

const source = { version, fields, rules: [], sections };
const listing: BaseListing = {
  base: {
    id: 'base-1', name: 'Registre fictif', specialty: null, ownerUserId: 'owner-1',
    currentTemplateVersionId: version.id, observationModel: 'longitudinal',
  },
  role: 'owner',
  permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
  templateName: 'Registre fictif', versionNumber: version.versionNumber,
};

function preparation(payload: FormDefinition, state: FormPreparation['state'] = 'active', revision = 1): FormPreparation {
  return {
    id: 'preparation-1', baseId: 'base-1', sourceTemplateVersionId: version.id,
    sourceRevision: 7, sourceFingerprint: 'sha256:source-fingerprint', preparationRevision: revision,
    contentFingerprint: 'sha256:content-fingerprint', classification: 'additive', state,
    createdAt: '2026-09-17T08:00:00.000Z', updatedAt: '2026-09-17T08:00:00.000Z',
    expiresAt: '2026-09-18T08:00:00.000Z', payload,
  };
}

function receipt(
  next: FormPreparation,
  operationId: string,
  operationKind: FormPreparationReceipt['operationKind'],
  impact?: Record<string, unknown>,
  application?: Record<string, unknown>,
): FormPreparationReceipt {
  return {
    preparation: next,
    operationId,
    operationKind,
    audit: {
      sourceRevision: next.sourceRevision, sourceFingerprint: next.sourceFingerprint,
      contentFingerprint: next.contentFingerprint, preparationRevision: next.preparationRevision,
      state: next.state, classification: next.classification,
    },
    ...(impact ? { impact } : {}),
    ...(application ? { application } : {}),
  };
}

function openResult(next: FormPreparation | null = null): FormPreparationOpenResult {
  return {
    preparation: next,
    persisted: next !== null,
    context: {
      baseId: 'base-1', sourceTemplateVersionId: version.id, sourceRevision: 7,
      sourceFingerprint: 'sha256:source-fingerprint', definition,
    },
  };
}

function makePreparationRepository(options: {
  initial?: FormPreparation | null;
  save?: (input: FormPreparationSave) => Promise<FormPreparationReceipt>;
  preview?: FormPreparationRepository['preview'];
  apply?: FormPreparationRepository['apply'];
} = {}): FormPreparationRepository {
  let current = options.initial ?? null;
  const repository = {
    available: true,
    openOrResume: vi.fn(async () => openResult(current)),
    read: vi.fn(async () => current!),
    save: vi.fn(async (input: FormPreparationSave) => {
      if (options.save) return options.save(input);
      current = preparation(input.payload, 'active', (current?.preparationRevision ?? 0) + 1);
      return receipt(current, input.operationId, 'save');
    }),
    preview: vi.fn(async (...args: Parameters<NonNullable<typeof options.preview>>) => {
      if (options.preview) return options.preview(...args);
      current = preparation(current!.payload, 'ready', current!.preparationRevision + 1);
      return receipt(current, args[0].operationId, 'preview', {
        serverCounts: { patients: 2, encounters: 3 },
        addedFields: ['weight'], addedSections: [], addedCommonGroups: [], addedRules: [], addedDiagnosisAssociations: [],
        clinicalWrites: { patients: 0, encounters: 0, values: 0 }, identityWrites: 0, documentWrites: 0,
      });
    }),
    apply: vi.fn(async (...args: Parameters<NonNullable<typeof options.apply>>) => {
      if (options.apply) return options.apply(...args);
      current = preparation(current!.payload, 'applied', current!.preparationRevision + 1);
      return receipt(current, args[0].operationId, 'apply', undefined, { baseId: 'base-1', targetRevision: 8 });
    }),
    resume: vi.fn(async (input) => {
      current = preparation(current!.payload, 'active', current!.preparationRevision + 1);
      return receipt(current, input.operationId, 'resume');
    }),
    discard: vi.fn(async (input) => {
      current = preparation(current!.payload, 'discarded', current!.preparationRevision + 1);
      return receipt(current, input.operationId, 'discard');
    }),
    issuePurgeChallenge: vi.fn(async () => ({ challengeId: 'not-used', baseId: 'base-1', expiresAt: '', code: 'K7M3R' })),
    preparePurgeChallenge: vi.fn(async () => ({ challengeId: 'not-used', baseId: 'base-1', expiresAt: '' })),
    confirmPurgeChallenge: vi.fn(async () => ({ confirmed: true as const, baseId: 'base-1', challengeId: 'not-used', operationId: 'not-used' })),
  } as unknown as FormPreparationRepository;
  return repository;
}

function renderEditor(repository: FormPreparationRepository, templates: TemplateRepository = {
  getVersion: vi.fn(async () => source),
} as unknown as TemplateRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider templates={templates} formPreparations={repository}>
        <FormPreparationEditor baseId="base-1" listing={listing} onBack={() => undefined} />
      </RepositoryProvider>
    </I18nProvider>,
  );
}

async function openLocalEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Modifier le formulaire' }));
  expect(await screen.findByRole('heading', { name: 'Registre fictif' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Toutes les variables/ }));
  const row = await screen.findByRole('row', { name: /Poids/ });
  await user.click(within(row).getByRole('button', { name: /Modifier la variable/ }));
  const panel = await screen.findByRole('dialog', { name: 'Modifier la variable' });
  const label = within(panel).getByLabelText('Libellé');
  await user.clear(label);
  await user.type(label, 'Poids corrigé');
  await user.click(within(panel).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Modifier la variable' })).toBeNull());
}

describe('FormPreparationEditor — session E4', () => {
  test('ouvre le candidat local, le sauvegarde, vérifie son impact puis applique une seule fois', async () => {
    const user = userEvent.setup();
    const repository = makePreparationRepository();
    const templates = { getVersion: vi.fn(async () => source) } as unknown as TemplateRepository;
    renderEditor(repository, templates);
    await openLocalEditor(user);

    expect(screen.getByTestId('formprep-state')).toHaveTextContent('Modifications locales non enregistrées');
    const session = screen.getByTestId('form-preparation-session');
    await user.click(within(session).getByRole('button', { name: 'Enregistrer la préparation' }));
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      preparationId: expect.any(String), expectedPreparationRevision: 0,
      expectedSourceRevision: 7, expectedSourceFingerprint: 'sha256:source-fingerprint',
      payload: expect.not.objectContaining({ values: expect.anything() }),
    }));
    expect(screen.getByTestId('formprep-state')).toHaveTextContent('Préparation enregistrée');

    await user.click(within(screen.getByTestId('form-preparation-session')).getByRole('button', { name: 'Voir l’impact' }));
    await waitFor(() => expect(repository.preview).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('formprep-impact')).toHaveTextContent('2 patient(s) potentiellement concerné(s)');
    expect(screen.getByTestId('formprep-impact')).toHaveTextContent('Aucune écriture de patient');
    expect(screen.getByTestId('formprep-impact')).toHaveTextContent('Nature du changement : ajout compatible');

    await user.click(within(screen.getByTestId('form-preparation-session')).getByRole('button', { name: 'Appliquer les modifications' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Appliquer les modifications ?' });
    const apply = within(confirmation).getByRole('button', { name: 'Appliquer les modifications' });
    await user.dblClick(apply);
    await waitFor(() => expect(repository.apply).toHaveBeenCalledTimes(1));
    expect((await within(screen.getByTestId('form-preparation-session')).findAllByText('Les modifications ont été appliquées sur la même base. Aucune donnée clinique n’a été réécrite.')).length).toBeGreaterThan(0);
    expect(templates.getVersion).toHaveBeenCalledTimes(1);
  });

  test('protège une saisie locale lors de la fermeture et conserve le candidat après un conflit', async () => {
    const user = userEvent.setup();
    const repository = makePreparationRepository({
      save: vi.fn(async () => { throw new FormPreparationError('FORM_PREPARATION_CONFLICT'); }),
    });
    renderEditor(repository);
    await openLocalEditor(user);
    const session = screen.getByTestId('form-preparation-session');
    await user.click(within(session).getByRole('button', { name: 'Enregistrer la préparation' }));
    expect(await within(session).findByRole('alert')).toHaveTextContent('La définition source ou la préparation a changé');
    expect(screen.getByTestId('formprep-state')).toHaveTextContent('Modifications locales non enregistrées');

    await user.click(within(session).getByRole('button', { name: 'Fermer' }));
    await screen.findByRole('dialog', { name: 'Quitter cette préparation ?' });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Registre fictif' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifier la variable · Poids corrigé' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Quitter cette préparation ?' })).toBeNull();
    await user.click(within(session).getByRole('button', { name: 'Fermer' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Quitter cette préparation ?' })).getByRole('button', { name: 'Quitter sans enregistrer' }));
    expect(await screen.findByTestId('form-preparation-landing')).toBeInTheDocument();
  });

  test('reprend explicitement une préparation en conflit', async () => {
    const user = userEvent.setup();
    const conflicted = preparation(definition, 'conflict', 3);
    const repository = makePreparationRepository({ initial: conflicted });
    renderEditor(repository);
    expect(await screen.findByTestId('formprep-landing-state')).toHaveTextContent('Conflit à résoudre');
    await user.click(screen.getByRole('button', { name: 'Reprendre la préparation' }));
    await waitFor(() => expect(repository.resume).toHaveBeenCalledWith({
      preparationId: 'preparation-1', expectedPreparationRevision: 3, operationId: expect.any(String),
    }));
    expect(await screen.findByTestId('form-preparation-session')).toBeInTheDocument();
    expect(screen.getByTestId('formprep-state')).toHaveTextContent('Préparation enregistrée');
  });

  test('garde les cinq espaces, la recherche et le candidat local, et n’écrit rien depuis l’aperçu', async () => {
    const user = userEvent.setup();
    const repository = makePreparationRepository();
    const templates = { getVersion: vi.fn(async () => source) } as unknown as TemplateRepository;
    renderEditor(repository, templates);
    await openLocalEditor(user);

    // Les cinq espaces de l’éditeur restent atteignables depuis la préparation.
    const spaces = ['Structure du formulaire', 'Sections', 'Règles', 'Collecte diagnostique', 'Aperçu'];
    for (const name of spaces) {
      expect(screen.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    // Recherche globale et « Toutes les variables » ne sont pas perdus par le mode préparation.
    expect(screen.getByRole('searchbox', { name: 'Rechercher une variable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Toutes les variables/ })).toBeInTheDocument();
    // Le numéro technique reste une information secondaire, jamais une pastille d’état.
    expect(screen.getAllByText(/Version technique source/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: 'Sections' }));
    await user.click(screen.getByRole('tab', { name: 'Collecte diagnostique' }));
    await user.click(screen.getByRole('tab', { name: 'Aperçu' }));
    // L’aperçu rend le candidat local avec les composants de saisie réels.
    const preview = await screen.findByRole('tabpanel', { name: /Aperçu/ });
    expect(within(preview).getByLabelText('Poids corrigé')).toBeInTheDocument();

    // Aucune des opérations serveur de préparation n’est déclenchée par la navigation ni par l’aperçu.
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.preview).not.toHaveBeenCalled();
    expect(repository.apply).not.toHaveBeenCalled();
    expect(repository.discard).not.toHaveBeenCalled();
    expect(templates.getVersion).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('formprep-state')).toHaveTextContent('Modifications locales non enregistrées');

    // Le retour à la structure conserve la saisie locale.
    await user.click(screen.getByRole('tab', { name: /^Structure du formulaire/ }));
    expect(screen.getByRole('button', { name: 'Modifier la variable · Poids corrigé' })).toBeInTheDocument();
  });

  test('n’ouvre pas de préparation quand le serveur refuse les droits', async () => {
    const repository = makePreparationRepository();
    (repository.openOrResume as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new FormPreparationError('FORM_PREPARATION_FORBIDDEN'));
    renderEditor(repository);
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Vos droits ne permettent pas de gérer la préparation de ce formulaire.');
    expect(screen.queryByRole('button', { name: 'Modifier le formulaire' })).toBeNull();
    expect(screen.queryByTestId('form-preparation-session')).toBeNull();
  });

  test('ne fabrique pas d’éditeur si le contrat de préparation est indisponible', async () => {
    const repository = makePreparationRepository();
    Object.defineProperty(repository, 'available', { value: false });
    renderEditor(repository);
    expect(await screen.findByRole('status')).toHaveTextContent('La préparation sécurisée du formulaire n’est pas disponible');
    expect(screen.queryByRole('button', { name: 'Modifier le formulaire' })).toBeNull();
    expect(repository.openOrResume).not.toHaveBeenCalled();
  });
});
