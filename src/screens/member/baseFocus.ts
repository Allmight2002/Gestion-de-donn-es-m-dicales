import { createContext, useContext, useEffect } from 'react';

/**
 * Audit UI mobile, lot 5 (5.9 Formulaire B) — plein ecran dans la page d'une base.
 *
 * Un ecran de travail (l'edition du formulaire) masque le fil d'Ariane et les onglets de sa
 * base le temps de son travail, et porte seul la barre haute. Un contexte React, et non celui
 * de l'Outlet : les gardes de route intercalent leur propre Outlet, qui ne le transmettrait pas.
 */
export const BaseFocusContext = createContext<((focused: boolean) => void) | null>(null);

/** Plein ecran tant que `active` ; retour a la page de la base au demontage. Hors d'une base : sans effet. */
export function useBaseFocus(active: boolean): void {
  const setFocused = useContext(BaseFocusContext);
  useEffect(() => {
    if (!setFocused) return;
    setFocused(active);
    return () => setFocused(false);
  }, [active, setFocused]);
}
