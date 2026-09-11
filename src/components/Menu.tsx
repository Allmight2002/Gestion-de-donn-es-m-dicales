import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// D9 — menu flottant a fermeture explicite.
//
// Remplace les <details>/<summary> natifs utilises comme menus : l'element natif ne se
// ferme ni au clic exterieur ni a Echap, et chaque ligne de liste portait le sien, donc
// plusieurs menus pouvaient rester ouverts en meme temps.
//
// Comportement attendu (spec D9) :
//  - fermeture au `pointerdown` hors du menu (light-dismiss) ;
//  - fermeture a Echap, avec retour du focus sur le bouton declencheur ;
//  - fermeture a la selection d'une entree (Menu.Item) ;
//  - un seul menu ouvert a la fois : le pointeur qui ouvre un second menu tombe hors du
//    premier, qui se ferme donc avant que le second ne s'ouvre ;
//  - ouverture vers le HAUT quand le bas de la fenetre ne laisse pas la place : sinon le
//    menu de la DERNIERE ligne d'une liste s'ouvre hors de l'ecran.
//
// L'API native `popover="auto"` fournit ce light-dismiss sans code, mais n'est pas
// garantie sur les navigateurs vises (telephones anciens) : le comportement est donc
// code explicitement.
//
// Les entrees restent de simples boutons tabulables, sans role `menu`/`menuitem` : la
// navigation clavier par fleches d'un vrai menu n'etant pas fournie, des boutons
// tabulables sont plus accessibles qu'une semantique de menu incomplete.

interface MenuContextValue {
  close(): void;
}

const MenuContext = createContext<MenuContextValue>({ close: () => {} });

/** Ecart vertical entre le declencheur et le panneau (le `mt-2` des appelants). */
const PANEL_GAP_PX = 8;

export function Menu({
  triggerLabel,
  triggerClassName,
  triggerContent,
  children,
  panelClassName,
}: {
  /** Nom accessible du bouton declencheur (aria-label). */
  triggerLabel: string;
  /** Classes du bouton declencheur (une primitive `btn-*` ou `icon-button`). */
  triggerClassName?: string;
  /** Contenu visible du bouton declencheur. */
  triggerContent: ReactNode;
  /** Entrees (Menu.Item) ou contenu libre du panneau. */
  children: ReactNode;
  /** Classes du panneau flottant ; un panneau par defaut est fourni. */
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);

  // Le panneau s'ouvre sous le declencheur. Sur la derniere ligne d'une liste cette place
  // manque souvent avant le bas de la fenetre : on bascule alors au-dessus, du cote ou il y
  // a le plus de place. Mesure avant peinture, donc sans saut visible.
  useLayoutEffect(() => {
    if (!open) {
      setFlipUp(false);
      return;
    }
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setFlipUp(below < panel.offsetHeight + PANEL_GAP_PX && rect.top > below);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {triggerContent}
      </button>
      {open && (
        <div
          ref={panelRef}
          className={panelClassName ?? 'card absolute right-0 z-10 mt-2 w-48 space-y-1 p-2 shadow-lg'}
          /* Neutralise le `mt-2` des appelants : ici c'est la mesure qui decide du cote. */
          style={flipUp ? { top: 'auto', bottom: '100%', marginTop: 0, marginBottom: PANEL_GAP_PX } : undefined}
        >
          <MenuContext.Provider value={{ close }}>{children}</MenuContext.Provider>
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  className,
  disabled,
}: {
  /** Action a lancer apres fermeture du menu. */
  onSelect(): void;
  children: ReactNode;
  /** Classes du bouton ; `btn-ghost w-full justify-start` par defaut. */
  className?: string;
  disabled?: boolean;
}) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      onClick={() => {
        close();
        onSelect();
      }}
      disabled={disabled}
      className={className ?? 'btn-ghost w-full justify-start'}
    >
      {children}
    </button>
  );
}