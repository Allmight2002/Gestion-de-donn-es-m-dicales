import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useI18n } from '../i18n/useI18n';

/** Active la nouvelle version uniquement apres une decision explicite. */
export function PwaUpdatePrompt() {
  const { t } = useI18n();
  const [applying, setApplying] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  const applyUpdate = async () => {
    setApplying(true);
    try {
      await updateServiceWorker(true);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-xl rounded-xl border border-teal-200 bg-white p-4 shadow-xl" role="status">
      <p className="text-sm font-semibold text-slate-900">{t('pwa.update_title')}</p>
      <p className="mt-1 text-xs text-slate-600">{t('pwa.update_body')}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-secondary" disabled={applying} onClick={() => setNeedRefresh(false)}>
          {t('pwa.later')}
        </button>
        <button type="button" className="btn-primary" disabled={applying} onClick={() => void applyUpdate()}>
          {applying ? t('pwa.updating') : t('pwa.update_now')}
        </button>
      </div>
    </div>
  );
}
