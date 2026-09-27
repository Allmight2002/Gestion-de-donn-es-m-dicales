import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Audit UI mobile, lot 1 (T1-B) — barre haute contextuelle.
 *
 * Sur telephone et tablette (< lg), un ecran peut remplacer le logo de la barre haute par son
 * contexte : le retour vers l'ecran parent (‹) ou la fermeture d'un formulaire (✕), puis le nom
 * de ce qu'on consulte. « Ou suis-je, comment revenir » tient alors en un seul endroit, au lieu
 * d'un fil d'Ariane, d'un titre repete et d'un bouton « Retour » empiles au-dessus du contenu.
 */
export interface TopBarConfig {
  title: string;
  /** ‹ : lien vers l'ecran parent. */
  backTo?: string;
  backLabel?: string;
  /** ✕ : quitter le formulaire, meme effet que « Annuler » (modifications non enregistrees gardees). */
  onClose?: () => void;
  closeLabel?: string;
  /** Pendant une saisie, la barre defile avec la page : la hauteur utile va aux champs. */
  scrolls?: boolean;
}

interface Registry {
  add(id: symbol, config: TopBarConfig): void;
  update(id: symbol, config: TopBarConfig): void;
  remove(id: symbol): void;
}

const TopBarRegistryContext = createContext<Registry | null>(null);

/** Etat de la barre, tenu par la coquille : le dernier ecran inscrit l'emporte. */
export function useTopBarRegistry() {
  const [entries, setEntries] = useState<{ id: symbol; config: TopBarConfig }[]>([]);
  const registry = useMemo<Registry>(() => ({
    add: (id, config) => setEntries((current) => [...current.filter((entry) => entry.id !== id), { id, config }]),
    // Une mise a jour garde la place de l'inscription : un titre qui se charge ne doit pas
    // faire passer un ecran parent devant l'ecran qu'il contient.
    update: (id, config) => setEntries((current) => current.map((entry) => (entry.id === id ? { id, config } : entry))),
    remove: (id) => setEntries((current) => current.filter((entry) => entry.id !== id)),
  }), []);
  return { active: entries.at(-1)?.config ?? null, registry };
}

export function TopBarRegistryProvider({ registry, children }: { registry: Registry; children: ReactNode }) {
  return <TopBarRegistryContext.Provider value={registry}>{children}</TopBarRegistryContext.Provider>;
}

/** Inscrit le contexte de l'ecran dans la barre haute. Sans coquille (tests, bancs), ne fait rien. */
export function useTopBar(config: TopBarConfig | null) {
  const registry = useContext(TopBarRegistryContext);
  const [id] = useState(() => Symbol('top-bar'));
  const onClose = useRef(config?.onClose);
  useLayoutEffect(() => { onClose.current = config?.onClose; });

  const enabled = config !== null;
  const title = config?.title ?? '';
  const backTo = config?.backTo;
  const backLabel = config?.backLabel;
  const closeLabel = config?.closeLabel;
  const scrolls = config?.scrolls;
  const closable = !!config?.onClose;
  const snapshot = useMemo<TopBarConfig>(() => ({
    title, backTo, backLabel, closeLabel, scrolls,
    onClose: closable ? () => onClose.current?.() : undefined,
  }), [title, backTo, backLabel, closeLabel, scrolls, closable]);

  const latest = useRef(snapshot);
  useLayoutEffect(() => { latest.current = snapshot; });
  useLayoutEffect(() => {
    if (!registry || !enabled) return;
    registry.add(id, latest.current);
    return () => registry.remove(id);
  }, [registry, enabled, id]);
  useLayoutEffect(() => {
    if (registry && enabled) registry.update(id, snapshot);
  }, [registry, enabled, id, snapshot]);
}
