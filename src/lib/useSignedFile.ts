// §11 — Chargement d'une URL signee A LA DEMANDE (au clic), jamais au rendu de la liste.
// L'autorisation + l'audit (cote Edge en prod) ne se declenchent donc que pour une VRAIE
// tentative de consultation. `onReveal` permet d'ajouter une trace cote client (local/demo).
import { useCallback, useState } from 'react';

export interface SignedFileState {
  url: string | null;
  busy: boolean;
  error: boolean;
  /** Genere l'URL signee (et journalise via onReveal) ; renvoie l'URL ou null. */
  reveal: () => Promise<string | null>;
}

export function useSignedFile(load: () => Promise<string | null>, onReveal?: () => void): SignedFileState {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const reveal = useCallback(async (): Promise<string | null> => {
    if (busy) return url;
    setBusy(true);
    setError(false);
    try {
      const u = await load();
      if (u) {
        setUrl(u);
        onReveal?.();
      } else {
        setError(true);
      }
      return u;
    } catch {
      setError(true);
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, url, load, onReveal]);

  return { url, busy, error, reveal };
}
