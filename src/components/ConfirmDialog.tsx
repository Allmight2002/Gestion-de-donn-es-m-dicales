import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/useI18n';
import { useModalFocus } from './useModalFocus';

// UI-2 — modale de confirmation (remplace window.confirm : themable, lisible, accessible).
// Echap ou clic sur le fond = annuler.
interface Props {
  open: boolean;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ open, title, body, children, confirmLabel, cancelLabel, confirmDisabled, danger, busy, onConfirm, onCancel }: Props) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useModalFocus(open, dialogRef, onCancel, { blockEscape: !!busy });

  if (!open) return null;
  return createPortal(
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={body ? bodyId : undefined} aria-busy={busy || undefined}>
      <div className="absolute inset-0 bg-black/40" onClick={() => { if (!busy) onCancel(); }} />
      <div className="card relative w-full max-w-sm space-y-3 p-5">
        <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
        {body && <div id={bodyId} className="text-sm text-slate-600">{body}</div>}
        {children}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" data-dialog-cancel onClick={onCancel} disabled={busy} className="btn-secondary">{cancelLabel ?? t('common.cancel')}</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={(danger ? 'btn-danger' : 'btn-primary') + (busy ? ' btn-pending' : '')}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>, document.body,
  );
}
