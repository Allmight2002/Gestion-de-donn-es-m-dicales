import { useEffect } from 'react';
import { useI18n } from '../i18n/useI18n';

// UI-2 — modale de confirmation (remplace window.confirm : themable, lisible, accessible).
// Echap ou clic sur le fond = annuler.
interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ open, title, body, confirmLabel, danger, busy, onConfirm, onCancel }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="card relative w-full max-w-sm space-y-3 p-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {body && <p className="text-sm text-slate-600">{body}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={busy} className="btn-secondary">{t('common.cancel')}</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={danger
              ? 'inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60'
              : 'btn-primary'}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
