import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n/useI18n';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-teal-700">{t('reset.title')}</h1>
          <LanguageSwitcher />
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-teal-700">{t('reset.success')}</p>
            <button
              onClick={() => navigate('/')}
              className="w-full rounded bg-teal-700 px-3 py-2 font-medium text-white hover:bg-teal-800"
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
                className="w-full rounded border border-slate-300 px-3 py-2"
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
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>

            {(localError || error) && <p role="alert" className="text-sm text-red-600">{localError ?? error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-teal-700 px-3 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {busy ? t('reset.saving') : t('reset.submit')}
            </button>
            <button type="button" onClick={() => navigate('/login')} className="block w-full text-center text-sm text-teal-700 hover:underline">
              {t('reset.back_to_login')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
