import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Audit UI mobile, lot 1 (T1-B) — barre haute contextuelle.
 *
 * Sur telephone et tablette (< lg), un ecran peut remplacer le logo de la barre haute par son
 * contexte : le retour vers l'ecran parent (‹) ou la fermeture d'un formulaire (✕), puis le nom
 * de ce qu'on consulte. « Ou suis-je, comment revenir » tient alors en un seul endroit, au lieu
 * d'un fil d'Ariane, d'un titre repete et d'un bouton « Retour » empiles au-dessus du contenu.
 *
 * Lot 2 : un ecran peut aussi y ranger ses actions secondaires, dans un menu « ⋯ ». Le contexte
 * et les actions s'inscrivent separement : la page d'une base donne son nom, l'onglet ouvert
 * donne ses actions.
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

/** Action secondaire rangee dans « ⋯ » : elle doit exister aussi ailleurs a partir de `lg`. */
export interface TopBarAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface Entry {
  id: symbol;
  context?: TopBarConfig;
  actions?: TopBarAction[];
}

interface Registry {
  add(entry: Entry): void;
  update(entry: Entry): void;
  remove(id: symbol): void;
}

const TopBarRegistryContext = createContext<Registry | null>(null);

/** Etat de la barre, tenu par la coquille : le dernier ecran inscrit l'emporte. */
export function useTopBarRegistry() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const registry = useMemo<Registry>(() => ({
    add: (entry) => setEntries((current) => [...current.filter((item) => item.id !== entry.id), entry]),
    // Une mise a jour garde la place de l'inscription : un titre qui se charge ne doit pas
    // faire passer un ecran parent devant l'ecran qu'il contient.
    update: (entry) => setEntries((current) => current.map((item) => (item.id === entry.id ? entry : item))),
    remove: (id) => setEntries((current) => current.filter((item) => item.id !== id)),
  }), []);
  const latestFirst = [...entries].reverse();
  return {
    active: latestFirst.find((entry) => entry.context)?.context ?? null,
    actions: latestFirst.find((entry) => entry.actions)?.actions ?? [],
    registry,
  };
}

export function TopBarRegistryProvider({ registry, children }: { registry: Registry; children: ReactNode }) {
  return <TopBarRegistryContext.Provider value={registry}>{children}</TopBarRegistryContext.Provider>;
}

/** Inscription stable : ajoutee au montage, mise a jour sur place, retiree au demontage. */
function useRegistryEntry(enabled: boolean, snapshot: Omit<Entry, 'id'>) {
  const registry = useContext(TopBarRegistryContext);
  const [id] = useState(() => Symbol('top-bar'));
  const latest = useRef(snapshot);
  useLayoutEffect(() => { latest.current = snapshot; });
  useLayoutEffect(() => {
    if (!registry || !enabled) return;
    registry.add({ id, ...latest.current });
    return () => registry.remove(id);
  }, [registry, enabled, id]);
  useLayoutEffect(() => {
    if (registry && enabled) registry.update({ id, ...snapshot });
  }, [registry, enabled, id, snapshot]);
}

/** Inscrit le contexte de l'ecran dans la barre haute. Sans coquille (tests, bancs), ne fait rien. */
export function useTopBar(config: TopBarConfig | null) {
  const onClose = useRef(config?.onClose);
  useLayoutEffect(() => { onClose.current = config?.onClose; });

  const title = config?.title ?? '';
  const backTo = config?.backTo;
  const backLabel = config?.backLabel;
  const closeLabel = config?.closeLabel;
  const scrolls = config?.scrolls;
  const closable = !!config?.onClose;
  const snapshot = useMemo<Omit<Entry, 'id'>>(() => ({
    context: {
      title, backTo, backLabel, closeLabel, scrolls,
      onClose: closable ? () => onClose.current?.() : undefined,
    },
  }), [title, backTo, backLabel, closeLabel, scrolls, closable]);
  useRegistryEntry(config !== null, snapshot);
}

/**
 * Range les actions secondaires de l'ecran dans le menu « ⋯ » de la barre haute (< lg).
 * Les gestionnaires restent ceux du dernier rendu ; seuls les libelles et l'etat desactive
 * decident d'une mise a jour.
 */
export function useTopBarActions(actions: TopBarAction[] | null) {
  const latest = useRef(actions);
  useLayoutEffect(() => { latest.current = actions; });
  const signature = JSON.stringify((actions ?? []).map((action) => [action.label, !!action.disabled]));
  const snapshot = useMemo<Omit<Entry, 'id'>>(() => ({
    actions: (JSON.parse(signature) as [string, boolean][]).map(([label, disabled], index) => ({
      label,
      disabled,
      onSelect: () => latest.current?.[index]?.onSelect(),
    })),
  }), [signature]);
  useRegistryEntry(!!actions && actions.length > 0, snapshot);
}
