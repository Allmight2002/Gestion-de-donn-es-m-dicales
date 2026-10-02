import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { ChartPie, ChevronDown, ClipboardCheck, Clock, LayoutGrid, Settings, Users } from 'lucide-react';
import { Menu, MenuItem } from '../../components/Menu';
import { useTerrainMode } from '../../lib/terrainMode';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository } from '../../data/RepositoryProvider';
import { offlineCache, useOnline } from '../../data/offline';
import type { BaseListing } from '../../data/bases';
import { useTopBar } from '../../components/TopBar';
import { overflowFadeClass, useOverflowEdges } from '../../lib/useOverflowEdges';
import { BaseFocusContext, BaseRenamedContext } from './baseFocus';

// La page d'une base tient en QUATRE destinations. Dix onglets de meme poids obligeaient a
// faire defiler une barre pour atteindre ce qu'on ouvre deux fois par an, alors que la saisie
// quotidienne tient en trois ecrans. Les ecrans enfants ne changent pas : ils sont regroupes
// derriere un onglet parent et une barre de sous-onglets, et gardent leurs URL.
interface SubTab {
  to: string;
  labelKey: MessageKey;
  when: boolean;
}

interface Tab {
  labelKey: MessageKey;
  Icon: typeof Users;
  active: boolean;
  subs: SubTab[];
}

export function BaseLayout() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const online = useOnline();
  const bases = useBaseRepository();
  const [terrainMode] = useTerrainMode();
  const [listing, setListing] = useState<BaseListing | null>(null);
  const [name, setName] = useState('');
  const [failed, setFailed] = useState(false);
  const tabBar = useRef<HTMLElement>(null);
  const [tabScroller, tabEdges] = useOverflowEdges<HTMLDivElement>();
  const [subTabScroller, subTabEdges] = useOverflowEdges<HTMLDivElement>();
  // Plein ecran demande par un ecran de travail (`useBaseFocus`).
  const [focused, setFocused] = useState(false);

  // UX-12 : le fil d'Ariane ne doit jamais garder le nom de la base precedente. L'etat est
  // remis a zero PENDANT le rendu, avant toute lecture, et non dans un effet.
  const [context, setContext] = useState(id);
  if (context !== id) { setContext(id); setListing(null); setName(''); setFailed(false); }

  useEffect(() => {
    let alive = true;
    if (!id) return;
    setFailed(false);
    if (!online) {
      // HORS-LIGNE : nom depuis l'instantane local ; pas de listing -> onglet Patients seul.
      setListing(null);
      offlineCache.get(id).then((s) => { if (alive && s) setName(s.baseName); }).catch(() => { if (alive) setFailed(true); });
    } else {
      bases.getBase(id)
        .then((b) => { if (!alive) return; if (b) { setListing(b); setName(b.base.name); } else setFailed(true); })
        .catch(() => { if (alive) setFailed(true); });
    }
    return () => { alive = false; };
  }, [id, online, bases]);

  // Sur telephone, la barre d'onglets defile : l'onglet actif doit etre amene en vue sans
  // faire defiler la page ni prendre le focus a une saisie en cours.
  useEffect(() => {
    const active = tabBar.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [pathname, name]);

  const isOwner = listing?.role === 'owner';
  const canEdit = isOwner || listing?.permissions.canEditStructuredData === true;
  // Compte de mission : l'acces porte une echeance. Le parcours se reduit alors a la
  // saisie — ni statistiques, ni journal, ni cohortes. La base applique les memes regles.
  const missionUntil = listing?.expiresAt ?? null;
  const isMission = missionUntil !== null;
  const openToMember = !!listing && !isMission;
  const daysLeft = missionUntil ? Math.ceil((Date.parse(missionUntil) - Date.now()) / 86_400_000) : null;

  const base = `/bases/${id}`;
  const under = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  // Les conditions d'affichage restent CELLES DE CHAQUE ECRAN : le regroupement ne donne
  // acces a rien de nouveau (et la base refuse de toute facon ce que le role ne permet pas).
  const allTabs: Tab[] = [
    {
      labelKey: 'base.tab_patients',
      Icon: Users,
      active: pathname === base || under(`${base}/import`),
      subs: [{ to: base, labelKey: 'base.tab_patients', when: true }],
    },
    {
      labelKey: 'base.tab_queue',
      Icon: ClipboardCheck,
      active: under(`${base}/queue`) || under(`${base}/codings`) || under(`${base}/propositions`) || under(`${base}/diagnostics`)
        || under(`${base}/curation`),
      subs: [
        { to: `${base}/queue`, labelKey: 'base.tab_queue', when: !!canEdit },
        // Diagnostics a coder : meme droit que la file et que le serveur (`list_pending_codings`
        // exige `can_edit_structured_data`). L'ecran avait une adresse, mais aucun sous-onglet.
        { to: `${base}/codings`, labelKey: 'base.tab_codings', when: !!canEdit },
        { to: `${base}/propositions`, labelKey: 'base.tab_proposals', when: !!isOwner },
        // L56 : la vue transversale des cas non couverts appartient au medecin proprietaire.
        { to: `${base}/diagnostics`, labelKey: 'base.tab_diagnostics', when: !!isOwner },
        { to: `${base}/curation`, labelKey: 'base.tab_curation', when: !!isOwner },
      ],
    },
    {
      labelKey: 'base.tab_analysis',
      Icon: ChartPie,
      active: under(`${base}/cohorts`) || under(`${base}/stats`) || under(`${base}/export`),
      subs: [
        // L'export vient EN PREMIER : c'est ce qu'on vient chercher ici. La constitution de
        // cohortes reste accessible juste a cote, pour qui en a besoin.
        {
          to: `${base}/export`,
          labelKey: 'base.tab_export',
          when: !!(isOwner || listing?.permissions.canExportData),
        },
        {
          to: `${base}/cohorts`,
          labelKey: 'base.tab_cohorts',
          when: !!(isOwner || listing?.permissions.canExportData || listing?.permissions.canEditStructuredData),
        },
        { to: `${base}/stats`, labelKey: 'base.tab_stats', when: openToMember },
      ],
    },
    {
      labelKey: 'base.tab_settings',
      Icon: Settings,
      // `missions` n'a plus d'entree propre (la barre laterale gere tous les comptes de
      // mission d'un coup), mais un lien deja envoye ne doit pas ouvrir un ecran orphelin.
      active: under(`${base}/parametres`) || under(`${base}/template`) || under(`${base}/formulaires`) || under(`${base}/access`)
        || under(`${base}/activity`) || under(`${base}/missions`),
      subs: [
        { to: `${base}/parametres`, labelKey: 'base.tab_general', when: openToMember },
        { to: `${base}/template`, labelKey: 'base.tab_template', when: !!isOwner },
        { to: `${base}/formulaires`, labelKey: 'base.tab_entry_forms', when: !!isOwner },
        { to: `${base}/access`, labelKey: 'base.tab_access', when: !!(isOwner || listing?.permissions.canManageAccess) },
        { to: `${base}/activity`, labelKey: 'base.tab_activity', when: openToMember },
      ],
    },
  ];

  const tabs = allTabs
    .map((tab) => ({ ...tab, subs: tab.subs.filter((sub) => sub.when) }))
    .filter((tab) => tab.subs.length > 0);

  const subTabs = tabs.find((tab) => tab.active)?.subs ?? [];
  // Lot 8, mode « Terrain » (preference de l'appareil) : seul l'onglet Patients reste au premier
  // niveau ; les autres passent dans « Plus », avec les memes destinations et les memes droits.
  // Un compte de mission n'a deja que Patients : rien ne change pour lui.
  const terrain = terrainMode && !isMission && tabs.length > 1;
  const shownTabs = terrain ? tabs.slice(0, 1) : tabs;
  const moreTabs = terrain ? tabs.slice(1) : [];
  const moreActive = moreTabs.some((tab) => tab.active);

  // Audit UI mobile, lot 1 (T1-B) : sur telephone, la barre haute porte le nom de la base et le
  // retour, a la place du fil d'Ariane. Depuis un onglet, on remonte au tableau de bord ; depuis
  // une page interieure (import), a la liste de la base. La structure des onglets, et non les
  // droits encore en chargement, decide de ce qui est un onglet.
  const displayName = name || (failed ? t('common.error') : t('common.loading'));
  const atTab = allTabs.some((tab) => tab.subs.some((sub) => sub.to === pathname));
  // Decision 9 : un compte de mission ouvre directement son unique base ; depuis un onglet, il
  // n'a pas d'accueil ou remonter (le tableau de bord le renverrait ici).
  const backToDashboard = atTab && !isMission;
  useTopBar({
    title: displayName,
    backTo: atTab ? (backToDashboard ? '/' : undefined) : base,
    backLabel: backToDashboard || !atTab
      ? t('nav.back_to').replace('{label}', atTab ? t('member.dashboard.title') : displayName)
      : undefined,
  });

  return (
    <section className="space-y-4">
      {!focused && (
        <>
        <p className="hidden text-sm text-slate-400 lg:block">
          {!isMission && (
            <>
              <Link to="/" className="underline decoration-slate-300 underline-offset-4 hover:text-teal-700">{t('member.dashboard.title')}</Link>
              <span aria-hidden> › </span>
            </>
          )}
          {/* Ni le nom precedent, ni une affirmation d'existence : chargement, nom connu, ou echec. */}
          <span className="text-slate-600">{displayName}</span>
        </p>

        {/* Bandeau permanent du compte de mission : l'echeance ne doit jamais surprendre. */}
        {isMission && missionUntil && (
          <p
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
              daysLeft !== null && daysLeft <= 14
                ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200'
                : 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200'
            }`}
          >
            <Clock size={15} aria-hidden />
            {daysLeft !== null && daysLeft <= 14
              ? t('mission.banner_soon')
                  .replace('{d}', new Date(missionUntil).toLocaleDateString())
                  .replace('{n}', String(Math.max(daysLeft, 0)))
              : t('mission.banner').replace('{d}', new Date(missionUntil).toLocaleDateString())}
          </p>
        )}

        {/* En mode Terrain, deux onglets tiennent sans defilement : la barre ne defile plus, et
            le panneau de « Plus » n'est pas rogne par elle. */}
        <div ref={tabScroller} className={terrain ? '' : `-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 ${overflowFadeClass(tabEdges)}`}>
          <nav ref={tabBar} aria-label={name || t('base.navigation')} className="flex min-w-max gap-1 border-b border-slate-200">
            {shownTabs.map((tab) => (
              // L'onglet parent mene a sa premiere entree disponible et reste allume pour toutes
              // les autres : NavLink ne sait pas faire ca, l'etat actif est donc calcule ici.
              <Link
                key={tab.labelKey}
                to={tab.subs[0]!.to}
                aria-current={tab.active ? 'page' : undefined}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  tab.active ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.Icon size={15} aria-hidden />
                {t(tab.labelKey)}
              </Link>
            ))}
            {moreTabs.length > 0 && (
              <Menu
                triggerLabel={t('terrain.more')}
                triggerClassName={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  moreActive ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
                // Ni « ⋯ » (actions de l'ecran, dans la barre haute) : une grille de destinations.
                triggerContent={<><LayoutGrid size={15} aria-hidden />{t('terrain.more')}<ChevronDown size={14} aria-hidden /></>}
              >
                {moreTabs.map((tab) => (
                  <MenuItem key={tab.labelKey} onSelect={() => navigate(tab.subs[0]!.to)}>
                    <tab.Icon size={15} aria-hidden />
                    <span aria-current={tab.active ? 'page' : undefined}>{t(tab.labelKey)}</span>
                  </MenuItem>
                ))}
              </Menu>
            )}
          </nav>
        </div>

        {subTabs.length > 1 && (
          <div ref={subTabScroller} className={`-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 ${overflowFadeClass(subTabEdges)}`}>
            <nav aria-label={t(tabs.find((tab) => tab.active)!.labelKey)} className="flex min-w-max gap-1">
              {subTabs.map((sub) => (
                <NavLink
                  key={sub.to}
                  to={sub.to}
                  end
                  className={({ isActive }) =>
                    `rounded-full px-3 py-1.5 text-sm font-medium transition ${
                      isActive ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                    }`
                  }
                >
                  {t(sub.labelKey)}
                </NavLink>
              ))}
            </nav>
          </div>
        )}
        </>
      )}

      <BaseFocusContext.Provider value={setFocused}>
        <BaseRenamedContext.Provider value={setName}>
          <Outlet />
        </BaseRenamedContext.Provider>
      </BaseFocusContext.Provider>
    </section>
  );
}
