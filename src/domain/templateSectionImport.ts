// L59 — choisir un bloc reutilisable dans l'editeur de version.
//
// Ce module ne decide RIEN. L58 a mis toutes les decisions dans la base : lisibilite de la
// source, propriete de la cible, gel, conflits de cle, compatibilite d'une reutilisation,
// operandes de formule, acyclicite. L'ecran ne rejoue aucun de ces controles et n'anticipe
// aucun refus ; il se contente de rendre lisible ce que le serveur a repondu.
//
// D'ou trois responsabilites seulement, toutes pures :
//   * traduire les douze codes de refus (§4.4) en cles de message ;
//   * classer les conflits en « resolvable par reutilisation » et « a corriger d'abord »,
//     selon le seul drapeau `reusable` POSE PAR LE SERVEUR ;
//   * dire quelles variables `required` deviendraient obligatoires pour tous les patients
//     (D9), pour que l'avertissement soit affiche avant l'ecriture et non decouvert au
//     premier formulaire.

import type { MessageKey } from '../i18n/messages';
import { structuredErrorCode } from '../lib/errorMessage';
import type {
  ImportableBlock,
  SectionImportConflict,
  SectionImportRefusalCode,
  SectionImportReport,
  TemplateField,
} from '../data/types';

/**
 * Les douze refus de L58, chacun avec sa cle de message. La table est exhaustive et
 * `satisfies Record<SectionImportRefusalCode, MessageKey>` la garde exhaustive : ajouter un
 * code cote base sans son message ne compilerait plus.
 */
export const IMPORT_REFUSAL_MESSAGE_KEY = {
  IMPORT_SOURCE_FORBIDDEN: 'blockimport.error.source_forbidden',
  IMPORT_TARGET_FORBIDDEN: 'blockimport.error.target_forbidden',
  IMPORT_SOURCE_NOT_A_BLOCK: 'blockimport.error.not_a_block',
  IMPORT_TARGET_LOCKED: 'blockimport.error.target_locked',
  IMPORT_TARGET_IN_USE: 'blockimport.error.target_in_use',
  IMPORT_SECTION_EXISTS: 'blockimport.error.section_exists',
  IMPORT_FIELD_CONFLICT: 'blockimport.error.field_conflict',
  IMPORT_REUSE_INCOMPATIBLE: 'blockimport.error.reuse_incompatible',
  IMPORT_REUSE_IN_BLOCK: 'blockimport.error.reuse_in_block',
  IMPORT_FORMULA_OPERAND_MISSING: 'blockimport.error.formula_operand_missing',
  IMPORT_FORMULA_OPERAND_INCOMPATIBLE: 'blockimport.error.formula_operand_incompatible',
  IMPORT_VISIBILITY_CYCLE: 'blockimport.error.visibility_cycle',
} as const satisfies Record<SectionImportRefusalCode, MessageKey>;

const isRefusalCode = (code: string): code is SectionImportRefusalCode =>
  Object.prototype.hasOwnProperty.call(IMPORT_REFUSAL_MESSAGE_KEY, code);

/**
 * Code de refus porte par une erreur de RPC, ou `null` si l'erreur vient d'ailleurs.
 *
 * Le code voyage dans `detail`, pas dans le message : c'est la forme que
 * `structuredErrorCode` sait decoder, et la seule qui survive a la traversee PostgREST.
 * Une erreur reseau ou une panne quelconque rend `null`, et l'appelant retombe alors sur
 * `errorMessage`, sans jamais inventer un motif metier.
 */
export function importRefusalCode(error: unknown): SectionImportRefusalCode | null {
  const code = structuredErrorCode(error);
  return code && isRefusalCode(code) ? code : null;
}

export interface ConflictGroups {
  /** Le serveur juge la reutilisation possible : variable compatible ET dans le tronc commun. */
  reusable: SectionImportConflict[];
  /** Tout le reste : l'ecran enonce la cle, ou vit la variable, et la raison du refus. */
  blocking: SectionImportConflict[];
}

/**
 * Classe les conflits SANS jamais recalculer la compatibilite.
 *
 * `reusable` est pose par `template_section_import_plan`, qui exige a la fois l'egalite de
 * `type`, `is_multiple` et `scope`, et l'appartenance au tronc commun de la cible. Refaire ce
 * jugement ici finirait par diverger du serveur, et l'ecran proposerait une resolution que
 * l'import refuserait.
 */
export function groupConflicts(report: SectionImportReport | null): ConflictGroups {
  const conflicts = report?.conflicts ?? [];
  return {
    reusable: conflicts.filter((conflict) => conflict.reusable && conflict.fieldKey !== null),
    blocking: conflicts.filter((conflict) => !conflict.reusable || conflict.fieldKey === null),
  };
}

/**
 * Variables qui deviendraient obligatoires POUR TOUS LES PATIENTS (D9).
 *
 * Deux precisions qui font toute la difference :
 *   * seules les variables IMPORTEES comptent. Une variable reutilisee existe deja dans la
 *     cible et n'est pas reecrite : son caractere obligatoire ne change pas ;
 *   * `required` est lu sur la SOURCE, car c'est la valeur que l'import copie telle quelle.
 *
 * La condition « et qu'aucune regle ne l'active » du §5 est structurellement vraie : D7
 * interdit de copier la regle d'activation, et la cle de section du bloc est neuve dans la
 * cible (sans quoi l'import aurait ete refuse par `IMPORT_SECTION_EXISTS`). Aucune regle
 * existante ne peut donc porter ce bloc au moment de l'import.
 */
export function fieldsBecomingAlwaysRequired(
  report: SectionImportReport | null,
  sourceFields: readonly TemplateField[],
): TemplateField[] {
  if (!report) return [];
  const imported = new Set(report.importedFields);
  return sourceFields.filter((field) => field.required && imported.has(field.fieldKey));
}

/** Variables du bloc, telles qu'elles seront ecrites, dans l'ordre d'affichage de la source. */
export function blockFields(
  report: SectionImportReport | null,
  sourceFields: readonly TemplateField[],
): TemplateField[] {
  if (!report) return [];
  const inBlock = new Set([...report.importedFields, ...report.reusedFields]);
  return sourceFields.filter((field) => inBlock.has(field.fieldKey));
}

export interface CatalogGroup {
  versionId: string;
  /** Deja resolu pour l'affichage : nom du gabarit quand la RLS le laisse passer, sinon null. */
  templateName: string | null;
  isGlobal: boolean;
  versionNumber: number;
  versionStatus: ImportableBlock['versionStatus'];
  blocks: ImportableBlock[];
}

/**
 * Regroupe le catalogue par version source, en excluant la version CIBLE.
 *
 * S'importer soi-meme echouerait toujours sur `IMPORT_SECTION_EXISTS` — la cle de section est
 * unique par version : proposer ce choix ne serait qu'un piege. C'est la seule chose que
 * l'ecran retire du catalogue rendu par le serveur.
 */
export function groupCatalogByVersion(
  blocks: readonly ImportableBlock[],
  targetVersionId: string,
): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>();
  for (const block of blocks) {
    if (block.versionId === targetVersionId) continue;
    const group = groups.get(block.versionId) ?? {
      versionId: block.versionId,
      templateName: block.templateName,
      isGlobal: block.isGlobal,
      versionNumber: block.versionNumber,
      versionStatus: block.versionStatus,
      blocks: [],
    };
    group.blocks.push(block);
    groups.set(block.versionId, group);
  }
  return [...groups.values()];
}
