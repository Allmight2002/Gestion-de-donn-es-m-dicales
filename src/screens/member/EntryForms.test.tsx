// @vitest-environment jsdom
// Formulaires de saisie courts : une seule fiche, plusieurs chemins de saisie.
// Données entièrement fictives.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
import type { BaseListing, BaseRepository } from '../../data/bases';
import type { NewPatientInput, PatientListItem, PatientRepository } from '../../data/patients';
import type { TemplateRepository } from '../../data/templates';
import type { TemplateField, ValidationRule } from '../../data/types';
import { EntryFormConflictError, type EntryForm, type EntryFormInput, type EntryFormRepository } from '../../data/entryForms';
import { EditPatient } from './EditPatient';
import { NewPatient } from './NewPatient';
import { BaseEntryForms } from './BaseEntryForms';

const auth = vi.hoisted(() => ({ role: 'medecin' as 'medecin' | 'saisisseur' }));
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u', fullName: 'Compte fictif', globalRole: auth.role, language: 'fr' }, user: { id: 'u', email: null }, signOut: () => {} }),
}));
beforeEach(() => { auth.role = 'medecin'; });

const field = (fieldKey: string, label: string, section: string, extra: Partial<TemplateField> = {}): TemplateField => ({
  id: fieldKey, fieldKey, label, section, sectionLabel: section, type: 'text', unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, scope: 'patient', ...extra,
});

// Le registre complet : un requis du formulaire complet (Glasgow), une variable proposée
// (« normal ») hors du formulaire court, et un bloc conditionné par la pathologie.
const FIELDS: TemplateField[] = [
  field('sexe', 'Sexe', 'demographie', { displayOrder: 1 }),
  field('glasgow', 'Score de Glasgow', 'clinique', { displayOrder: 2, required: true, type: 'integer' }),
  field('scanner', 'Résultat du scanner', 'imagerie', { displayOrder: 3, defaultValue: 'normal' }),
  field('pathologie', 'Pathologie', 'diagnostic', { displayOrder: 4 }),
  field('mecanisme', 'Mécanisme du traumatisme', 'diagnostic', { displayOrder: 5 }),
  field('issue', 'Issue du séjour', 'sortie', { displayOrder: 6 }),
];
const RULES: ValidationRule[] = [{
  id: 'r1', message: null, severity: 'block',
  rule: { if: { field: 'pathologie', operator: 'equals', value: 'tc' }, then: { field: 'mecanisme', operator: 'visible' } },
}];

const listing: BaseListing = {
  base: { id: 'b1', name: 'Registre fictif', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner',
  permissions: { canViewIdentity: false, canViewRawDocuments: false, canEditStructuredData: true, canExportData: false, canManageAccess: true },
  templateName: 'Neuro', versionNumber: 1,
};
const bases = { async getBase() { return listing; } } as unknown as BaseRepository;
const templates = {
  async getVersion(versionId: string) {
    return { version: { id: versionId, templateId: 't1', versionNumber: 1, status: 'published' as const }, fields: FIELDS, rules: RULES, sections: [] };
  },
} as unknown as TemplateRepository;

const quick: EntryForm = {
  id: 'f1', baseId: 'b1', name: 'Saisie rapide', fieldKeys: ['sexe', 'mecanisme'], requiredKeys: ['sexe'], rowVersion: 1, updatedAt: '',
};
const discharge: EntryForm = {
  id: 'f2', baseId: 'b1', name: 'Sortie', fieldKeys: ['issue'], requiredKeys: [], rowVersion: 1, updatedAt: '',
};

function entryForms(forms: EntryForm[] = [quick, discharge], over: Partial<EntryFormRepository> = {}): EntryFormRepository {
  return {
    list: vi.fn(async () => forms),
    create: vi.fn(async (_baseId: string, input: EntryFormInput) => ({ ...quick, id: 'f9', ...input })),
    update: vi.fn(async (id: string, _v: number, input: EntryFormInput) => ({ ...quick, id, ...input })),
    remove: vi.fn(async () => {}),
    ...over,
  };
}

function renderAt(path: string, repos: { patients?: PatientRepository; entryForms?: EntryFormRepository }) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases} templates={templates} patients={repos.patients} entryForms={repos.entryForms ?? entryForms()}>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/bases/:id/patients/new/manual" element={<NewPatient mode="manual" />} />
              <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
              <Route path="/bases/:id/patients/:patientId" element={<p>FICHE</p>} />
              <Route path="/bases/:id/formulaires" element={<BaseEntryForms />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('saisie rapide : création', () => {
  const patients = (createPatient = vi.fn(async (_b: string, _i: NewPatientInput) => ({ id: 'p1', code: 'P-0001' }))) => ({
    patients: { async listPatients() { return []; }, async findIdentityMatches() { return []; }, createPatient } as unknown as PatientRepository,
    createPatient,
  });

  test('ne propose que ses variables, dans son ordre, avec leurs dépendances', async () => {
    const { patients: repo } = patients();
    renderAt('/bases/b1/patients/new/manual?form=f1', { patients: repo });
    expect(await screen.findByLabelText('Formulaire de saisie')).toHaveValue('f1');
    expect(screen.getByText(/formulaire court/i)).toBeInTheDocument();
    // `mecanisme` dépend de `pathologie` : la variable pilote est ajoutée avant elle.
    expect(screen.getByLabelText(/^Sexe/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Pathologie/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Mécanisme/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Pathologie/), { target: { value: 'tc' } });
    expect(await screen.findByLabelText(/Mécanisme/)).toBeInTheDocument();
    // Les sections du formulaire complet restent visibles.
    expect(screen.getAllByText('demographie').length).toBeGreaterThan(0);
    expect(screen.getAllByText('diagnostic').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('clinique')).toHaveLength(0);
    // Variables du formulaire complet absentes.
    expect(screen.queryByLabelText(/Glasgow/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/scanner/i)).not.toBeInTheDocument();
  });

  test('crée la fiche sans exiger les requis du formulaire complet ni envoyer de valeur proposée cachée', async () => {
    const { patients: repo, createPatient } = patients();
    renderAt('/bases/b1/patients/new/manual?form=f1', { patients: repo });
    await screen.findByLabelText(/^Sexe/);
    // L'indispensable du formulaire court bloque.
    await userEvent.click(screen.getByRole('button', { name: /^enregistrer/i }));
    expect(createPatient).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Sexe/), { target: { value: 'F' } });
    fireEvent.change(screen.getByLabelText(/^Pathologie/), { target: { value: 'tc' } });
    await userEvent.click(screen.getByRole('button', { name: /^enregistrer/i }));
    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    // Ni Glasgow (requis du complet) ni le « normal » proposé du scanner : les absents restent vides.
    expect(createPatient.mock.calls[0][1].permanentData).toEqual({ sexe: 'F', pathologie: 'tc' });
    expect(await screen.findByText('FICHE')).toBeInTheDocument();
  });

  test('changer de formulaire en cours de saisie conserve les valeurs', async () => {
    const { patients: repo, createPatient } = patients();
    renderAt('/bases/b1/patients/new/manual?form=f1', { patients: repo });
    fireEvent.change(await screen.findByLabelText(/^Sexe/), { target: { value: 'M' } });
    await userEvent.selectOptions(screen.getByLabelText('Formulaire de saisie'), 'f2');
    fireEvent.change(await screen.findByLabelText(/Issue du séjour/), { target: { value: 'guéri' } });
    await userEvent.click(screen.getByRole('button', { name: /^enregistrer/i }));
    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    expect(createPatient.mock.calls[0][1].permanentData).toEqual({ sexe: 'M', issue: 'guéri' });
  });

  test('un compte de mission enregistre aussi une fiche partielle depuis un formulaire court', async () => {
    auth.role = 'saisisseur';
    const { patients: repo, createPatient } = patients();
    renderAt('/bases/b1/patients/new/manual?form=f1', { patients: repo });
    expect(await screen.findByLabelText('Formulaire de saisie')).toHaveValue('f1');
    fireEvent.change(screen.getByLabelText(/^Sexe/), { target: { value: 'F' } });
    await userEvent.click(screen.getByRole('button', { name: /^enregistrer/i }));
    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    expect(createPatient.mock.calls[0][1].permanentData).toEqual({ sexe: 'F' });
  });

  test('un lien vers un formulaire supprimé retombe sur le formulaire complet', async () => {
    const { patients: repo } = patients();
    renderAt('/bases/b1/patients/new/manual?form=disparu', { patients: repo });
    expect(await screen.findByText(/n’existe plus/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Formulaire de saisie')).toHaveValue('');
  });
});

describe('formulaire court : complétion d’une fiche existante', () => {
  const stored: PatientListItem = {
    id: 'p1', code: 'P-1', templateVersionId: 'v1', validationStatus: 'draft', version: 3, identity: null,
    data: { sexe: 'F', pathologie: 'tc', mecanisme: 'chute', glasgow: 9 },
  };
  type UpdatePatientData = PatientRepository['updatePatientData'];

  test('enregistre la fiche entière : les champs absents du formulaire sont préservés', async () => {
    const update = vi.fn<UpdatePatientData>(async () => ({ version: 4, updatedAt: null }));
    const repo = { async getPatient() { return stored; }, updatePatientData: update } as unknown as PatientRepository;
    renderAt('/bases/b1/patients/p1/edit?form=f2', { patients: repo });
    const issue = await screen.findByLabelText(/Issue du séjour/);
    expect(screen.queryByLabelText(/Glasgow/)).not.toBeInTheDocument();
    // Le statut du dossier n'est pas modifiable depuis un formulaire court.
    expect(screen.queryByLabelText('Statut')).not.toBeInTheDocument();
    fireEvent.change(issue, { target: { value: 'guéri' } });
    await userEvent.click(screen.getByRole('button', { name: /enregistrer les modifications/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]).toEqual(['p1', { sexe: 'F', pathologie: 'tc', mecanisme: 'chute', glasgow: 9, issue: 'guéri' }, 'draft', '', 3]);
  });

  test('une donnée saisie ailleurs est retrouvée dans le formulaire court', async () => {
    const repo = { async getPatient() { return stored; }, updatePatientData: vi.fn() } as unknown as PatientRepository;
    renderAt('/bases/b1/patients/p1/edit?form=f1', { patients: repo });
    expect(await screen.findByLabelText(/^Sexe/)).toHaveValue('F');
    expect(screen.getByLabelText(/Mécanisme/)).toHaveValue('chute');
  });
});

describe('gestion des formulaires de saisie', () => {
  test('le responsable compose et rend indispensable une variable ; l’ordre suit le formulaire complet', async () => {
    const repo = entryForms([]);
    renderAt('/bases/b1/formulaires', { entryForms: repo });
    await userEvent.click(await screen.findByRole('button', { name: /nouveau formulaire/i }));
    await userEvent.type(screen.getByLabelText('Nom du formulaire'), 'Sortie');
    const available = screen.getByRole('region', { name: /variables de la base/i });
    // Sections repliees : on deplie celles dont on a besoin.
    for (const section of ['sortie', 'demographie', 'diagnostic']) {
      await userEvent.click(within(available).getByRole('button', { name: new RegExp(`^${section}`) }));
    }
    // Cochees dans le desordre : le formulaire garde l'ordre du formulaire complet.
    await userEvent.click(within(available).getByLabelText('Issue du séjour'));
    await userEvent.click(within(available).getByLabelText('Sexe'));
    await userEvent.click(within(available).getByLabelText('Mécanisme du traumatisme'));
    // Dépendance annoncée : `mecanisme` exige `pathologie` à la saisie.
    expect(screen.getByText(/ajoutées automatiquement/i).parentElement).toHaveTextContent('Pathologie');
    const selected = screen.getByRole('region', { name: /variables du formulaire/i });
    await userEvent.click(within(selected).getAllByLabelText('Indispensable')[2]);
    await userEvent.click(screen.getByRole('button', { name: /enregistrer le formulaire/i }));
    await waitFor(() => expect(repo.create).toHaveBeenCalledTimes(1));
    expect(repo.create).toHaveBeenCalledWith('b1', {
      name: 'Sortie', fieldKeys: ['sexe', 'mecanisme', 'issue'], requiredKeys: ['issue'],
    });
  });

  test('un conflit de version conserve les réglages et demande un rechargement', async () => {
    const repo = entryForms([quick], { update: vi.fn(async () => { throw new EntryFormConflictError(); }) });
    renderAt('/bases/b1/formulaires', { entryForms: repo });
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier Saisie rapide' }));
    const name = screen.getByLabelText('Nom du formulaire');
    await userEvent.clear(name);
    await userEvent.type(name, 'Admission');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer le formulaire/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/changé entre-temps/i);
    expect(screen.getByLabelText('Nom du formulaire')).toHaveValue('Admission');
    expect(screen.getByRole('button', { name: /recharger les formulaires/i })).toBeInTheDocument();
  });

  test('supprimer un formulaire passe par « ⋯ » puis une confirmation', async () => {
    const repo = entryForms([quick]);
    renderAt('/bases/b1/formulaires', { entryForms: repo });
    await userEvent.click(await screen.findByRole('button', { name: 'Actions · Saisie rapide' }));
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/données saisies restent intactes/i);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(repo.remove).toHaveBeenCalledWith('f1', 1));
  });

  // Revue post-optimisation, lot C2 : la page suit les criteres de l'audit UI mobile.
  test('une ligne ouvre le formulaire ; Modifier et Supprimer sont dans « ⋯ », jamais au premier niveau', async () => {
    renderAt('/bases/b1/formulaires', { entryForms: entryForms([quick]) });
    const row = await screen.findByRole('button', { name: 'Modifier Saisie rapide' });
    expect(row).toHaveTextContent('2 variables');
    expect(screen.queryByRole('button', { name: /^Supprimer/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Actions · Saisie rapide' }));
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(row);
    expect(screen.getByLabelText('Nom du formulaire')).toHaveValue('Saisie rapide');
  });

  test('l explication de la page s ouvre derriere ⓘ', async () => {
    renderAt('/bases/b1/formulaires', { entryForms: entryForms([quick]) });
    await screen.findByRole('button', { name: 'Modifier Saisie rapide' });
    expect(screen.queryByText(/rien n’est dupliqué/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'En savoir plus' }));
    expect(screen.getByText(/rien n’est dupliqué/)).toBeInTheDocument();
  });

  test('une variable retiree de la base est comptee, jamais affichee par sa cle, et n est pas enregistree', async () => {
    const stale: EntryForm = { ...discharge, fieldKeys: ['issue', 'ancienne_variable'], requiredKeys: ['ancienne_variable'] };
    const repo = entryForms([stale]);
    renderAt('/bases/b1/formulaires', { entryForms: repo });
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier Sortie' }));
    expect(screen.getByRole('heading', { name: 'Variables du formulaire (1)' })).toBeInTheDocument();
    expect(screen.getByText('1 variable(s) retirée(s) de la base sont ignorées.')).toHaveAttribute('role', 'status');
    expect(screen.queryByText(/ancienne_variable/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /enregistrer le formulaire/i }));
    await waitFor(() => expect(repo.update).toHaveBeenCalledWith('f2', 1, { name: 'Sortie', fieldKeys: ['issue'], requiredKeys: [] }));
  });

  test('les sections se replient avec leur compte ; une recherche les deplie', async () => {
    renderAt('/bases/b1/formulaires', { entryForms: entryForms([quick]) });
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier Saisie rapide' }));
    const available = screen.getByRole('region', { name: /variables de la base/i });
    const diagnostic = within(available).getByRole('button', { name: 'diagnostic 1 sur 2 dans le formulaire' });
    expect(diagnostic).toHaveAttribute('aria-expanded', 'false');
    expect(within(available).queryByLabelText('Pathologie')).toBeNull();
    await userEvent.click(diagnostic);
    expect(within(available).getByLabelText('Pathologie')).not.toBeChecked();
    expect(within(available).getByLabelText('Mécanisme du traumatisme')).toBeChecked();
    await userEvent.type(within(available).getByRole('searchbox', { name: 'Rechercher une variable' }), 'issue');
    expect(within(available).getByLabelText('Issue du séjour')).toBeInTheDocument();
    expect(within(available).getByRole('button', { name: /^sortie/ })).toHaveAttribute('aria-expanded', 'true');
  });
});

