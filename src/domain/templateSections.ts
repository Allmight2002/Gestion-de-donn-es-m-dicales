// L31 — sections personnalisables.
//
// La SECTION est le regroupement visuel du formulaire, propre a chaque base. Ce n'est pas
// une categorie de donnee : le lot n'en introduit aucune. Un registre de traumatisme
// cranien se structure en « identification / circonstances / examen initial / imagerie /
// prise en charge / evolution », et ces regroupements n'ont de sens que pour lui.
//
// Ce module tient les DEUX regles qui empechent le lot de changer quoi que ce soit a
// l'existant : l'ordre de repli et le libelle de repli.

import type { TemplateCommonLayout, TemplateField, TemplateSection, ValidationRule } from '../data/types';
import { visibilityRulesOf } from './templateRules';
import { visibilityConditionHolds } from './validation';

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

type SectionLabelKey = (typeof LEGACY_SECTION_LABEL_KEY)[LegacySectionKey] | 'section.other' | 'section.common';

/** Libelle a afficher pour une section : traduit si elle est historique, stocke sinon. */
export function sectionLabel(
  t: (key: SectionLabelKey) => string,
  section: { sectionKey: string | null; label?: string | null },
): string {
  if (section.sectionKey === null || section.sectionKey === '__common__') return t('section.common');
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
  parentSectionKey?: string | null;
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
 * Les sections VIDES ne sont pas rendues quand elles ne portent aucun descendant visible :
 * c'est le comportement d'origine, et c'est lui qui permet a une liste de sections partagee
 * entre variables patient et variables rencontre de n'afficher sur chaque ecran que ce qui le
 * concerne. Un parent intermediaire est conserve uniquement pour porter un descendant visible.
 */
function groupFieldsBySectionLegacy<T extends Pick<TemplateField, 'section' | 'sectionLabel' | 'sectionOrder'> & Partial<Pick<TemplateField, 'parentSectionKey' | 'parentSectionLabel' | 'displayOrder'>>>(
  fields: T[],
  sections?: readonly TemplateSection[] | null,
): SectionGroup<T>[] {
  const hierarchy = new Map((sections ?? []).map((s) => [s.sectionKey, s]));
  for (const f of fields) {
    if (f.section && f.parentSectionKey && !hierarchy.has(f.section)) hierarchy.set(f.section, {
      id: f.section, sectionKey: f.section, label: f.sectionLabel ?? f.section,
      displayOrder: f.sectionOrder ?? 0, parentSectionKey: f.parentSectionKey,
    });
    if (f.parentSectionKey && !hierarchy.has(f.parentSectionKey)) hierarchy.set(f.parentSectionKey, {
      id: f.parentSectionKey, sectionKey: f.parentSectionKey, label: f.parentSectionLabel ?? f.parentSectionKey,
      displayOrder: f.sectionOrder ?? 0,
    });
  }
  const declared = new Map<string, { label: string; order: number }>();
  for (const section of sections ?? []) {
    declared.set(section.sectionKey, { label: section.label, order: section.displayOrder });
  }

  const groups = new Map<string, { group: SectionGroup<T>; order: number; seen: number }>();
  fields.forEach((field, index) => {
    const key = field.section === null ? '__common__' : sectionKeyOf(field);
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
        parentSectionKey: hierarchy.get(key)?.parentSectionKey ?? null,
        isLegacy: isLegacySectionKey(key),
        isFallback: key === FALLBACK_SECTION_KEY,
        fields: [field],
      },
    });
  });

  const hierarchical = [...hierarchy.values()].some((s) => s.parentSectionKey);
  if (hierarchical) {
    for (const { group } of [...groups.values()]) {
      let parentKey = group.parentSectionKey ?? null;
      const visited = new Set<string>();
      while (parentKey && !visited.has(parentKey)) {
        visited.add(parentKey);
        const parent = hierarchy.get(parentKey);
        if (!parent) break;
        if (!groups.has(parent.sectionKey)) groups.set(parent.sectionKey, {
          order: parent.displayOrder, seen: -1,
          group: {
            key: parent.sectionKey, label: parent.label,
            parentSectionKey: parent.parentSectionKey ?? null,
            isLegacy: isLegacySectionKey(parent.sectionKey), isFallback: false, fields: [],
          },
        });
        parentKey = parent.parentSectionKey ?? null;
      }
    }
  }
  // Une hiérarchie peut créer des groupes intermédiaires uniquement pour porter un descendant.
  // Ils restent affichables tant qu'un descendant porte une variable visible, afin de conserver
  // le chemin et le titre de chaque sous-section ; un groupe entièrement masqué disparaît.
  const childrenByParent = new Map<string, string[]>();
  for (const { group } of groups.values()) if (group.parentSectionKey) {
    const children = childrenByParent.get(group.parentSectionKey) ?? [];
    children.push(group.key);
    childrenByParent.set(group.parentSectionKey, children);
  }
  const hasFieldsOrDescendants = (key: string, visited = new Set<string>()): boolean => {
    if (visited.has(key)) return false;
    visited.add(key);
    const entry = groups.get(key);
    if (entry?.group.fields.length) return true;
    return (childrenByParent.get(key) ?? []).some((child) => hasFieldsOrDescendants(child, visited));
  };
  const visibleGroups = [...groups.values()].filter(({ group }) => hasFieldsOrDescendants(group.key));

  return visibleGroups
    .sort((a, b) => {
      if (a.group.key === '__common__' || b.group.key === '__common__') return a.group.key === '__common__' ? -1 : 1;
      if (hierarchical && !a.group.isFallback && !b.group.isFallback) {
        const ar = groups.get(a.group.parentSectionKey ?? a.group.key) ?? a;
        const br = groups.get(b.group.parentSectionKey ?? b.group.key) ?? b;
        const rootOrder = ar.order - br.order || ar.group.key.localeCompare(br.group.key);
        if (rootOrder) return rootOrder;
        if (!!a.group.parentSectionKey !== !!b.group.parentSectionKey) return a.group.parentSectionKey ? 1 : -1;
      }
      // Le filet ferme toujours la marche, quel que soit son rang nominal.
      if (a.group.isFallback !== b.group.isFallback) return a.group.isFallback ? 1 : -1;
      return a.order - b.order || a.seen - b.seen;
    })
    .map((entry) => ({ ...entry.group, fields: hierarchical
      ? [...entry.group.fields].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      : entry.group.fields }));
}

type PresentationField = Pick<TemplateField, 'section' | 'sectionLabel' | 'sectionOrder' | 'fieldKey'>
  & Partial<Pick<TemplateField, 'parentSectionKey' | 'parentSectionLabel' | 'displayOrder'>>;

/**
 * UX-16 : fusionne les blocs racines existants et les rubriques communes sans transformer
 * ces dernieres en sections. Les ancres comptent les blocs DECLARES, pas les seuls blocs
 * visibles dans la portee courante : une rubrique reste donc au bon endroit meme si un
 * ecran patient ne rend aucun champ d'un bloc reserve aux rencontres.
 */
function groupFieldsByCommonLayout<T extends PresentationField>(
  fields: T[],
  sections: readonly TemplateSection[] | null | undefined,
  layout: TemplateCommonLayout,
): SectionGroup<T>[] {
  const hierarchy = new Map((sections ?? []).map((section) => [section.sectionKey, section]));
  for (const field of fields) {
    if (field.section && field.parentSectionKey && !hierarchy.has(field.section)) hierarchy.set(field.section, {
      id: field.section, sectionKey: field.section, label: field.sectionLabel ?? field.section,
      displayOrder: field.sectionOrder ?? 0, parentSectionKey: field.parentSectionKey,
    });
    if (field.parentSectionKey && !hierarchy.has(field.parentSectionKey)) hierarchy.set(field.parentSectionKey, {
      id: field.parentSectionKey, sectionKey: field.parentSectionKey,
      label: field.parentSectionLabel ?? field.parentSectionKey, displayOrder: field.sectionOrder ?? 0,
    });
  }

  const declared = new Map((sections ?? []).map((section) => [section.sectionKey, {
    label: section.label, order: section.displayOrder,
  }]));
  const groupByField = new Map<string, { key: string; label: string; anchor: number; order: number; fieldOrder: number }>();
  layout.groups.forEach((group, index) => group.fields.forEach((fieldKey, fieldOrder) => {
    // En cas de lecture incoherente, la premiere rubrique reste deterministe et le champ
    // reste visible ; l'ecriture server-side refuse, elle, tout doublon.
    if (!groupByField.has(fieldKey)) groupByField.set(fieldKey, {
      key: group.key, label: group.label, anchor: group.anchor, order: index, fieldOrder,
    });
  }));

  const fallback = layout.groups.find((group) => group.key === layout.defaultKey) ?? layout.groups[0];
  const defaultGroup = fallback
    ? {
      key: fallback.key, label: fallback.label, anchor: fallback.anchor,
      order: layout.groups.indexOf(fallback), fieldOrder: Number.MAX_SAFE_INTEGER,
    }
    : undefined;

  type Entry = {
    group: SectionGroup<T>;
    seen: number;
    common?: { anchor: number; order: number };
  };
  const entries = new Map<string, Entry>();
  fields.forEach((field, seen) => {
    // Une variable commune creee APRES le dernier enregistrement n'a pas encore de
    // rattachement : elle rejoint la rubrique par defaut, en fin de liste. Sans cela, le
    // formulaire ferait reapparaitre un « Tronc commun » a cote des rubriques nommees, pour
    // une variable que personne n'a placee ailleurs.
    const linked = field.section === null
      ? groupByField.get(field.fieldKey) ?? defaultGroup
      : undefined;
    const key = linked ? `__common_group__:${linked.key}` : field.section === null ? '__common__' : sectionKeyOf(field);
    const existing = entries.get(key);
    if (existing) {
      existing.group.fields.push(field);
      return;
    }
    const declaredSection = declared.get(key);
    entries.set(key, {
      seen,
      common: linked ? { anchor: linked.anchor, order: linked.order } : undefined,
      group: {
        key,
        label: linked?.label ?? declaredSection?.label
          ?? (typeof field.sectionLabel === 'string' && field.sectionLabel.trim() !== '' ? field.sectionLabel : null),
        parentSectionKey: linked ? null : hierarchy.get(key)?.parentSectionKey ?? null,
        isLegacy: isLegacySectionKey(key),
        isFallback: key === FALLBACK_SECTION_KEY,
        fields: [field],
      },
    });
  });

  const hierarchical = [...hierarchy.values()].some((section) => section.parentSectionKey);
  if (hierarchical) {
    for (const { group } of [...entries.values()]) {
      let parentKey = group.parentSectionKey ?? null;
      const visited = new Set<string>();
      while (parentKey && !visited.has(parentKey)) {
        visited.add(parentKey);
        const parent = hierarchy.get(parentKey);
        if (!parent) break;
        if (!entries.has(parent.sectionKey)) entries.set(parent.sectionKey, {
          seen: -1,
          group: {
            key: parent.sectionKey, label: parent.label,
            parentSectionKey: parent.parentSectionKey ?? null,
            isLegacy: isLegacySectionKey(parent.sectionKey), isFallback: false, fields: [],
          },
        });
        parentKey = parent.parentSectionKey ?? null;
      }
    }
  }

  const childrenByParent = new Map<string, string[]>();
  for (const { group } of entries.values()) if (group.parentSectionKey) {
    const children = childrenByParent.get(group.parentSectionKey) ?? [];
    children.push(group.key);
    childrenByParent.set(group.parentSectionKey, children);
  }
  const hasFieldsOrDescendants = (key: string, visited = new Set<string>()): boolean => {
    if (visited.has(key)) return false;
    visited.add(key);
    const entry = entries.get(key);
    if (entry?.group.fields.length) return true;
    return (childrenByParent.get(key) ?? []).some((child) => hasFieldsOrDescendants(child, visited));
  };
  const visible = [...entries.values()].filter(({ group }) => hasFieldsOrDescendants(group.key));
  const rootOf = (key: string): string => {
    let current = hierarchy.get(key);
    const seen = new Set<string>();
    while (current?.parentSectionKey && !seen.has(current.sectionKey)) {
      seen.add(current.sectionKey);
      current = hierarchy.get(current.parentSectionKey);
    }
    return current?.sectionKey ?? key;
  };
  const rootRanks = new Map(
    [...hierarchy.values()]
      .filter((section) => !section.parentSectionKey)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.sectionKey.localeCompare(b.sectionKey))
      .map((section, index) => [section.sectionKey, index]),
  );
  const commonFieldRank = (field: T) => groupByField.get(field.fieldKey)?.fieldOrder ?? Number.MAX_SAFE_INTEGER;
  const rank = (entry: Entry): number => {
    if (entry.common) return entry.common.anchor * 100 + 50 + entry.common.order / 100;
    if (entry.group.key === '__common__') return 50;
    if (entry.group.isFallback) return Number.MAX_SAFE_INTEGER - 1;
    const rootRank = rootRanks.get(rootOf(entry.group.key));
    if (rootRank === undefined) return Number.MAX_SAFE_INTEGER - 2;
    const rootBase = (rootRank + 1) * 100;
    if (rootOf(entry.group.key) === entry.group.key) return rootBase;
    return rootBase + 10 + (declared.get(entry.group.key)?.order ?? entry.seen) / 100;
  };

  return visible
    .sort((a, b) => rank(a) - rank(b) || a.seen - b.seen || a.group.key.localeCompare(b.group.key))
    .map((entry) => ({
      ...entry.group,
      fields: [...entry.group.fields].sort((a, b) => {
        if (entry.common) return commonFieldRank(a) - commonFieldRank(b)
          || (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.fieldKey.localeCompare(b.fieldKey);
        return hierarchical
          ? (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.fieldKey.localeCompare(b.fieldKey)
          : 0;
      }),
    }));
}

/**
 * Regroupe les champs dans le rendu actuel de la version. Sans metadonnee UX-16, le
 * comportement historique est conserve bit pour bit ; une rubrique incomplete tombe dans le
 * groupe commun explicite au lieu de perdre les variables qu'elle ne sait pas placer.
 */
export function groupFieldsBySection<T extends PresentationField>(
  fields: T[],
  sections?: readonly TemplateSection[] | null,
  commonLayout?: TemplateCommonLayout | null,
): SectionGroup<T>[] {
  return commonLayout && commonLayout.groups.length > 0
    ? groupFieldsByCommonLayout(fields, sections, commonLayout)
    : groupFieldsBySectionLegacy(fields, sections);
}

/**
 * L68 — blocs REPETABLES declares par la version : un bloc racine, ou depuis L72 une
 * sous-section d'un bloc racine. Le `displayOrder` est global et normalise par la base, donc
 * un seul tri suffit a les ranger dans l'ordre du formulaire, quelle que soit leur profondeur.
 */
export function repeatableSectionsOf(
  sections?: readonly TemplateSection[] | null,
): TemplateSection[] {
  return (sections ?? [])
    .filter((section) => section.isRepeatable === true)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.sectionKey.localeCompare(b.sectionKey));
}

/** Racine de la hierarchie d'une section ; la section elle-meme si elle est racine ou inconnue. */
function rootSectionKeyOf(sectionKey: string, sections: readonly TemplateSection[]): string {
  const byKey = new Map(sections.map((section) => [section.sectionKey, section]));
  let current = byKey.get(sectionKey);
  const seen = new Set<string>();
  while (current?.parentSectionKey && !seen.has(current.sectionKey)) {
    seen.add(current.sectionKey);
    const parent = byKey.get(current.parentSectionKey);
    if (!parent) return current.parentSectionKey;
    current = parent;
  }
  return current?.sectionKey ?? sectionKey;
}

/**
 * L72 R4 — groupes repetables masques avec leur bloc, pour ces valeurs de fiche.
 *
 * Le masquage se decide sur la SECTION, pas sur des cles de variables : les variables d'un
 * groupe ne sont jamais dans la fiche, et un bloc peut ne porter aucune variable propre. Le
 * groupe herite donc du verdict des regles qui ciblent sa racine, avec la semantique de
 * `hiddenFieldKeys` : une condition non verifiable masque, plusieurs regles se cumulent en ET,
 * et un pilote lui-meme masque (`hiddenFields`, calcule par l'appelant) se lit comme absent —
 * c'est ce qui porte la cascade. Un groupe racine n'est jamais cible (G-d) : jamais masque.
 */
export function maskedRepeatableSectionKeys(
  sections: readonly TemplateSection[] | null | undefined,
  rules: readonly { rule: unknown }[],
  values: Record<string, unknown>,
  hiddenFields: ReadonlySet<string>,
): Set<string> {
  const masked = new Set<string>();
  const children = repeatableSectionsOf(sections).filter((section) => section.parentSectionKey);
  if (children.length === 0) return masked;
  const visibility = visibilityRulesOf(rules.map((entry) => entry.rule));
  const rootHidden = (root: string) => visibility.some((rule) => 'section' in rule.then
    && rule.then.section === root
    && (hiddenFields.has(rule.if.field) || !visibilityConditionHolds(rule, values)));
  for (const section of children) {
    if (rootHidden(rootSectionKeyOf(section.sectionKey, sections ?? []))) masked.add(section.sectionKey);
  }
  return masked;
}

/**
 * Cles des variables portees par un bloc repetable.
 *
 * C'est la branche « hors groupe » du §5 cote ecran : une variable de bloc repetable ne se
 * saisit JAMAIS sur une rencontre ordinaire, meme quand son `encounterTypes` est nul. Sans ce
 * filtre, le formulaire de consultation proposerait les variables d'une lesion, que le serveur
 * ne reclame pourtant plus a cet endroit.
 */
export function repeatableFieldKeys(
  fields: readonly Pick<TemplateField, 'fieldKey' | 'section'>[],
  sections?: readonly TemplateSection[] | null,
): ReadonlySet<string> {
  const keys = new Set(repeatableSectionsOf(sections).map((section) => section.sectionKey));
  if (keys.size === 0) return new Set<string>();
  return new Set(
    fields.filter((field) => field.section !== null && keys.has(sectionKeyOf(field))).map((field) => field.fieldKey),
  );
}

/**
 * Variables de rencontre des blocs repetables : celles que portent les formulaires d'occurrence.
 * Un seul calcul pour la creation, la correction et la lecture d'une fiche, a toute profondeur.
 */
export function repeatableGroupFields<T extends Pick<TemplateField, 'fieldKey' | 'section'> & { scope: string }>(
  fields: readonly T[],
  sections?: readonly TemplateSection[] | null,
): T[] {
  const keys = repeatableFieldKeys(fields, sections);
  return fields.filter((field) => field.scope === 'encounter' && keys.has(field.fieldKey));
}

/**
 * Regles dont tous les operandes appartiennent au meme bloc repetable.
 *
 * Une occurrence ne dispose que de ses propres valeurs. Une regle qui depend d'un champ d'un
 * autre bloc ou d'une rencontre ordinaire ne doit donc ni masquer ni bloquer ce formulaire.
 */
export function rulesForRepeatableSection(
  rules: readonly ValidationRule[],
  fields: readonly Pick<TemplateField, 'fieldKey' | 'section'>[],
  sectionKey: string,
): ValidationRule[] {
  const fieldKeys = new Set(
    fields.filter((field) => sectionKeyOf(field) === sectionKey).map((field) => field.fieldKey),
  );
  if (fieldKeys.size === 0) return [];

  const fieldsReferencedBy = (rule: unknown): string[] => {
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) return [];
    const source = rule as Record<string, unknown>;
    if ('if' in source && 'then' in source) {
      const condition = typeof source.if === 'object' && source.if !== null
        ? source.if as Record<string, unknown>
        : null;
      const outcome = typeof source.then === 'object' && source.then !== null
        ? source.then as Record<string, unknown>
        : null;
      return [condition?.field, outcome?.field].filter((key): key is string => typeof key === 'string');
    }
    if ('operator' in source && 'left_field' in source && 'right_field' in source) {
      return [source.left_field, source.right_field].filter((key): key is string => typeof key === 'string');
    }
    return [];
  };

  return rules.filter((rule) => {
    const references = fieldsReferencedBy(rule.rule);
    return references.length > 0 && references.every((key) => fieldKeys.has(key));
  });
}

/**
 * Etape de formulaire : un groupe ordinaire, ou un bloc repetable rendu comme un tableau.
 * `masked` : le bloc parent du groupe est masque pour cette fiche (L72 R4) — l'etape n'est
 * gardee que pour annoncer des occurrences deja enregistrees (D10), jamais pour saisir.
 */
export type SectionStep<T> =
  | { kind: 'fields'; group: SectionGroup<T> }
  | { kind: 'repeatable'; section: TemplateSection; masked: boolean };

/**
 * Intercale les blocs repetables A LEUR PLACE parmi les groupes ordinaires (§8.1).
 *
 * Un bloc repetable ne porte aucune variable saisissable sur la fiche elle-meme : ses variables
 * decrivent une occurrence. Il n'apparait donc pas dans `groups`, et il faut le replacer a son
 * rang declare. Quand il y figure malgre tout — un appelant passant les variables de rencontre —
 * le groupe est REMPLACE par l'etape repetable, jamais rendu variable par variable.
 *
 * L72 — un groupe ENFANT se place dans la grappe de son bloc, a son `displayOrder` (global,
 * normalise par la base) : entre `A1` et `A2`, ou apres la derniere etape rendue du bloc. Ni une
 * rubrique commune (UX-16, D11), ni le bloc suivant ne l'en separent. Un bloc sans aucune etape
 * rendue — ses variables masquees, par exemple — laisse le groupe a la place du bloc : apres les
 * rubriques ancrees avant lui, avant celles ancrees apres lui.
 */
export function withRepeatableSteps<T>(
  groups: readonly SectionGroup<T>[],
  sections?: readonly TemplateSection[] | null,
  masked: ReadonlySet<string> = new Set(),
  commonLayout?: TemplateCommonLayout | null,
): SectionStep<T>[] {
  const repeatables = repeatableSectionsOf(sections);
  if (repeatables.length === 0) return groups.map((group) => ({ kind: 'fields', group }));

  const byKey = new Map(repeatables.map((section) => [section.sectionKey, section]));
  const repeatableStep = (section: TemplateSection): SectionStep<T> =>
    ({ kind: 'repeatable', section, masked: masked.has(section.sectionKey) });
  const placed = new Set<string>();
  const steps: SectionStep<T>[] = [];
  for (const group of groups) {
    const repeatable = byKey.get(group.key);
    if (repeatable) {
      if (placed.has(repeatable.sectionKey)) continue;
      placed.add(repeatable.sectionKey);
      steps.push(repeatableStep(repeatable));
      continue;
    }
    steps.push({ kind: 'fields', group });
  }

  // Rang declare d'une etape : seule une section connue de la version fait autorite. Une
  // rubrique de presentation (UX-16) n'en a pas et ne deplace donc jamais un bloc repetable.
  const declared = new Map((sections ?? []).map((section) => [section.sectionKey, section]));
  const keyOf = (step: SectionStep<T>) => step.kind === 'repeatable' ? step.section.sectionKey : step.group.key;
  const rankOf = (step: SectionStep<T>): number | null => step.kind === 'repeatable'
    ? step.section.displayOrder
    : declared.get(step.group.key)?.displayOrder ?? null;
  const parentOf = (step: SectionStep<T>): string | null => step.kind === 'repeatable'
    ? step.section.parentSectionKey ?? null
    : step.group.parentSectionKey ?? declared.get(step.group.key)?.parentSectionKey ?? null;
  const inCluster = (step: SectionStep<T>, root: string) => keyOf(step) === root || parentOf(step) === root;
  // Une rubrique ancree apres `k` blocs racines se lit juste avant le k-ieme : c'est la regle de
  // `groupFieldsByCommonLayout`, rapportee a l'echelle des `displayOrder`.
  const roots = (sections ?? []).filter((section) => !section.parentSectionKey)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.sectionKey.localeCompare(b.sectionKey));
  const anchors = new Map((commonLayout?.groups ?? []).map((group) => [`__common_group__:${group.key}`, group.anchor]));
  const placedRankOf = (step: SectionStep<T>): number | null => {
    const anchor = step.kind === 'fields' ? anchors.get(step.group.key) : undefined;
    if (anchor === undefined) return rankOf(step);
    return anchor < roots.length ? roots[anchor].displayOrder - 0.5 : Infinity;
  };

  for (const section of repeatables) {
    if (placed.has(section.sectionKey)) continue;
    const parent = section.parentSectionKey ?? null;
    const cluster = parent === null ? [] : steps.flatMap((candidate, index) => inCluster(candidate, parent) ? [index] : []);
    let index: number;
    if (cluster.length > 0) {
      const after = cluster.find((candidate) => (rankOf(steps[candidate]) ?? -Infinity) > section.displayOrder);
      index = after ?? cluster[cluster.length - 1] + 1;
    } else {
      // Groupe racine : rang L68 inchange, une rubrique ne le deplace pas. Groupe enfant d'un
      // bloc sans etape rendue : la place du bloc, rubriques comprises.
      const rank = parent === null ? rankOf : placedRankOf;
      index = steps.findIndex((candidate) => {
        const candidateRank = rank(candidate);
        return candidateRank !== null && candidateRank > section.displayOrder;
      });
      if (index === -1) index = steps.length;
    }
    steps.splice(index, 0, repeatableStep(section));
    placed.add(section.sectionKey);
  }
  return steps;
}
