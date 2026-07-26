import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import {
  Database, FileText, KeyRound, Inbox, LayoutDashboard, LogOut, Menu, RefreshCw, Search, Users, X,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n/useI18n';
import type { MessageKey } from '../i18n/messages';
import { flushOutbox, isOfflineEnabled, useOnline, useOutbox, type FlushDeps } from '../data/offline';
import { usePatientRepository } from '../data/RepositoryProvider';
import { recentBases } from '../lib/recentBases';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { Logo } from './Logo';
import { CommandPalette, OPEN_PALETTE_EVENT } from './CommandPalette';
import { errorMessage } from '../lib/errorMessage';

function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s.@]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase();
}

interface NavItem {
  to: string;
  labelKey: MessageKey;
  Icon: typeof LayoutDashboard;
  end?: boolean;
  badge?: number;
  badgeDanger?: boolean;
}

// UI-1 — coquille avec BARRE LATERALE persistante : destinations globales toujours visibles
// (fini les boutons d'orientation eparpilles dans les pages), bases recentes, recherche Ctrl+K
// decouvrable, profil/theme/langue ancres en bas. Mobile : barre haute + tiroir.
export function AppShell({ children }: { children: ReactNode }) {
  const { profile, user, signOut, error: authError } = useAuth();
  const { t } = useI18n();
  const online = useOnline();
  const patients = usePatientRepository();
  const outboxEntries = useOutbox();
  const unsyncedEntries = outboxEntries.filter((e) => ['pending', 'syncing', 'conflict', 'rejected'].includes(e.state));
  const pendingCount = outboxEntries.filter((e) => e.state === 'pending').length;
  const conflictCount = outboxEntries.filter((e) => e.state === 'conflict').length;
  const rejectedCount = outboxEntries.filter((e) => e.state === 'rejected').length;
  const syncing = useRef(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Synchronisation automatique : des qu'on est en ligne avec des modifs en attente, on rejoue
  // la file via la RPC validee (verrou optimiste). S'execute au retour du reseau ou a l'ouverture.
  useEffect(() => {
    if (!isOfflineEnabled() || !online || pendingCount === 0 || syncing.current) return;
    const deps: FlushDeps = {
      updateEncounter: (id, data, status, reason, exp, operationId) => patients.updateEncounter(id, data, status, reason, exp, operationId),
      getEncounter: (id) => patients.getEncounter(id),
    };
    syncing.current = true;
    void flushOutbox(deps)
      .then((report) => setSyncError(report.errors.length ? report.errors.join('; ') : null))
      .catch((error) => setSyncError(errorMessage(error, t('common.error'))))
      .finally(() => { syncing.current = false; });
  }, [online, pendingCount, patients, t]);

  const role = profile?.globalRole;
  const roleLabel = profile ? t(`role.${profile.globalRole}` as MessageKey) : '';
  const displayName = profile?.fullName || user?.email || '';
  const syncBadge = unsyncedEntries.length;

  const requestSignOut = () => {
    if (unsyncedEntries.length === 0) void signOut();
    else setConfirmSignOut(true);
  };
  const exportUnsynced = () => {
    const blob = new Blob([JSON.stringify(unsyncedEntries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meddata-modifications-non-synchronisees-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const nav: NavItem[] =
    role === 'curateur'
      ? [
          { to: '/curation', labelKey: 'curation.pool_title', Icon: Inbox },
          { to: '/sync', labelKey: 'sync.title', Icon: RefreshCw, badge: syncBadge, badgeDanger: conflictCount + rejectedCount > 0 },
        ]
      : role === 'system_admin'
        ? [
            { to: '/admin', labelKey: 'staff.admin.title', Icon: FileText, end: true },
            { to: '/admin/roles', labelKey: 'roleadmin.title', Icon: KeyRound },
          ]
        : [
            { to: '/', labelKey: 'member.dashboard.title', Icon: LayoutDashboard, end: true },
            { to: '/groups', labelKey: 'group.title', Icon: Users },
            { to: '/templates', labelKey: 'mytemplates.title', Icon: FileText },
            { to: '/sync', labelKey: 'sync.title', Icon: RefreshCw, badge: syncBadge, badgeDanger: conflictCount + rejectedCount > 0 },
          ];

  const recents = role === 'medecin' ? recentBases() : [];

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
      isActive ? 'bg-teal-700 text-white dark:bg-teal-600' : 'text-slate-600 hover:bg-slate-100'
    }`;

  const sidebarContent = (
    <>
      <Link to="/" className="flex items-center gap-2.5 px-2 pb-4" onClick={() => setDrawerOpen(false)}>
        <Logo className="h-8 w-8" />
        <span className="text-sm font-semibold tracking-tight text-slate-900">{t('app.title')}</span>
      </Link>

      <button
        type="button"
        onClick={() => { setDrawerOpen(false); window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)); }}
        className="mb-3 flex w-full items-center justify-between rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
      >
        <span className="flex items-center gap-1.5"><Search size={13} aria-hidden /> {t('search.button')}</span>
        <kbd className="rounded bg-slate-100 px-1 font-mono text-[10px]">Ctrl K</kbd>
      </button>

      <nav className="flex flex-col gap-0.5" aria-label={t('search.title')}>
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} onClick={() => setDrawerOpen(false)}>
            <item.Icon size={16} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
            {item.badge != null && item.badge > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${item.badgeDanger ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {recents.length > 0 && (
        <div className="mt-4">
          <p className="px-2.5 pb-1 text-[11px] font-medium text-slate-400">{t('nav.recent_bases')}</p>
          <div className="flex flex-col gap-0.5">
            {recents.map((b) => (
              <NavLink key={b.id} to={`/bases/${b.id}`} className={navLinkClass} onClick={() => setDrawerOpen(false)}>
                <Database size={15} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg px-1 py-1.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800">
          {initialsOf(displayName)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-slate-800">{displayName}</div>
          <div className="truncate text-xs text-slate-500">{roleLabel}</div>
        </div>
        <button onClick={requestSignOut} title={t('shell.signout')} aria-label={t('shell.signout')} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <LogOut size={16} aria-hidden />
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen text-slate-900">
      {/* Barre laterale fixe (>= lg). */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto border-r border-slate-200/70 bg-white/80 p-3 backdrop-blur-md lg:flex">
        {sidebarContent}
      </aside>

      {/* Barre haute mobile (< lg) + tiroir. */}
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2">
            <Logo className="h-8 w-8" />
            <span className="text-sm font-semibold tracking-tight text-slate-900">{t('app.title')}</span>
          </Link>
          <div className="flex items-center gap-2">
            {syncBadge > 0 && (
              <Link to="/sync" className={`rounded-full px-2 py-0.5 text-xs font-semibold ${conflictCount + rejectedCount > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                {syncBadge}
              </Link>
            )}
            <button onClick={() => setDrawerOpen(true)} aria-label={t('nav.open_menu')} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100">
              <Menu size={18} aria-hidden />
            </button>
          </div>
        </div>
      </header>
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col overflow-y-auto bg-white p-3 shadow-xl">
            <button onClick={() => setDrawerOpen(false)} aria-label={t('nav.close_menu')} className="self-end rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              <X size={16} aria-hidden />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        {authError && (
          <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">{authError}</div>
        )}
        {syncError && (
          <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">{syncError}</div>
        )}
        {!online && (
          <div role="status" className="border-b border-amber-200 bg-amber-50 text-amber-900">
            <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-2 text-sm">
              <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-amber-200 text-xs">⚠</span>
              <span>{isOfflineEnabled() ? t('offline.banner') : 'Hors connexion : le stockage local de donnees medicales est desactive par la politique de securite.'}</span>
            </div>
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
      <CommandPalette />
      {confirmSignOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('logout.unsynced_title')}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmSignOut(false)} />
          <div className="card relative w-full max-w-md space-y-3 p-5">
            <h2 className="text-base font-semibold text-slate-900">{t('logout.unsynced_title')}</h2>
            <p className="text-sm text-slate-600">{t('logout.unsynced_body').replace('{n}', String(unsyncedEntries.length))}</p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" onClick={() => setConfirmSignOut(false)} className="btn-secondary">{t('common.cancel')}</button>
              <button type="button" onClick={exportUnsynced} className="btn-secondary">{t('sync.export')}</button>
              <button type="button" onClick={() => { setConfirmSignOut(false); void signOut(); }} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
                {t('logout.destroy_and_signout')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
