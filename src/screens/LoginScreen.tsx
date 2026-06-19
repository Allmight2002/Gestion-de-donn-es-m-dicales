import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n/useI18n';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-teal-700">{t('app.title')}</h1>
          <LanguageSwitcher />
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
              className="w-full rounded border border-slate-300 px-3 py-2"
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
              className="w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {resetSent && <p className="text-sm text-teal-700">{t('login.reset_sent')}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-teal-700 px-3 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? t('login.signing_in') : t('login.submit')}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void onReset()}
          className="mt-4 text-sm text-teal-700 hover:underline"
        >
          {t('login.forgot')}
        </button>
      </div>
    </div>
  );
}
