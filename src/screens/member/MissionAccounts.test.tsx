// @vitest-environment jsdom
// Ecran « Comptes de mission » (docs/spec-comptes-mission.md §8) avec repos INJECTES.
// L'ecran ne porte aucune regle de securite : on verifie qu'il propose les BONS defauts
// (noms des patients fermes, echeance bornee) et qu'il transmet fidelement la demande.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { MissionAccounts } from './MissionAccounts';
import {
  daysUntil, maxExpiryDate, missionStatus,
  type CreateMissionInput, type MissionAccount, type MissionRepository,
} from '../../data/mission';
import type { BaseListing, BaseRepository, BaseRole } from '../../data/bases';
import { NO_PERMISSIONS } from '../../data/access';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

function baseRepoWithRole(role: BaseRole): BaseRepository {
  const listing: BaseListing = {
    base: { id: 'b1', name: 'Base', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
    role,
    permissions: { ...NO_PERMISSIONS },
    templateName: 'Neuro',
    versionNumber: 1,
  };
  return { async getBase() { return listing; } } as unknown as BaseRepository;
}

const mission = (over: Partial<MissionAccount> = {}): MissionAccount => ({
  accessId: 'a1',
  userId: 'u2',
  email: 'etudiant@exemple.test',
  fullName: null,
  expiresAt: inDays(120),
  revokedAt: null,
  createdAt: inDays(-3),
  canViewIdentity: false,
  identityJustification: null,
  activated: true,
  ...over,
});

function makeMissions(over: Partial<MissionRepository> = {}, items: MissionAccount[] = [mission()]): MissionRepository {
  return {
    async list() { return items; },
    async create() { return { mailSent: true }; },
    async resend() {},
    async extend() {},
    async revoke() {},
    ...over,
  } as unknown as MissionRepository;
}

function renderScreen(bases: BaseRepository, missions: MissionRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases} missions={missions}>
        <MemoryRouter initialEntries={['/bases/b1/missions']}>
          <Routes>
            <Route path="/bases/:id/missions" element={<MissionAccounts />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('logique de mission (pure)', () => {
  test('l etat se deduit de la revocation, de l echeance puis de l activation', () => {
    expect(missionStatus(mission({ revokedAt: inDays(-1) }))).toBe('revoked');
    expect(missionStatus(mission({ expiresAt: inDays(-1) }))).toBe('expired');
    expect(missionStatus(mission({ activated: false }))).toBe('pending');
    expect(missionStatus(mission())).toBe('active');
  });

  test('une mission revoquee ET echue reste affichee comme revoquee', () => {
    expect(missionStatus(mission({ revokedAt: inDays(-2), expiresAt: inDays(-1) }))).toBe('revoked');
  });

  test('la borne proposee par l interface est bien 24 mois', () => {
    const from = new Date('2026-07-29T00:00:00.000Z');
    expect(maxExpiryDate(from).toISOString().slice(0, 7)).toBe('2028-07');
  });

  test('les jours restants sont comptes vers le haut, negatifs apres l echeance', () => {
    expect(daysUntil(inDays(10))).toBe(10);
    expect(daysUntil(inDays(-2))).toBeLessThan(0);
  });
});

describe('acces a l ecran', () => {
  test('un simple collaborateur ne voit pas la gestion des missions', async () => {
    renderScreen(baseRepoWithRole('viewer'), makeMissions());
    expect(await screen.findByText(/Réservé au propriétaire/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Adresse e-mail/i)).toBeNull();
  });

  test('le proprietaire voit le formulaire et la liste', async () => {
    renderScreen(baseRepoWithRole('owner'), makeMissions());
    expect(await screen.findByText(/Ouvrir un compte de mission/i)).toBeTruthy();
    expect(screen.getByText('etudiant@exemple.test')).toBeTruthy();
  });
});

describe('creation d une mission', () => {
  test('les noms des patients sont FERMES par defaut, et le motif n apparait qu a l ouverture', async () => {
    renderScreen(baseRepoWithRole('owner'), makeMissions());
    const identity = await screen.findByLabelText(/peut voir les noms/i);
    expect((identity as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText(/Motif/i)).toBeNull();

    await userEvent.click(identity);
    expect(await screen.findByLabelText(/Motif/i)).toBeTruthy();
  });

  test('la demande transmise porte l echeance en fin de journee et le motif saisi', async () => {
    const create = vi.fn(async (_input: CreateMissionInput) => ({ mailSent: true }));
    renderScreen(baseRepoWithRole('owner'), makeMissions({ create }));

    await userEvent.type(await screen.findByLabelText(/Adresse e-mail/i), 'nouveau@exemple.test');
    await userEvent.click(screen.getByLabelText(/peut voir les noms/i));
    await userEvent.type(await screen.findByLabelText(/Motif/i), 'Dossiers papier du service');
    await userEvent.click(screen.getByRole('button', { name: /Créer et envoyer/i }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0][0] as {
      baseId: string; email: string; expiresAt: string; canViewIdentity: boolean; identityJustification: string | null;
    };
    expect(sent.baseId).toBe('b1');
    expect(sent.email).toBe('nouveau@exemple.test');
    expect(sent.canViewIdentity).toBe(true);
    expect(sent.identityJustification).toBe('Dossiers papier du service');
    expect(new Date(sent.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('sans ouverture des noms, aucun motif n est transmis', async () => {
    const create = vi.fn(async (_input: CreateMissionInput) => ({ mailSent: true }));
    renderScreen(baseRepoWithRole('owner'), makeMissions({ create }));
    await userEvent.type(await screen.findByLabelText(/Adresse e-mail/i), 'nouveau@exemple.test');
    await userEvent.click(screen.getByRole('button', { name: /Créer et envoyer/i }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const sent = create.mock.calls[0][0] as { canViewIdentity: boolean; identityJustification: string | null };
    expect(sent.canViewIdentity).toBe(false);
    expect(sent.identityJustification).toBeNull();
  });

  test('le champ d echeance est borne a 24 mois', async () => {
    renderScreen(baseRepoWithRole('owner'), makeMissions());
    const until = (await screen.findByLabelText(/Mission jusqu/i)) as HTMLInputElement;
    expect(until.max).toBe(maxExpiryDate().toISOString().slice(0, 10));
  });

  test('un courriel non parti est signale, sans faire croire a un echec de creation', async () => {
    renderScreen(baseRepoWithRole('owner'), makeMissions({ create: async () => ({ mailSent: false }) }));
    await userEvent.type(await screen.findByLabelText(/Adresse e-mail/i), 'nouveau@exemple.test');
    await userEvent.click(screen.getByRole('button', { name: /Créer et envoyer/i }));
    expect(await screen.findByText(/le courriel n.est pas parti/i)).toBeTruthy();
  });

  test('un refus serveur est affiche tel quel, sans creation silencieuse', async () => {
    const create = vi.fn(async (_input: CreateMissionInput): Promise<{ mailSent: boolean }> => {
      throw new Error('Cette adresse ne peut pas recevoir un compte de mission');
    });
    renderScreen(baseRepoWithRole('owner'), makeMissions({ create }));
    await userEvent.type(await screen.findByLabelText(/Adresse e-mail/i), 'medecin@exemple.test');
    await userEvent.click(screen.getByRole('button', { name: /Créer et envoyer/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/ne peut pas recevoir/i);
  });
});

describe('suivi des missions', () => {
  test('une mission en cours affiche son echeance et les jours restants', async () => {
    renderScreen(baseRepoWithRole('owner'), makeMissions({}, [mission({ expiresAt: inDays(20) })]));
    expect(await screen.findByText(/En cours/)).toBeTruthy();
    expect(screen.getByText(/il reste 20 jour/)).toBeTruthy();
  });

  test('une mission terminee ou revoquee ne propose plus d action', async () => {
    renderScreen(baseRepoWithRole('owner'), makeMissions({}, [mission({ expiresAt: inDays(-1) })]));
    expect(await screen.findByText(/Terminée/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Révoquer/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Prolonger/i })).toBeNull();
  });

  test('une mission qui voit les noms est signalee dans la liste', async () => {
    renderScreen(baseRepoWithRole('owner'), makeMissions({}, [mission({ canViewIdentity: true })]));
    expect(await screen.findByText(/voit les noms/i)).toBeTruthy();
  });

  test('la revocation demande confirmation avant d appeler le serveur', async () => {
    const revoke = vi.fn(async (_accessId: string) => {});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderScreen(baseRepoWithRole('owner'), makeMissions({ revoke }));

    await userEvent.click(await screen.findByRole('button', { name: /Révoquer/i }));
    expect(revoke).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Révoquer/i }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('a1'));
    confirm.mockRestore();
  });

  test('la prolongation envoie la nouvelle echeance', async () => {
    const extend = vi.fn(async (_accessId: string, _expiresAt: string) => {});
    renderScreen(baseRepoWithRole('owner'), makeMissions({ extend }));
    await userEvent.click(await screen.findByRole('button', { name: /^Prolonger$/i }));
    const field = (await screen.findByLabelText(/Nouvelle échéance/i)) as HTMLInputElement;
    await userEvent.clear(field);
    await userEvent.type(field, '2027-01-15');
    await userEvent.click(screen.getAllByRole('button', { name: /^Prolonger$/i }).at(-1)!);
    await waitFor(() => expect(extend).toHaveBeenCalled());
    expect(extend.mock.calls[0][0]).toBe('a1');
    expect(String(extend.mock.calls[0][1])).toContain('2027-01-15');
  });

  test('le renvoi d invitation confirme visiblement', async () => {
    const resend = vi.fn(async (_baseId: string, _email: string) => {});
    renderScreen(baseRepoWithRole('owner'), makeMissions({ resend }));
    await userEvent.click(await screen.findByRole('button', { name: /Renvoyer/i }));
    await waitFor(() => expect(resend).toHaveBeenCalledWith('b1', 'etudiant@exemple.test'));
    expect(await screen.findByText(/Invitation renvoyée/i)).toBeTruthy();
  });
});
