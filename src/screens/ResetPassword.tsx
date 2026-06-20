import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n/useI18n';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Logo } from '../components/Logo';

const MIN_LENGTH = 8;

// Ecran de DEFINITION d'un nouveau mot de passe. Atteint via le lien de l'email de
// recuperation (qui ouvre une session temporaire) ; sert aussi a changer son mot de passe
// quand on est connecte. La mise a jour porte sur la session courante (auth.updateUser).
export function ResetPassword() {
  const { updatePassword, busy, error } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (password.length < MIN_LENGTH) {
      setLocalError(t('reset.too_short'));
      return;
    }
    if (password !== confirm) {
      setLocalError(t('reset.mismatch'));
      return;
    }
    const ok = await updatePassword(password);
    if (ok) setDone(true);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-50 via-white to-slate-100" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-200/40 blur-3xl" />
      <div className="card relative w-full max-w-sm p-7 shadow-xl shadow-slate-300/40">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo className="h-10 w-10" />
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">{t('reset.title')}</h1>
          </div>
          <LanguageSwitcher />
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-teal-700">{t('reset.success')}</p>
            <button
              onClick={() => navigate('/')}
              className="btn-primary w-full"
            >
              {t('reset.continue')}
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-sm text-slate-500">{t('reset.hint')}</p>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{t('reset.new_password')}</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{t('reset.confirm')}</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input"
              />
            </label>

            {(localError || error) && <p role="alert" className="text-sm text-red-600">{localError ?? error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full"
            >
              {busy ? t('reset.saving') : t('reset.submit')}
            </button>
            <button type="button" onClick={() => navigate('/login')} className="block w-full text-center text-sm font-medium text-teal-700 hover:text-teal-800">
              {t('reset.back_to_login')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
