import { useLayoutEffect, useRef, type RefObject } from 'react';

interface ModalFocusOptions {
  /** Echap reste sans effet, par exemple pendant une operation en cours. */
  blockEscape?: boolean;
  /** Element qui recoit le focus a l'ouverture, avant le premier element focalisable. */
  initialFocus?: string;
}

/**
 * Contrat commun des fenetres modales (UX-13) : fond inerte et masque aux lecteurs d'ecran,
 * defilement de la page bloque, focus initial dans la fenetre, Tab et Maj+Tab gardes dedans,
 * Echap pour fermer, focus rendu a l'element d'origine. Partage par `ConfirmDialog` et le
 * panneau d'aide `HelpTip`, pour qu'un seul comportement existe dans l'application.
 */
export function useModalFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  { blockEscape = false, initialFocus = '[data-dialog-cancel]:not(:disabled)' }: ModalFocusOptions = {},
) {
  const callbacks = useRef({ blockEscape, onEscape });
  useLayoutEffect(() => { callbacks.current = { blockEscape, onEscape }; });

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
    const initial = dialog.querySelector<HTMLElement>(initialFocus) ?? focusable()[0] ?? dialog;
    initial.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Une liste recherchable ouverte (combobox ARIA) se referme d'abord, comme une liste
        // native : Echap ne ferme la fenetre qu'au second appui.
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.getAttribute('role') === 'combobox' && target.getAttribute('aria-expanded') === 'true'
          && dialog.contains(target)) return;
        event.preventDefault(); event.stopPropagation();
        if (!callbacks.current.blockEscape) callbacks.current.onEscape();
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
  }, [open, dialogRef, initialFocus]);
}
