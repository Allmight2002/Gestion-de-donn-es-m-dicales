import { useEffect, useState } from 'react';

/**
 * Bascule en cartes sous 768 px (§8.1). Sans `matchMedia` — jsdom, rendu serveur — on reste sur
 * le tableau : c'est la forme complete, et aucune information n'y est perdue.
 */
export function useNarrowViewport(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  return narrow;
}
