// @vitest-environment jsdom
// Audit UI mobile, lot 8 : page « A faire » du tableau de bord (brouillons a reprendre,
// questions du curateur, dossiers incomplets, missions a echeance), sur des depots injectes.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TodoSection } from './TodoSection';
import type { BaseListing, BaseRepository, BaseTodoCounts } from '../../data/bases';
import type { WorkDraftRepository, WorkDraftSummary } from '../../data/workDrafts';
import type { MissionAccount, MissionRepository } from '../../data/mission';

const PERMS = { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true };
const listing = (id: string, name: string): BaseListing => ({
  base: { id, name, specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner', permissions: PERMS, templateName: 'Modèle fictif', versionNumber: 1,
});
const BASES = [listing('b1', 'Registre A (fictif)'), listing('b2', 'Registre B (fictif)')];

const draft = (id: string, over: Partial<WorkDraftSummary>): WorkDraftSummary => ({
  id, baseId: 'b1', kind: 'patient_create', targetId: null, patientId: null, patientCode: null,
  updatedAt: '2026-09-27T08:30:00Z', expiresAt: '2026-09-28T08:30:00Z', ...over,
});
const DRAFTS: WorkDraftSummary[] = [
  draft('d1', {}),
  draft('d2', { kind: 'patient_update', targetId: 'p1', patientId: 'p1', patientCode: 'P-0001' }),
  draft('d3', { kind: 'encounter_create', targetId: 'p2', patientId: 'p2', patientCode: 'P-0002', baseId: 'b2' }),
  draft('d4', { kind: 'encounter_update', targetId: 'e9', patientId: 'p3', patientCode: 'P-0003' }),
];

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const mission = (n: number, expiresAt: string, revokedAt: string | null = null): MissionAccount => ({
  accessId: `m${n}`, baseId: 'b1', baseName: 'Registre A (fictif)', userId: `u${n}`, accountLabel: `Enquêteur ${n}`,
  loginIdentifier: null, expiresAt, revokedAt, createdAt: '2026-09-01T00:00:00Z', canViewIdentity: false,
  identityJustification: null, credentialStatus: revokedAt ? 'revoked' : 'active', credentialGeneration: 1, lastRotatedAt: null,
});

function renderTodo({
  drafts = async () => DRAFTS,
  counts = async (): Promise<BaseTodoCounts[]> => [{ baseId: 'b1', incomplete: 12, clarifications: 2 }],
  missions = async () => [mission(1, inDays(5)), mission(2, inDays(60)), mission(3, inDays(3), '2026-09-20T00:00:00Z'), mission(4, inDays(-2))],
  showMissions = true,
  bases = BASES,
}: {
  drafts?: (() => Promise<WorkDraftSummary[]>) | null;
  counts?: (() => Promise<BaseTodoCounts[]>) | null;
  missions?: () => Promise<MissionAccount[]>;
  showMissions?: boolean;
  bases?: BaseListing[];
} = {}) {
  const list = vi.fn(missions);
  const workDrafts = { available: true, ...(drafts ? { listMine: drafts } : {}) } as unknown as WorkDraftRepository;
  const baseRepository = (counts ? { getTodoCounts: counts } : {}) as unknown as BaseRepository;
  const view = render(
    <I18nProvider>
      <RepositoryProvider bases={baseRepository} workDrafts={workDrafts} missions={{ list } as unknown as MissionRepository}>
        <MemoryRouter>
          <TodoSection bases={bases} showMissions={showMissions} />
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
  return { ...view, list };
}

const linkTo = (name: RegExp | string) => screen.getByRole('link', { name });

describe('page « À faire » (lot 8)', () => {
  test('chaque brouillon rouvre son formulaire, sans réponse ni identité', async () => {
    renderTodo();
    expect(await screen.findByRole('heading', { level: 2, name: 'À faire' })).toBeInTheDocument();
    expect(linkTo(/^Nouveau patient/)).toHaveAttribute('href', '/bases/b1/patients/new/manual');
    expect(linkTo(/^Données permanentes · P-0001/)).toHaveAttribute('href', '/bases/b1/patients/p1/edit');
    expect(linkTo(/^Nouvelle rencontre · P-0002/)).toHaveAttribute('href', '/bases/b2/patients/p2/encounters/new/manual');
    expect(linkTo(/^Rencontre · P-0003/)).toHaveAttribute('href', '/bases/b1/patients/p3/encounters/e9/edit');
    // L'heure et la base situent le brouillon.
    expect(linkTo(/^Nouvelle rencontre · P-0002/)).toHaveTextContent(/Brouillon du .+ · Registre B \(fictif\)/);
  });

  test('questions du curateur, dossiers incomplets et missions proches, dans cet ordre', async () => {
    renderTodo();
    await screen.findByRole('heading', { name: 'À faire' });
    expect(linkTo(/^2 question\(s\) du curateur/)).toHaveAttribute('href', '/bases/b1/curation');
    expect(linkTo(/^12 dossier\(s\) incomplet\(s\)/)).toHaveAttribute('href', '/bases/b1/queue');
    // Seule la mission active qui finit dans 14 jours au plus : ni lointaine, ni revoquee, ni finie.
    const soon = linkTo(/^Mission : 5 jour\(s\) restant\(s\)/);
    expect(soon).toHaveAttribute('href', '/missions');
    expect(soon).toHaveTextContent('Enquêteur 1 · Registre A (fictif)');
    expect(screen.queryByText(/Enquêteur [234]/)).toBeNull();

    // Brouillons (ils expirent en 24 h), puis questions, dossiers et missions.
    expect(within(screen.getByRole('list')).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/bases/b1/patients/new/manual', '/bases/b1/patients/p1/edit', '/bases/b2/patients/p2/encounters/new/manual',
      '/bases/b1/patients/p3/encounters/e9/edit', '/bases/b1/curation', '/bases/b1/queue', '/missions',
    ]);
  });

  test('au plafond du serveur, le compte des dossiers se lit « 100+ »', async () => {
    renderTodo({ drafts: null, counts: async () => [{ baseId: 'b1', incomplete: 100, clarifications: 0 }], showMissions: false });
    expect(await screen.findByRole('link', { name: /^100\+ dossier\(s\) incomplet\(s\)/ })).toHaveAttribute('href', '/bases/b1/queue');
  });

  test('au-delà de cinq brouillons, la liste se déplie sur demande', async () => {
    const seven = Array.from({ length: 7 }, (_, index) => draft(`x${index}`, {}));
    renderTodo({ drafts: async () => seven, counts: null, showMissions: false });
    await screen.findByRole('heading', { name: 'À faire' });
    expect(screen.getAllByRole('link', { name: /^Nouveau patient/ })).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: 'Afficher les 7 brouillons' }));
    expect(screen.getAllByRole('link', { name: /^Nouveau patient/ })).toHaveLength(7);
    expect(screen.queryByRole('button', { name: /Afficher les/ })).toBeNull();
  });

  test('une lecture en échec retire sa seule rubrique', async () => {
    renderTodo({ drafts: async () => { throw new Error('indisponible (fictif)'); } });
    expect(await screen.findByRole('link', { name: /^12 dossier/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Brouillon du/ })).toBeNull();
    expect(screen.queryByText(/indisponible/)).toBeNull();
  });

  test('toutes les lectures en échec : une phrase, sans détail technique', async () => {
    const fail = async (): Promise<never> => { throw new Error('PGRST202 fictif'); };
    renderTodo({ drafts: fail, counts: fail, missions: fail });
    expect(await screen.findByText('La liste « À faire » est indisponible pour le moment.')).toBeInTheDocument();
    expect(screen.queryByText(/PGRST/)).toBeNull();
  });

  test('rien à faire : la section ne s’affiche pas', async () => {
    const { container, list } = renderTodo({ drafts: async () => [], counts: async () => [], missions: async () => [] });
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  test('sans rôle de médecin, les missions ne sont pas lues ; une base inconnue est ignorée', async () => {
    const { list } = renderTodo({
      showMissions: false,
      drafts: async () => [draft('z', { baseId: 'b-inconnue' })],
      counts: async () => [{ baseId: 'b2', incomplete: 1, clarifications: 0 }, { baseId: 'b-inconnue', incomplete: 9, clarifications: 9 }],
    });
    expect(await screen.findByRole('link', { name: /^1 dossier/ })).toHaveTextContent('Registre B (fictif)');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(list).not.toHaveBeenCalled();
  });
});
