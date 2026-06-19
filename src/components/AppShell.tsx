import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n/useI18n';
import type { MessageKey } from '../i18n/messages';
import { LanguageSwitcher } from './LanguageSwitcher';

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, user, signOut } = useAuth();
  const { t } = useI18n();
  const roleLabel = profile ? t(`role.${profile.globalRole}` as MessageKey) : '';
  const isCurationStaff = profile?.globalRole === 'curateur' || profile?.globalRole === 'validateur';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-teal-700">{t('app.title')}</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {isCurationStaff && (
            <Link to="/curation" className="font-medium text-teal-700 hover:underline">
              {t('curation.pool_title')}
            </Link>
          )}
          <span className="text-slate-600">
            {profile?.fullName || user?.email}
            <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
              {roleLabel}
            </span>
          </span>
          <LanguageSwitcher />
          <button
            onClick={() => void signOut()}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100"
          >
            {t('shell.signout')}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
