import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router';
import { ChartPie, ClipboardCheck, Clock, Settings, Users } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository } from '../../data/RepositoryProvider';
import { offlineCache, useOnline } from '../../data/offline';
import type { BaseListing } from '../../data/bases';

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
  const { t } = useI18n();
  const online = useOnline();
  const bases = useBaseRepository();
  const [listing, setListing] = useState<BaseListing | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    let alive = true;
    if (!id) return;
    if (!online) {
      // HORS-LIGNE : nom depuis l'instantane local ; pas de listing -> onglet Patients seul.
      setListing(null);
      offlineCache.get(id).then((s) => { if (alive && s) setName(s.baseName); }).catch(() => {});
    } else {
      bases.getBase(id).then((b) => { if (alive && b) { setListing(b); setName(b.base.name); } }).catch(() => {});
    }
    return () => { alive = false; };
  }, [id, online, bases]);

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
      active: under(`${base}/queue`) || under(`${base}/propositions`) || under(`${base}/curation`),
      subs: [
        { to: `${base}/queue`, labelKey: 'base.tab_queue', when: !!canEdit },
        { to: `${base}/propositions`, labelKey: 'base.tab_proposals', when: !!isOwner },
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
      active: under(`${base}/parametres`) || under(`${base}/template`) || under(`${base}/access`)
        || under(`${base}/activity`) || under(`${base}/missions`),
      subs: [
        { to: `${base}/parametres`, labelKey: 'base.tab_general', when: openToMember },
        { to: `${base}/template`, labelKey: 'base.tab_template', when: !!isOwner },
        { to: `${base}/access`, labelKey: 'base.tab_access', when: !!(isOwner || listing?.permissions.canManageAccess) },
        { to: `${base}/activity`, labelKey: 'base.tab_activity', when: openToMember },
      ],
    },
  ];

  const tabs = allTabs
    .map((tab) => ({ ...tab, subs: tab.subs.filter((sub) => sub.when) }))
    .filter((tab) => tab.subs.length > 0);

  const subTabs = tabs.find((tab) => tab.active)?.subs ?? [];

  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-400">
          <Link to="/" className="underline decoration-slate-300 underline-offset-4 hover:text-teal-700">{t('member.dashboard.title')}</Link>
        <span aria-hidden> › </span>
        <span className="text-slate-600">{name || '…'}</span>
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

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <nav aria-label={name} className="flex min-w-max gap-1 border-b border-slate-200">
          {tabs.map((tab) => (
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
        </nav>
      </div>

      {subTabs.length > 1 && (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
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

      <Outlet />
    </section>
  );
}
