import { useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

const MAX_REASON_LENGTH = 1_000;

// Suppression logique avec MOTIF obligatoire (cahier critere 12). Reutilise pour
// patient / rencontre / image.
export function DeleteWithReason({
  label,
  onConfirm,
  onSuccess,
  verifyDeletedAfterError,
}: {
  label?: string;
  /** Must resolve only once the server has acknowledged the deletion. */
  onConfirm: (reason: string) => Promise<void>;
  onSuccess?: () => void | Promise<void>;
  /** Reconciles an ambiguous transport error without ever retrying the mutation. */
  verifyDeletedAfterError?: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setReason('');
    setError(null);
  };

  const confirm = async () => {
    const trimmedReason = reason.trim();
    if (busy) return;
    if (!trimmedReason) {
      setError('Le motif de la suppression est requis.');
      return;
    }
    if (trimmedReason.length > MAX_REASON_LENGTH || [...trimmedReason].some((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127;
    })) {
      setError(`Le motif doit contenir au plus ${MAX_REASON_LENGTH} caractères et ne pas contenir de caractères de contrôle.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onConfirm(trimmedReason);
      await onSuccess?.();
      setOpen(false);
      setReason('');
    } catch (e) {
      // A timeout can happen after the server committed. Re-read only; never replay
      // the deletion, which would duplicate the audit reason on a non-idempotent RPC.
      try {
        if (verifyDeletedAfterError && await verifyDeletedAfterError()) {
          await onSuccess?.();
          setOpen(false);
          setReason('');
          return;
        }
      } catch {
        // The original error remains the actionable error when reconciliation fails.
      }
      setError(errorMessage(e, 'La suppression a échoué. Vérifiez votre connexion ou vos autorisations, puis réessayez.'));
    } finally {
      setBusy(false);
    }
  };

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
        maxLength={MAX_REASON_LENGTH}
        disabled={busy}
        onChange={(e) => { setReason(e.target.value); setError(null); }}
      />
      <button
        disabled={busy || !reason.trim()}
        onClick={() => { void confirm(); }}
        className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {t('del.confirm')}
      </button>
      <button disabled={busy} onClick={close} className="text-xs text-slate-500 hover:underline disabled:opacity-50">
        {t('common.cancel')}
      </button>
      {error && <p role="alert" className="basis-full text-xs text-red-600">{error}</p>}
    </span>
  );
}
