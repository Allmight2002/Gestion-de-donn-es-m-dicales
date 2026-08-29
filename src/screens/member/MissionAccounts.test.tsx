// @vitest-environment jsdom
import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { MissionAccounts } from './MissionAccounts';
import {
  daysUntil,
  maxExpiryDate,
  missionStatus,
  type CreateMissionInput,
  type MissionAccount,
  type MissionCredential,
  type MissionRepository,
} from '../../data/mission';
import type { BaseListing, BaseRepository, BaseRole } from '../../data/bases';
import { NO_PERMISSIONS } from '../../data/access';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const credential: MissionCredential = { loginIdentifier: 'mission-neuro-01', password: 'V7!solide-mission#2026' };

const listing = (id: string, name: string, role: BaseRole = 'owner'): BaseListing => ({
  base: { id, name, specialty: null, ownerUserId: 'owner-1', currentTemplateVersionId: 'v1' },
  role,
  permissions: { ...NO_PERMISSIONS },
  templateName: 'Neuro',
  versionNumber: 1,
});

function baseRepo(items: BaseListing[]): BaseRepository {
  return {
    async listMyBases() { return items; },
    async getBase(id: string) { return items.find((item) => item.base.id === id) ?? null; },
  } as unknown as BaseRepository;
}

const mission = (over: Partial<MissionAccount> = {}): MissionAccount => ({
  accessId: '10000000-0000-4000-8000-000000000010',
  baseId: 'b1',
  baseName: 'Base neurologie',
  userId: 'u2',
  accountLabel: 'Saisie cohorte A',
  loginIdentifier: 'mission-neuro-01',
  expiresAt: inDays(120),
  revokedAt: null,
  createdAt: inDays(-3),
  canViewIdentity: false,
  identityJustification: null,
  credentialStatus: 'active',
  credentialGeneration: 1,
  lastRotatedAt: inDays(-3),
  ...over,
});

function missionRepo(over: Partial<MissionRepository> = {}, items: MissionAccount[] = [mission()]): MissionRepository {
  return {
    async list() { return items; },
    async create() { return credential; },
    async regenerate() { return { ...credential, password: 'N8!nouveau-secret#2026' }; },
    async reveal() { return credential; },
    async extend() {},
    async revoke() {},
    ...over,
  };
}

function renderScreen(
  bases: BaseRepository,
  missions: MissionRepository,
  path = '/bases/b1/missions',
) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases} missions={missions}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/missions" element={<MissionAccounts />} />
            <Route path="/bases/:id/missions" element={<MissionAccounts />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('logique de mission', () => {
  test('priorise revocation et echeance, puis l etat des justificatifs', () => {
    expect(missionStatus(mission({ revokedAt: inDays(-1) }))).toBe('revoked');
    expect(missionStatus(mission({ expiresAt: inDays(-1) }))).toBe('expired');
    expect(missionStatus(mission({ credentialStatus: 'provisioning' }))).toBe('pending');
    expect(missionStatus(mission())).toBe('active');
  });

  test('borne a 24 mois et compte les jours restants', () => {
    const from = new Date('2026-07-29T00:00:00.000Z');
    expect(maxExpiryDate(from).toISOString().slice(0, 7)).toBe('2028-07');
    expect(daysUntil(inDays(10))).toBe(10);
    expect(daysUntil(inDays(-2))).toBeLessThan(0);
  });
});

describe('propriete et vue generale', () => {
  test('un non-proprietaire ne voit aucune commande ni aucun secret', async () => {
    renderScreen(baseRepo([listing('b1', 'Base neurologie', 'editor')]), missionRepo());
    expect(await screen.findByText(/Réservé au propriétaire/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Identifiant/i)).toBeNull();
    expect(screen.queryByText(credential.password)).toBeNull();
  });

  test('la vue generale regroupe les comptes et leurs bases, uniquement pour les bases possedees', async () => {
    const list = vi.fn(async () => [mission()]);
    renderScreen(
      baseRepo([listing('b1', 'Base neurologie'), listing('b2', 'Base lecture seule', 'viewer')]),
      missionRepo({ list }),
      '/missions',
    );
    expect(await screen.findByRole('heading', { name: /Comptes de mission/i })).toBeTruthy();
    expect(screen.getByLabelText(/Base associée/i)).toHaveValue('b1');
    expect(screen.queryByRole('option', { name: 'Base lecture seule' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Base neurologie' })).toHaveAttribute('href', '/bases/b1');
    expect(list).toHaveBeenCalledWith();
  });
});

// Les navigateurs compilent l'attribut `pattern` avec le drapeau `v`. Une expression qui n'y
// compile pas fait IGNORER l'attribut en silence : le champ cesse d'etre valide cote navigateur et
// une saisie non conforme part jusqu'au serveur, qui la refuse par un 400 difficile a relier a sa
// cause. C'est ce qui etait arrive au motif de l'identifiant de mission (`.-` non echappe).
describe('motifs de validation cote navigateur', () => {
  test('le motif de l identifiant compile sous le drapeau v et applique la regle du serveur', async () => {
    renderScreen(baseRepo([listing('b1', 'Base neurologie')]), missionRepo());
    const source = (await screen.findByLabelText(/Identifiant de connexion/i)).getAttribute('pattern');
    expect(source).toBeTruthy();
    expect(() => new RegExp(`^(?:${source!})$`, 'v')).not.toThrow();

    // Meme regle que IDENTIFIER_RE de create-mission-account (la saisie est deja mise en minuscules).
    const rule = new RegExp(`^(?:${source!})$`, 'v');
    for (const accepte of ['mission-neuro-01', 'mission.neuro.01', 'abc']) {
      expect(rule.test(accepte)).toBe(true);
    }
    for (const refuse of ['mission neuro', '-mission', 'mission-', '.mission', 'mission_01', 'é'.repeat(4)]) {
      expect(rule.test(refuse)).toBe(false);
    }
  });

  test('aucun autre motif du frontend ne casse silencieusement', async () => {
    // Garde volontairement transverse : le piege est invisible a la relecture et se represenerait
    // a l'identique sur n'importe quel autre champ.
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const root = join(process.cwd(), 'src');
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
      });
    })(root);

    const invalides: string[] = [];
    for (const file of files) {
      for (const [, source] of readFileSync(file, 'utf8').matchAll(/\spattern="([^"]+)"/g)) {
        try {
          new RegExp(`^(?:${source})$`, 'v');
        } catch {
          invalides.push(`${relative(root, file).replace(/\\/g, '/')} : ${source}`);
        }
      }
    }
    expect(invalides).toEqual([]);
  });
});

describe('creation et conservation chiffree', () => {
  test('transmet le nom, l identifiant choisi et l echeance, jamais une adresse email', async () => {
    const create = vi.fn(async (_input: CreateMissionInput) => credential);
    const list = vi.fn(async () => [mission()]);
    renderScreen(baseRepo([listing('b1', 'Base neurologie')]), missionRepo({ create, list }));

    await userEvent.type(await screen.findByLabelText(/Nom du compte/i), 'Equipe matin');
    await userEvent.type(screen.getByLabelText(/Identifiant de connexion/i), 'Mission-Neuro-01');
    await userEvent.click(screen.getByLabelText(/peut voir les noms/i));
    await userEvent.type(screen.getByLabelText(/Motif/i), 'Rapprochement du dossier papier');
    await userEvent.click(screen.getByRole('button', { name: /Créer le compte et générer/i }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0][0] as CreateMissionInput & { email?: unknown };
    expect(sent.baseId).toBe('b1');
    expect(sent.accountLabel).toBe('Equipe matin');
    expect(sent.loginIdentifier).toBe('mission-neuro-01');
    expect(sent.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sent.canViewIdentity).toBe(true);
    expect(sent.identityJustification).toBe('Rapprochement du dossier papier');
    expect(sent.email).toBeUndefined();
    expect(new Date(sent.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(await screen.findByText(credential.password)).toBeTruthy();
  });

  test('le mot de passe reste masque jusqu a une revelation explicite', async () => {
    const reveal = vi.fn(async () => credential);
    renderScreen(baseRepo([listing('b1', 'Base neurologie')]), missionRepo({ reveal }));
    expect(await screen.findByText('••••••••••••')).toBeTruthy();
    expect(screen.queryByText(credential.password)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Afficher le mot de passe/i }));
    expect(await screen.findByText(credential.password)).toBeTruthy();
    expect(reveal).toHaveBeenCalledWith(mission().accessId);

    await userEvent.click(screen.getByRole('button', { name: /Masquer le mot de passe/i }));
    expect(screen.queryByText(credential.password)).toBeNull();
  });

  test('la copie revele au besoin et utilise uniquement le presse-papiers', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const reveal = vi.fn(async () => credential);
    renderScreen(baseRepo([listing('b1', 'Base neurologie')]), missionRepo({ reveal }));

    await userEvent.click(await screen.findByRole('button', { name: /Copier le mot de passe/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(credential.password));
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Mot de passe copié/i)).toBeTruthy();
  });
});

describe('cycle de vie', () => {
  test('la regeneration exige confirmation, conserve l identifiant et affiche le nouveau secret', async () => {
    const regenerate = vi.fn(async (_accessId: string, _operationId: string) => ({
      loginIdentifier: credential.loginIdentifier,
      password: 'N8!nouveau-secret#2026',
    }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderScreen(baseRepo([listing('b1', 'Base neurologie')]), missionRepo({ regenerate }));

    await userEvent.click(await screen.findByRole('button', { name: /Régénérer le mot de passe/i }));
    expect(regenerate).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Régénérer le mot de passe/i }));
    await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
    expect(regenerate.mock.calls[0][0]).toBe(mission().accessId);
    expect(regenerate.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await screen.findByText('N8!nouveau-secret#2026')).toBeTruthy();
  });

  test('la revocation exige confirmation et retire tout secret affiche', async () => {
    const revoke = vi.fn(async () => undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderScreen(baseRepo([listing('b1', 'Base neurologie')]), missionRepo({ revoke }));
    await userEvent.click(await screen.findByRole('button', { name: /Afficher le mot de passe/i }));
    expect(await screen.findByText(credential.password)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^Révoquer$/i }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(mission().accessId));
    expect(confirm).toHaveBeenCalled();
    expect(screen.queryByText(credential.password)).toBeNull();
  });

  test('un compte expire reste administrable par son proprietaire', async () => {
    renderScreen(
      baseRepo([listing('b1', 'Base neurologie')]),
      missionRepo({}, [mission({ expiresAt: inDays(-1) })]),
    );
    expect(await screen.findByText(/Terminée/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Afficher le mot de passe/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copier le mot de passe/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Prolonger$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Régénérer le mot de passe/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Révoquer$/i })).toBeTruthy();
  });
});
