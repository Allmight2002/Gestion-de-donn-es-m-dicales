// @vitest-environment jsdom
// La page de base en ONGLETS — fil d'Ariane, quatre destinations selon le role/permissions,
// sous-onglets du groupe actif, contenu enfant rendu via Outlet.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { setTerrainMode } from '../../lib/terrainMode';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from 'react-router';
import { useState, type ReactNode } from 'react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseLayout } from './BaseLayout';
import { useBaseFocus } from './baseFocus';
import { TopBarRegistryProvider, useTopBarRegistry } from '../../components/TopBar';
import type { BaseRepository, BaseListing } from '../../data/bases';

const NO_PERMS = { canViewIdentity: false, canViewRawDocuments: false, canEditStructuredData: false, canExportData: false, canManageAccess: false };

function listingWith(
  role: 'owner' | 'viewer',
  perms: Partial<typeof NO_PERMS> = {},
  extra: Partial<BaseListing> = {},
): BaseListing {
  return {
    base: { id: 'b1', name: 'Gliomes 2026', specialty: 'Neuro', ownerUserId: 'u', currentTemplateVersionId: 'v1' },
    role,
    permissions: { ...NO_PERMS, ...perms },
    templateName: 'T', versionNumber: 1,
    ...extra,
  };
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

function renderLayout(listing: BaseListing) {
  const bases = { async getBase() { return listing; } } as unknown as BaseRepository;
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases}>
        <MemoryRouter initialEntries={['/bases/b1']}>
          <Routes>
            <Route path="/bases/:id" element={<BaseLayout />}>
              <Route index element={<div>HOME</div>} />
              <Route path="parametres" element={<div>REGLAGES</div>} />
              <Route path="queue" element={<div>FILE</div>} />
              <Route path="propositions" element={<div>PROPOSITIONS</div>} />
              <Route path="cohorts" element={<div>COHORTES</div>} />
              <Route path="stats" element={<div>STATS</div>} />
              <Route path="activity" element={<div>JOURNAL</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

// Le regroupement ne donne acces a rien de nouveau : chaque entree garde la condition
// d'affichage de son ecran, et un groupe sans entree disponible disparait.
describe('BaseLayout — quatre destinations', () => {
  test('proprietaire : Patients, A completer, Analyse, Parametres — et rien de plus', async () => {
    renderLayout(listingWith('owner'));
    const nav = await screen.findByRole('navigation', { name: 'Gliomes 2026' });
    expect(Array.from(nav.querySelectorAll('a'), (link) => link.textContent))
      .toEqual(['Patients', 'À compléter', 'Analyse', 'Paramètres']);
    expect(screen.getByText('Gliomes 2026')).toBeInTheDocument(); // fil d'Ariane
    expect(screen.getByText('HOME')).toBeInTheDocument(); // enfant (Outlet)
  });

  test('l onglet Parametres ouvre les reglages et deplie ses sous-onglets', async () => {
    renderLayout(listingWith('owner'));
    await userEvent.click(await screen.findByRole('link', { name: /Paramètres/ }));
    expect(await screen.findByText('REGLAGES')).toBeInTheDocument();
    const subs = screen.getByRole('navigation', { name: 'Paramètres' });
    expect(Array.from(subs.querySelectorAll('a'), (link) => link.textContent))
      .toEqual(['Général', 'Formulaire', 'Accès', 'Journal']);
  });

  test('les propositions figurent dans A completer pour le seul proprietaire', async () => {
    renderLayout(listingWith('owner'));
    await userEvent.click(await screen.findByRole('link', { name: 'À compléter' }));
    const subs = await screen.findByRole('navigation', { name: 'À compléter' });
    // L56 : la file des diagnostics sans bloc rejoint ce groupe, elle aussi reservee au
    // proprietaire (la RPC le verifie de son cote).
    expect(Array.from(subs.querySelectorAll('a'), (link) => link.textContent))
      .toEqual(['À compléter', 'Propositions', 'Diagnostics', 'Curation']);
  });

  test('le journal et les statistiques restent accessibles a un lecteur, ranges dans leur groupe', async () => {
    renderLayout(listingWith('viewer'));
    const nav = await screen.findByRole('navigation', { name: 'Gliomes 2026' });
    expect(Array.from(nav.querySelectorAll('a'), (link) => link.textContent))
      .toEqual(['Patients', 'Analyse', 'Paramètres']); // ni saisie a completer, ni curation
    await userEvent.click(screen.getByRole('link', { name: /Paramètres/ }));
    const subs = await screen.findByRole('navigation', { name: 'Paramètres' });
    expect(Array.from(subs.querySelectorAll('a'), (link) => link.textContent)).toEqual(['Général', 'Journal']);
    expect(screen.queryByRole('link', { name: 'Formulaire' })).not.toBeInTheDocument();
  });

  test('un seul sous-onglet disponible : pas de barre secondaire', async () => {
    renderLayout(listingWith('viewer'));
    await userEvent.click(await screen.findByRole('link', { name: /Analyse/ }));
    expect(await screen.findByText('STATS')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Analyse' })).not.toBeInTheDocument();
  });
});

// Compte de mission : parcours reduit a la saisie + bandeau d'echeance permanent
// (docs/spec-comptes-mission.md §8).
describe('BaseLayout — compte de mission', () => {
  test('le bandeau annonce l echeance et le parcours se limite a la saisie', async () => {
    renderLayout(listingWith('viewer', {}, { expiresAt: inDays(120), canCreateStructuredData: true }));
    expect(await screen.findByText(/Mission sur cette base jusqu/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Gliomes 2026' });
    expect(Array.from(nav.querySelectorAll('a'), (link) => link.textContent)).toEqual(['Patients']);
  });

  test('a l approche de l echeance, le bandeau compte les jours restants', async () => {
    renderLayout(listingWith('viewer', {}, { expiresAt: inDays(5), canCreateStructuredData: true }));
    expect(await screen.findByText(/il reste 5 jour/)).toBeInTheDocument();
  });

  test('un acces permanent n affiche aucun bandeau de mission', async () => {
    renderLayout(listingWith('viewer'));
    await screen.findByRole('link', { name: /Patients/ });
    expect(screen.queryByText(/Mission sur cette base/)).not.toBeInTheDocument();
  });
});

// UX-12(a) : le fil d'Ariane ne doit jamais affirmer un contexte qu'il n'a pas verifie.
describe('BaseLayout — contexte du fil d Ariane', () => {
  test('changer de base n affiche jamais le nom precedent pendant le chargement', async () => {
    const noms: Record<string, string> = { b1: 'Gliomes 2026', b2: 'Registre Cardio' };
    let liberer: (() => void) | null = null;
    const bases = {
      async getBase(id: string) {
        if (id === 'b2') await new Promise<void>((resolve) => { liberer = resolve; });
        return { ...listingWith('owner'), base: { ...listingWith('owner').base, id, name: noms[id] } };
      },
    } as unknown as BaseRepository;

    function Bascule() {
      const navigate = useNavigate();
      return <><button onClick={() => navigate('/bases/b2')}>Ouvrir base B</button><BaseLayout /></>;
    }

    render(
      <I18nProvider>
        <RepositoryProvider bases={bases}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes>
              <Route path="/bases/:id" element={<Bascule />}>
                <Route index element={<div>HOME</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('Gliomes 2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir base B' }));
    expect(screen.queryByText('Gliomes 2026')).not.toBeInTheDocument();
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    act(() => { liberer?.(); });
    expect(await screen.findByText('Registre Cardio')).toBeInTheDocument();
  });

  test('une base illisible n emprunte pas le nom d une autre et ne se declare pas ouverte', async () => {
    const bases = { async getBase() { throw new Error('refus'); } } as unknown as BaseRepository;
    render(
      <I18nProvider>
        <RepositoryProvider bases={bases}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes>
              <Route path="/bases/:id" element={<BaseLayout />}>
                <Route index element={<div>HOME</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('Une erreur est survenue')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navigation dans la base' })).toBeInTheDocument();
  });
});

// Audit UI mobile, lot 1 (T1-B) : sur telephone, la barre haute porte le nom de la base et le
// retour ; le fil d'Ariane, qui disait la meme chose sur deux lignes, n'y est plus affiche.
function TopBarProbe({ children }: { children: ReactNode }) {
  const { active, registry } = useTopBarRegistry();
  return (
    <TopBarRegistryProvider registry={registry}>
      {children}
      <output aria-label="barre haute">{active ? `${active.title} | ${active.backTo} | ${active.backLabel}` : 'vide'}</output>
    </TopBarRegistryProvider>
  );
}

function renderWithTopBar(listing: BaseListing, entry: string) {
  const bases = { async getBase() { return listing; } } as unknown as BaseRepository;
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases}>
        <MemoryRouter initialEntries={[entry]}>
          <TopBarProbe>
            <Routes>
              <Route path="/bases/:id" element={<BaseLayout />}>
                <Route index element={<div>HOME</div>} />
                <Route path="cohorts" element={<div>COHORTES</div>} />
                <Route path="import" element={<div>IMPORT</div>} />
              </Route>
            </Routes>
          </TopBarProbe>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('BaseLayout — barre haute contextuelle (T1-B)', () => {
  test('depuis un onglet, la barre porte la base et remonte au tableau de bord', async () => {
    renderWithTopBar(listingWith('owner', { canExportData: true }), '/bases/b1/cohorts');
    const bar = screen.getByRole('status', { name: 'barre haute' });
    expect(await screen.findByText('COHORTES')).toBeInTheDocument();
    await vi.waitFor(() => expect(bar).toHaveTextContent('Gliomes 2026 | / | Retour : Tableau de bord'));
    // Le fil d'Ariane reste pour l'ordinateur, ou la barre haute n'existe pas.
    expect(screen.getByRole('link', { name: 'Tableau de bord' }).closest('p')).toHaveClass('hidden', 'lg:block');
  });

  test('depuis une page interieure, le retour mene a la liste de la base', async () => {
    renderWithTopBar(listingWith('owner'), '/bases/b1/import');
    const bar = screen.getByRole('status', { name: 'barre haute' });
    expect(await screen.findByText('IMPORT')).toBeInTheDocument();
    await vi.waitFor(() => expect(bar).toHaveTextContent('Gliomes 2026 | /bases/b1 | Retour : Gliomes 2026'));
  });

  // Decision 9 : un compte de mission ouvre directement son unique base ; depuis un onglet, un
  // retour vers le tableau de bord le renverrait ici.
  test('compte de mission : pas de retour vers le tableau de bord depuis un onglet', async () => {
    renderWithTopBar(listingWith('viewer', {}, { expiresAt: inDays(120), canCreateStructuredData: true }), '/bases/b1');
    const bar = screen.getByRole('status', { name: 'barre haute' });
    expect(await screen.findByText('HOME')).toBeInTheDocument();
    await vi.waitFor(() => expect(bar).toHaveTextContent('Gliomes 2026 | undefined | undefined'));
    expect(screen.queryByRole('link', { name: 'Tableau de bord' })).toBeNull();
  });

  test('compte de mission : depuis une page interieure, le retour mene toujours a la base', async () => {
    renderWithTopBar(listingWith('viewer', {}, { expiresAt: inDays(120), canCreateStructuredData: true }), '/bases/b1/import');
    const bar = screen.getByRole('status', { name: 'barre haute' });
    expect(await screen.findByText('IMPORT')).toBeInTheDocument();
    await vi.waitFor(() => expect(bar).toHaveTextContent('Gliomes 2026 | /bases/b1 | Retour : Gliomes 2026'));
  });

  test('pendant le chargement, la barre ne promet aucun nom', () => {
    const pending = { getBase: () => new Promise<BaseListing>(() => {}) } as unknown as BaseRepository;
    render(
      <I18nProvider>
        <RepositoryProvider bases={pending}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <TopBarProbe>
              <Routes><Route path="/bases/:id" element={<BaseLayout />}><Route index element={<div>HOME</div>} /></Route></Routes>
            </TopBarProbe>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
    expect(screen.getByRole('status', { name: 'barre haute' })).toHaveTextContent('Chargement');
  });
});

// Audit UI mobile, lot 8 : mode « Terrain », preference de l'appareil. Seul Patients reste au
// premier niveau ; « Plus » mene aux memes destinations, avec les memes conditions d'affichage.
describe('BaseLayout — mode Terrain', () => {
  afterEach(() => { act(() => setTerrainMode(false)); });

  test('Patients, puis « Plus » avec les autres destinations du role', async () => {
    setTerrainMode(true);
    renderLayout(listingWith('owner'));
    const nav = await screen.findByRole('navigation', { name: 'Gliomes 2026' });
    expect(Array.from(nav.querySelectorAll('a'), (link) => link.textContent)).toEqual(['Patients']);
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    expect(screen.getByRole('button', { name: 'À compléter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyse' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Paramètres' }));
    // Meme destination que l'onglet, et ses sous-onglets restent la pour s'orienter.
    expect(await screen.findByText('REGLAGES')).toBeInTheDocument();
    expect(Array.from(screen.getByRole('navigation', { name: 'Paramètres' }).querySelectorAll('a'), (link) => link.textContent))
      .toEqual(['Général', 'Formulaire', 'Accès', 'Journal']);
    expect(screen.getByRole('button', { name: 'Plus' })).toHaveClass('border-teal-600');
  });

  test('« Plus » ne propose rien que le role n ouvre deja', async () => {
    setTerrainMode(true);
    renderLayout(listingWith('viewer'));
    await userEvent.click(await screen.findByRole('button', { name: 'Plus' }));
    expect(screen.getByRole('button', { name: 'Analyse' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paramètres' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'À compléter' })).toBeNull();
  });

  test('compte de mission : rien ne change, et l interrupteur suit en direct', async () => {
    renderLayout(listingWith('viewer', {}, { expiresAt: inDays(120), canCreateStructuredData: true }));
    const nav = await screen.findByRole('navigation', { name: 'Gliomes 2026' });
    act(() => setTerrainMode(true));
    expect(Array.from(nav.querySelectorAll('a'), (link) => link.textContent)).toEqual(['Patients']);
    expect(screen.queryByRole('button', { name: 'Plus' })).toBeNull();
  });

  test('desactive, les quatre onglets reviennent sans rechargement', async () => {
    setTerrainMode(true);
    renderLayout(listingWith('owner'));
    await screen.findByRole('button', { name: 'Plus' });
    act(() => setTerrainMode(false));
    const nav = screen.getByRole('navigation', { name: 'Gliomes 2026' });
    expect(Array.from(nav.querySelectorAll('a'), (link) => link.textContent))
      .toEqual(['Patients', 'À compléter', 'Analyse', 'Paramètres']);
    expect(screen.queryByRole('button', { name: 'Plus' })).toBeNull();
  });
});

// Audit UI mobile, lot 5 (5.9 Formulaire B) : un ecran de travail en plein ecran masque le fil
// d'Ariane et les onglets de la base, puis les rend en sortant.
function FocusProbe() {
  const [focused, setFocused] = useState(false);
  useBaseFocus(focused);
  return (
    <>
      <button type="button" onClick={() => setFocused(true)}>PLEIN ECRAN</button>
      <button type="button" onClick={() => setFocused(false)}>SORTIR</button>
    </>
  );
}

describe('BaseLayout — plein ecran', () => {
  test('un ecran enfant peut masquer les onglets le temps de son travail', async () => {
    const bases = { async getBase() { return listingWith('owner'); } } as unknown as BaseRepository;
    render(
      <I18nProvider>
        <RepositoryProvider bases={bases}>
          <MemoryRouter initialEntries={['/bases/b1/template']}>
            <Routes>
              <Route path="/bases/:id" element={<BaseLayout />}>
                {/* Comme dans AppRoutes : une garde de route intercale son propre Outlet. */}
                <Route element={<Outlet />}>
                  <Route path="template" element={<FocusProbe />} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
    expect(await screen.findByRole('navigation', { name: 'Gliomes 2026' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'PLEIN ECRAN' }));
    expect(screen.queryByRole('navigation', { name: 'Gliomes 2026' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tableau de bord' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'SORTIR' }));
    expect(screen.getByRole('navigation', { name: 'Gliomes 2026' })).toBeInTheDocument();
  });
});
