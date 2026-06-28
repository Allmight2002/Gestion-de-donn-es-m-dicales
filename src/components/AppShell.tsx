import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n/useI18n';
import type { MessageKey } from '../i18n/messages';
import { useOnline } from '../data/offline';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Logo } from './Logo';

function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s.@]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, user, signOut } = useAuth();
  const { t } = useI18n();
  const online = useOnline();
  const roleLabel = profile ? t(`role.${profile.globalRole}` as MessageKey) : '';
  const isCurationStaff = profile?.globalRole === 'curateur';
  const displayName = profile?.fullName || user?.email || '';

  return (
    <div className="min-h-screen text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="h-9 w-9" />
            <span className="text-base font-semibold tracking-tight text-slate-900">{t('app.title')}</span>
          </Link>

          <div className="flex items-center gap-3 text-sm">
            {isCurationStaff && (
              <Link to="/curation" className="hidden font-medium text-teal-700 hover:text-teal-800 sm:inline">
                {t('curation.pool_title')}
              </Link>
            )}
            <div className="hidden items-center gap-2 sm:flex">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800">
                {initialsOf(displayName)}
              </span>
              <div className="leading-tight">
                <div className="font-medium text-slate-800">{displayName}</div>
                <div className="text-xs text-slate-500">{roleLabel}</div>
              </div>
            </div>
            <LanguageSwitcher />
            <button onClick={() => void signOut()} className="btn-secondary">
              {t('shell.signout')}
            </button>
          </div>
        </div>
      </header>

      {!online && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 text-amber-900">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-2 text-sm">
            <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-amber-200 text-xs">⚠</span>
            <span>{t('offline.banner')}</span>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
