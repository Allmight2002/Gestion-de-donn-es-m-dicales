import { useLayoutEffect, useState } from 'react';

export interface OverflowEdges {
  start: boolean;
  end: boolean;
}

/**
 * Audit UI mobile, lot 1 (T1-B) : une rangee qui defile horizontalement doit laisser deviner
 * ce qui reste hors ecran (spec UX §6.1 : « un onglet hors ecran doit etre decouvrable »).
 * Renvoie une ref de rappel a poser sur le conteneur defilant, et les bords ou du contenu
 * depasse, recalcules au defilement comme au redimensionnement.
 */
export function useOverflowEdges<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [edges, setEdges] = useState<OverflowEdges>({ start: false, end: false });

  useLayoutEffect(() => {
    if (!element) return;
    const update = () => {
      // Une marge interieure cachee n'est pas du contenu : l'onglet actif amene en vue laisse
      // souvent la seule marge de droite hors ecran, sans qu'aucun onglet n'y reste.
      const style = getComputedStyle(element);
      const paddingStart = parseFloat(style.paddingLeft) || 0;
      const paddingEnd = parseFloat(style.paddingRight) || 0;
      const start = element.scrollLeft > paddingStart + 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - paddingEnd - 1;
      setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    [...element.children].forEach((child) => observer?.observe(child));
    return () => {
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [element]);

  return [setElement, edges] as const;
}

/** Classe d'estompage du bord ou il reste du contenu (voir `.scroll-fade-*` dans index.css). */
export function overflowFadeClass({ start, end }: OverflowEdges): string {
  if (start && end) return 'scroll-fade-both';
  if (end) return 'scroll-fade-end';
  if (start) return 'scroll-fade-start';
  return '';
}
