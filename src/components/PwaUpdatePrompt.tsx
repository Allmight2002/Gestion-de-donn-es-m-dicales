import { useEffect, useState, useSyncExternalStore } from 'react';
import { requestPageLeave } from '../lib/useUnsavedChanges';
import { useI18n } from '../i18n/useI18n';
import { applyAppShellUpdate, getAppShellState, subscribeAppShell } from '../pwa/appShell';

export const PWA_REMIND_LATER_MS = 15 * 60 * 1000;
const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Active la nouvelle version uniquement apres une decision explicite. */
export function PwaUpdatePrompt() {
  const { t } = useI18n();
  const [applying, setApplying] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  // L'enregistrement se fait au demarrage, hors de React : le composant n'est plus qu'un
  // lecteur de son etat. Il ne decide donc plus si la coquille existe, seulement quand
  // proposer d'en activer une nouvelle version.
  const { needRefresh, registration } = useSyncExternalStore(subscribeAppShell, getAppShellState, getAppShellState);

  // Une SPA peut rester ouverte sans nouvelle navigation pendant des heures. Verifie au retour
  // au premier plan, a la reconnexion et periodiquement pour detecter le worker en attente.
  useEffect(() => {
    if (!registration) return undefined;
    const checkForUpdate = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void registration.update().catch(() => undefined);
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };
    window.addEventListener('focus', checkForUpdate);
    window.addEventListener('online', checkForUpdate);
    document.addEventListener('visibilitychange', checkWhenVisible);
    const interval = window.setInterval(checkForUpdate, PWA_UPDATE_CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', checkForUpdate);
      window.removeEventListener('online', checkForUpdate);
      document.removeEventListener('visibilitychange', checkWhenVisible);
    };
  }, [registration]);

  useEffect(() => {
    if (!deferred) return undefined;
    const reminder = window.setTimeout(() => setDeferred(false), PWA_REMIND_LATER_MS);
    return () => window.clearTimeout(reminder);
  }, [deferred]);

  if (!needRefresh || deferred) return null;

  const applyUpdate = async () => {
    if (!await requestPageLeave()) return;
    setApplying(true);
    setUpdateFailed(false);
    try {
      await applyAppShellUpdate();
    } catch {
      setUpdateFailed(true);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-x-3 z-[70] mx-auto max-w-xl rounded-xl border border-teal-200 bg-white p-4 shadow-xl dark:border-teal-800 dark:bg-slate-900"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('pwa.update_title')}</p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{t('pwa.update_body')}</p>
      {updateFailed && <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert">{t('pwa.update_error')}</p>}
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary w-full sm:w-auto" disabled={applying} onClick={() => setDeferred(true)}>
          {t('pwa.later')}
        </button>
        <button type="button" className="btn-primary w-full sm:w-auto" disabled={applying} onClick={() => void applyUpdate()}>
          {applying ? t('pwa.updating') : t('pwa.update_now')}
        </button>
      </div>
    </div>
  );
}
