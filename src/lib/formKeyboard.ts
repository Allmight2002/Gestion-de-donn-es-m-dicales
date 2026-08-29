import type { KeyboardEvent } from 'react';

// A2 (saisie rapide au clavier) : Ctrl/Cmd + Entree enregistre le formulaire depuis N'IMPORTE
// quel champ (y compris un select ou une date, ou la touche Entree seule ne soumet pas).
// requestSubmit() declenche EXACTEMENT le meme chemin qu'un clic sur « Enregistrer » (validation
// HTML native + handler onSubmit) -> aucun comportement divergent, aucune ecriture supplementaire.
export function saveOnCtrlEnter(e: KeyboardEvent<HTMLFormElement>): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    e.currentTarget.requestSubmit();
  }
}
