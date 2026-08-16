// L31 — sections personnalisables.
//
// La SECTION est le regroupement visuel du formulaire, propre a chaque base. Ce n'est pas
// une categorie de donnee : le lot n'en introduit aucune. Un registre de traumatisme
// cranien se structure en « identification / circonstances / examen initial / imagerie /
// prise en charge / evolution », et ces regroupements n'ont de sens que pour lui.
//
// Ce module tient les DEUX regles qui empechent le lot de changer quoi que ce soit a
// l'existant : l'ordre de repli et le libelle de repli.

import type { TemplateField, TemplateSection } from '../data/types';

/**
 * Les trois codes historiques, DANS LEUR ORDRE D'ORIGINE.
 *
 * Ils ne sont plus figes en base — ce sont desormais des sections ordinaires — mais leur
 * ORDRE reste la reference de repli. Sans cela, une base qui n'a pas encore reordonne ses
 * sections verrait son formulaire se reorganiser tout seul au deploiement, ce que le lot
 * interdit explicitement.
 */
export const LEGACY_SECTION_KEYS = ['clinique', 'biologie', 'paraclinique'] as const;
export type LegacySectionKey = (typeof LEGACY_SECTION_KEYS)[number];

export const isLegacySectionKey = (key: string): key is LegacySectionKey =>
  (LEGACY_SECTION_KEYS as readonly string[]).includes(key);

/**
 * Cles de traduction des trois sections historiques.
 *
 * Leur libelle reste TRADUIT, alors qu'une section creee par une base affiche le libelle
 * qu'elle lui a donne. Sans cette preference, une base existante verrait « Clinical »
 * devenir « Clinique » pour un lecteur anglophone le jour du deploiement.
 */
export const LEGACY_SECTION_LABEL_KEY = {
  clinique: 'section.clinique',
  biologie: 'section.biologie',
  paraclinique: 'section.paraclinique',
} as const satisfies Record<LegacySectionKey, string>;

type SectionLabelKey = (typeof LEGACY_SECTION_LABEL_KEY)[LegacySectionKey] | 'section.other';

/** Libelle a afficher pour une section : traduit si elle est historique, stocke sinon. */
export function sectionLabel(
  t: (key: SectionLabelKey) => string,
  section: { sectionKey: string; label?: string | null },
): string {
  if (isLegacySectionKey(section.sectionKey)) return t(LEGACY_SECTION_LABEL_KEY[section.sectionKey]);
  if (section.sectionKey === FALLBACK_SECTION_KEY) return t('section.other');
  const label = typeof section.label === 'string' ? section.label.trim() : '';
  return label === '' ? section.sectionKey : label;
}

/**
 * Section de secours. Une variable dont la section est absente, vide ou illisible tombe
 * ici et RESTE AFFICHEE. C'est le filet : sans lui, elle disparaitrait du formulaire sans
 * que personne ne s'en apercoive — et une variable invisible n'est jamais saisie.
 */
export const FALLBACK_SECTION_KEY = 'other';

/** Rang de repli : les codes historiques d'abord, dans leur ordre ; le reste ensuite. */
const legacyRank = (key: string): number => {
  const index = (LEGACY_SECTION_KEYS as readonly string[]).indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

/** Code de section exploitable, ou le filet si la variable n'en porte pas. */
export const sectionKeyOf = (field: Pick<TemplateField, 'section'>): string => {
  const raw = typeof field.section === 'string' ? field.section.trim() : '';
  return raw === '' ? FALLBACK_SECTION_KEY : raw;
};

export interface SectionGroup<T> {
  key: string;
  /** Libelle brut stocke ; `null` quand seul le code est connu. La traduction reste a l'appelant. */
  label: string | null;
  isLegacy: boolean;
  isFallback: boolean;
  fields: T[];
}

/**
 * Regroupe des variables par section, dans l'ordre a afficher.
 *
 * L'ordre retenu, par priorite :
 *   1. le rang voulu par le proprietaire (`sectionOrder`, ou la liste `sections` fournie) ;
 *   2. a defaut, l'ordre historique des trois codes d'origine ;
 *   3. a defaut encore, l'ordre de premiere apparition des variables ;
 *   4. le filet, toujours en dernier.
 *
 * Les sections VIDES ne sont pas rendues : c'est le comportement d'origine, et c'est lui
 * qui permet a une liste de sections partagee entre variables patient et variables
 * rencontre de n'afficher sur chaque ecran que ce qui le concerne.
 */
export function groupFieldsBySection<T extends Pick<TemplateField, 'section' | 'sectionLabel' | 'sectionOrder'>>(
  fields: T[],
  sections?: readonly TemplateSection[] | null,
): SectionGroup<T>[] {
  const declared = new Map<string, { label: string; order: number }>();
  for (const section of sections ?? []) {
    declared.set(section.sectionKey, { label: section.label, order: section.displayOrder });
  }

  const groups = new Map<string, { group: SectionGroup<T>; order: number; seen: number }>();
  fields.forEach((field, index) => {
    const key = sectionKeyOf(field);
    const existing = groups.get(key);
    if (existing) {
      existing.group.fields.push(field);
      return;
    }
    const fromList = declared.get(key);
    const label = fromList?.label ?? (typeof field.sectionLabel === 'string' && field.sectionLabel.trim() !== ''
      ? field.sectionLabel
      : null);
    const order = fromList?.order
      ?? (typeof field.sectionOrder === 'number' ? field.sectionOrder : legacyRank(key));
    groups.set(key, {
      order,
      seen: index,
      group: {
        key,
        label,
        isLegacy: isLegacySectionKey(key),
        isFallback: key === FALLBACK_SECTION_KEY,
        fields: [field],
      },
    });
  });

  return [...groups.values()]
    .sort((a, b) => {
      // Le filet ferme toujours la marche, quel que soit son rang nominal.
      if (a.group.isFallback !== b.group.isFallback) return a.group.isFallback ? 1 : -1;
      return a.order - b.order || a.seen - b.seen;
    })
    .map((entry) => entry.group);
}
