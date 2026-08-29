import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useI18n } from '../i18n/useI18n';
import { useAuth } from '../auth/useAuth';
import {
  discardPwaRegistrationIfDisallowed,
  isPwaRegistrationAllowed,
} from '../pwa/registrationPolicy';

export const PWA_REMIND_LATER_MS = 15 * 60 * 1000;
const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * La purge de securite supprime toutes les registrations au logout et au changement de compte.
 * Le composant est donc monte seulement apres cette purge, et remonte pour chaque utilisateur.
 */
export function AuthenticatedPwaUpdatePrompt() {
  const { status, user } = useAuth();
  if (status !== 'signed_in' || !user || !isPwaRegistrationAllowed()) return null;
  return <PwaUpdatePrompt key={user.id} />;
}

/** Active la nouvelle version uniquement apres une decision explicite. */
export function PwaUpdatePrompt() {
  const { t } = useI18n();
  const [applying, setApplying] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const mounted = useRef(true);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, nextRegistration) {
      if (!mounted.current || !isPwaRegistrationAllowed()) {
        void discardPwaRegistrationIfDisallowed(nextRegistration);
        return;
      }
      setRegistration(nextRegistration ?? null);
    },
  });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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
    setApplying(true);
    setUpdateFailed(false);
    try {
      await updateServiceWorker(true);
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
