import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { ChartPie, ClipboardCheck, ClipboardList, Clock, FileText, History, KeyRound, TrendingUp, Upload, UserPlus, Users } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository } from '../../data/RepositoryProvider';
import { offlineCache, useOnline } from '../../data/offline';
import type { BaseListing } from '../../data/bases';

// UI-1 (3/3) — la page d'une base passe en ONGLETS : fil d'Ariane + barre d'onglets, et les ecrans
// existants sont reutilises TELS QUELS via <Outlet/> (aucune logique dupliquee). Les onglets suivent
// les MEMES conditions d'affichage que les anciens boutons eparpilles de BaseHome.
interface Tab {
  to: string;
  end?: boolean;
  labelKey: MessageKey;
  Icon: typeof Users;
}

export function BaseLayout() {
  const { id } = useParams();
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
  const daysLeft = missionUntil ? Math.ceil((Date.parse(missionUntil) - Date.now()) / 86_400_000) : null;

  const tabs: Tab[] = [
    { to: `/bases/${id}`, end: true, labelKey: 'base.tab_patients', Icon: Users },
    ...(canEdit ? [{ to: `/bases/${id}/import`, labelKey: 'base.tab_import' as MessageKey, Icon: Upload }] : []),
    ...(isOwner || listing?.permissions.canExportData || listing?.permissions.canEditStructuredData
      ? [{ to: `/bases/${id}/cohorts`, labelKey: 'base.tab_cohorts' as MessageKey, Icon: ChartPie }]
      : []),
    ...(canEdit ? [{ to: `/bases/${id}/queue`, labelKey: 'base.tab_queue' as MessageKey, Icon: ClipboardCheck }] : []),
    ...(listing && !isMission ? [{ to: `/bases/${id}/stats`, labelKey: 'base.tab_stats' as MessageKey, Icon: TrendingUp }] : []),
    ...(listing && !isMission ? [{ to: `/bases/${id}/activity`, labelKey: 'base.tab_activity' as MessageKey, Icon: History }] : []),
    ...(isOwner || listing?.permissions.canManageAccess
      ? [{ to: `/bases/${id}/access`, labelKey: 'base.tab_access' as MessageKey, Icon: KeyRound }]
      : []),
    ...(isOwner
      ? [{ to: `/bases/${id}/missions`, labelKey: 'mission.tab' as MessageKey, Icon: UserPlus }]
      : []),
    ...(isOwner ? [{ to: `/bases/${id}/template`, labelKey: 'base.tab_template' as MessageKey, Icon: FileText }] : []),
    ...(isOwner ? [{ to: `/bases/${id}/curation`, labelKey: 'base.tab_curation' as MessageKey, Icon: ClipboardList }] : []),
  ];

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
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`
              }
            >
              <tab.Icon size={15} aria-hidden />
              {t(tab.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
    </section>
  );
}
