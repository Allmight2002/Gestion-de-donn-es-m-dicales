import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n/useI18n';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';

export function LoginScreen() {
  const { signIn, sendPasswordReset, busy, error } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResetSent(false);
    await signIn(email, password);
  }

  async function onReset() {
    if (!email) return;
    const ok = await sendPasswordReset(email);
    if (ok) setResetSent(true);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Fond decoratif (degrade + halos) */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-teal-950" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-200/40 blur-3xl dark:bg-teal-900/30" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-teal-100/40 blur-3xl dark:bg-teal-950/50" />

      <div className="relative w-full max-w-sm">
        <div className="card p-7 shadow-xl shadow-slate-300/40 dark:shadow-black/30">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Logo className="h-10 w-10" />
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">{t('app.title')}</h1>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <LanguageSwitcher />
            </div>
          </div>
          <p className="mb-6 text-sm text-slate-500">{t('app.tagline')}</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{t('login.email')}</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{t('login.password')}</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
            </label>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            {resetSent && <p className="text-sm text-teal-700">{t('login.reset_sent')}</p>}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? t('login.signing_in') : t('login.submit')}
            </button>
          </form>

          <button type="button" onClick={() => void onReset()} className="mt-4 text-sm font-medium text-teal-700 hover:text-teal-800">
            {t('login.forgot')}
          </button>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">{t('app.title')}</p>
      </div>
    </div>
  );
}
