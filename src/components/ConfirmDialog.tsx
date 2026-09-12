import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/useI18n';

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
  const callbacks = useRef({ busy, onCancel });
  const titleId = useId();
  const bodyId = useId();
  useLayoutEffect(() => { callbacks.current = { busy, onCancel }; });

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.body.children].filter((element) => element !== dialog && !element.contains(dialog)) as HTMLElement[];
    const previous = background.map((element) => ({ element, inert: element.inert, hidden: element.getAttribute('aria-hidden') }));
    previous.forEach(({ element }) => { element.inert = true; element.setAttribute('aria-hidden', 'true'); });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
      .filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0 && !element.closest('[hidden]'));
    const initial = dialog.querySelector<HTMLElement>('[data-dialog-cancel]:not(:disabled)') ?? focusable()[0] ?? dialog;
    initial.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!callbacks.current.busy) callbacks.current.onCancel();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0] ?? dialog;
      const last = items.at(-1) ?? dialog;
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)
        || (!event.shiftKey && document.activeElement === last) || items.length === 0) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) (focusable()[0] ?? dialog).focus();
    };
    // Ecoute sur `window` en capture : c'est le seul noeud traverse par TOUS les evenements
    // clavier, y compris ceux emis directement sur la fenetre. Un ecouteur pose sur `document`
    // rate ces derniers, et Echap resterait sans effet.
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      previous.forEach(({ element, inert, hidden }) => {
        element.inert = inert;
        if (hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', hidden);
      });
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus();
    };
  }, [open]);

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
