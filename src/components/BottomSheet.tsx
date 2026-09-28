import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { useModalFocus } from './useModalFocus';

/**
 * Audit UI mobile, lot 2 — panneau bas : un choix qui se fait au pouce (sommaire d'un
 * formulaire…) s'ouvre par-dessus la page au lieu de la repousser. Meme contrat que les
 * autres fenetres (fond inerte, focus garde, Echap, focus rendu). Monte = ouvert.
 */
export function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(true, panel, onClose, { initialFocus: '[data-sheet-close]' });
  return createPortal(
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="card relative max-h-[80dvh] w-full overflow-y-auto rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="section-title pt-2.5">{title}</h2>
          <button type="button" data-sheet-close onClick={onClose} aria-label={t('common.close')} className="icon-button -mr-2 -mt-1 shrink-0">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
