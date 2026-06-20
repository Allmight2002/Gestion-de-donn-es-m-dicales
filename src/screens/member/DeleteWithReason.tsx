import { useState } from 'react';
import { useI18n } from '../../i18n/useI18n';

// Suppression logique avec MOTIF obligatoire (cahier critere 12). Reutilise pour
// patient / rencontre / image.
export function DeleteWithReason({
  label,
  onConfirm,
  busy,
}: {
  label?: string;
  onConfirm: (reason: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-red-600 hover:underline">
        {label ?? t('del.button')}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        aria-label={t('del.reason')}
        placeholder={t('del.reason')}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        disabled={busy || !reason.trim()}
        onClick={() => {
          void onConfirm(reason.trim());
          setOpen(false);
          setReason('');
        }}
        className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {t('del.confirm')}
      </button>
      <button onClick={() => { setOpen(false); setReason(''); }} className="text-xs text-slate-500 hover:underline">
        {t('common.cancel')}
      </button>
    </span>
  );
}
