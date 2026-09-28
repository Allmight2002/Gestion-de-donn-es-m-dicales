import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { useModalFocus } from './useModalFocus';

type Placement = { left: number } & ({ top: number } | { bottom: number });
/** Position de la bulle sur ordinateur, lue par les classes `sm:` du panneau. */
type PanelVars = CSSProperties & { '--help-left'?: string; '--help-top'?: string; '--help-bottom'?: string };

const PANEL_WIDTH = 320; // `sm:w-80`
const MIN_ROOM_BELOW = 240;

/**
 * Audit UI mobile, lot 1 (T3-B) — aide a la demande. Un ⓘ remplace un paragraphe d'aide
 * permanent : l'explication s'ouvre en panneau bas sur telephone, en bulle pres du bouton sur
 * ordinateur. Meme contrat que les autres fenetres (focus garde, Echap, focus rendu).
 * Un texte qui porte un avertissement ou un etat ne se range pas ici : il reste visible.
 */
export function HelpTip({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const { t } = useI18n();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const open = placement !== null;
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = () => setPlacement(null);
  useModalFocus(open, panel, close, { initialFocus: '[data-help-close]' });

  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - PANEL_WIDTH - 8));
    const bottom = rect?.bottom ?? 0;
    // Pres du bas de l'ecran, la bulle s'ouvre au-dessus du bouton plutot que d'etre coupee.
    setPlacement(window.innerHeight - bottom >= MIN_ROOM_BELOW
      ? { left, top: bottom + 8 }
      : { left, bottom: window.innerHeight - (rect?.top ?? 0) + 8 });
  };

  const above = placement !== null && 'bottom' in placement;
  const style: PanelVars | undefined = placement ? {
    '--help-left': `${placement.left}px`,
    ...('top' in placement ? { '--help-top': `${placement.top}px` } : { '--help-bottom': `${placement.bottom}px` }),
  } : undefined;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={show}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`icon-button shrink-0 ${className}`}
      >
        <Info size={16} aria-hidden />
      </button>
      {placement && createPortal(
        <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={style}
          className="fixed inset-0 z-50 flex items-end sm:block">
          <div className="absolute inset-0 bg-black/30 sm:bg-transparent" onClick={close} />
          <div className={`card relative max-h-[70dvh] w-full overflow-y-auto rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:absolute sm:left-(--help-left) sm:w-80 sm:rounded-b-2xl sm:pb-4 sm:shadow-lg ${
            above
              ? 'sm:bottom-(--help-bottom) sm:max-h-[calc(100dvh_-_var(--help-bottom)_-_1rem)]'
              : 'sm:top-(--help-top) sm:max-h-[calc(100dvh_-_var(--help-top)_-_1rem)]'
          }`}>
            <div className="flex items-start justify-between gap-2">
              <h2 id={titleId} className="section-title pt-2.5">{label}</h2>
              <button type="button" data-help-close onClick={close} aria-label={t('common.close')} className="icon-button -mr-2 -mt-1 shrink-0">
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{children}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Audit UI mobile, lot 3 (T3-A) — la phrase utile reste visible ; son explication (cle
 * `*_details`) s'ouvre derriere ce ⓘ, place en fin de phrase sans agrandir la ligne.
 */
export function HelpDetails({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return <HelpTip label={t('help.more')} className="-my-3 -mr-2 align-middle">{children}</HelpTip>;
}
