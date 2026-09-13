// L60 — reconnexion de la regle d'activation d'un bloc importe.
//
// D7 interdit de copier la regle d'affichage du bloc : son `if` nomme un pilote du tronc
// commun de la SOURCE, qui n'existe pas forcement dans la cible. Le rapport d'import la
// decrit ; ce module dit si elle peut etre RECREEE ici, et sinon laquelle des conditions
// manque — nommee, jamais un refus generique.
//
// Trois regles de conduite.
//
//   1. AUCUNE ECRITURE, AUCUN CHEMIN PARALLELE. Ce module est pur : il rend une regle
//      candidate, que l'appelant enregistre par `addRule`, exactement comme le
//      constructeur de regles. Les gardes du serveur — forme, acyclicite, invariants de
//      version, configuration diagnostique — restent seules garantes.
//   2. NE PROPOSER QUE CE QUI EST VERIFIE. Le §6 exige TOUTES les compatibilites avant de
//      proposer quoi que ce soit. Quand une donnee manque pour trancher — typiquement
//      l'edition du referentiel cote cible —, c'est un refus nomme, pas un pari.
//   3. UN REFUS NE DETRUIT RIEN. Il laisse le bloc visible sans condition, qui est l'etat
//      sur, et renvoie au constructeur de regles.

import { fieldOptions, optionKeys } from './fieldOptions';
import { isCalculatedField } from './fieldFormula';
import { parseRule, visibilityRuleOf, type VisibilityRule } from './templateRules';
import type { MessageKey } from '../i18n/messages';
import type {
  DiagnosisContext,
  SectionImportActivationRule,
  TemplateField,
  TemplateSection,
} from '../data/types';

/**
 * Conditions du §6, plus les trois refus que le serveur oppose deja et que l'ecran peut
 * voir sans aller-retour. Chacune a son message : « la condition qui manque » doit se lire,
 * pas se deviner.
 */
export const ACTIVATION_BLOCKERS = [
  'driver_missing',
  'driver_scope',
  'driver_type',
  'driver_multiple',
  'driver_in_block',
  'driver_calculated',
  'driver_hidden',
  'release_unknown',
  'release_mismatch',
  'code_unknown',
  'common_only',
  'diagnosis_noncanonical',
  'block_scope',
  'block_empty',
  'invalid',
] as const;
export type ActivationBlockerCode = (typeof ACTIVATION_BLOCKERS)[number];

export interface ActivationBlocker {
  code: ActivationBlockerCode;
  /** Complement FACTUEL insere dans le message : codes cites, cle de bloc, chemin de cycle. */
  detail?: string;
}

/**
 * Un message par condition. `satisfies` garde la table exhaustive : ajouter un refus sans
 * son message ne compilerait plus, et l'ecran ne pourrait pas retomber sur un motif vague.
 */
export const ACTIVATION_BLOCKER_MESSAGE_KEY = {
  driver_missing: 'blockactivation.blocked.driver_missing',
  driver_scope: 'blockactivation.blocked.driver_scope',
  driver_type: 'blockactivation.blocked.driver_type',
  driver_multiple: 'blockactivation.blocked.driver_multiple',
  driver_in_block: 'blockactivation.blocked.driver_in_block',
  driver_calculated: 'blockactivation.blocked.driver_calculated',
  driver_hidden: 'blockactivation.blocked.driver_hidden',
  release_unknown: 'blockactivation.blocked.release_unknown',
  release_mismatch: 'blockactivation.blocked.release_mismatch',
  code_unknown: 'blockactivation.blocked.code_unknown',
  common_only: 'blockactivation.blocked.common_only',
  diagnosis_noncanonical: 'blockactivation.blocked.diagnosis_noncanonical',
  block_scope: 'blockactivation.blocked.block_scope',
  block_empty: 'blockactivation.blocked.block_empty',
  invalid: 'blockactivation.blocked.invalid',
} as const satisfies Record<ActivationBlockerCode, MessageKey>;

export type ActivationProposal =
  | { ok: true; rule: VisibilityRule }
  | { ok: false; blocker: ActivationBlocker };

/**
 * Ce qu'un import laisse en attente de reconnexion. Le pilote de la SOURCE voyage avec la
 * condition : son `scope`, son `type` et son `is_multiple` sont la reference de comparaison,
 * et le rapport d'import ne les porte pas.
 */
export interface ImportedBlockActivation {
  /** Bloc importe, cible de la regle a recreer. */
  sectionKey: string;
  /** Clause `if` de la regle d'activation de la SOURCE, telle que le rapport la rend. */
  activation: SectionImportActivationRule | null;
  sourceDriver: TemplateField | null;
}

export interface ActivationInput extends ImportedBlockActivation {
  /** Variables, sections et regles de la CIBLE. */
  fields: readonly TemplateField[];
  sections: readonly TemplateSection[];
  rules: readonly { rule: unknown }[];
  /** Contexte diagnostique L55 de la CIBLE : edition du referentiel et codes reconnus. */
  diagnosis?: readonly DiagnosisContext[] | null;
}

const refuse = (code: ActivationBlockerCode, detail?: string): ActivationProposal =>
  ({ ok: false, blocker: detail === undefined ? { code } : { code, detail } });

/** Codes cites par la condition, sous forme de chaines. Un scalaire compte pour un code. */
function citedCodes(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.filter((item): item is string => typeof item === 'string' && item !== '');
}

/** Cles de section du bloc : la racine et ses enfants directs, comme `template_section_field_keys`. */
function blockSectionKeys(sectionKey: string, sections: readonly TemplateSection[]): Set<string> {
  const keys = new Set([sectionKey]);
  for (const section of sections) {
    if (section.parentSectionKey === sectionKey) keys.add(section.sectionKey);
  }
  return keys;
}

/**
 * La regle d'activation peut-elle etre recreee sur la cible ?
 *
 * Rend `null` quand il n'y a RIEN a proposer — pas de regle d'activation dans la source, ou
 * bloc deja porte par une regle. Un `null` n'est pas un refus : il n'y a simplement pas de
 * reconnexion en attente.
 */
export function activationProposal(input: ActivationInput): ActivationProposal | null {
  const { sectionKey, activation, sourceDriver, fields, sections, rules } = input;
  if (!activation || !activation.field || !activation.operator || !('value' in activation)) return null;

  // Le bloc porte deja une condition : la reconnexion a eu lieu, ou l'utilisateur a choisi
  // son propre pilote. Reproposer la regle de la source serait revenir sur sa decision.
  const alreadyConditioned = rules.some((entry) => {
    const parsed = visibilityRuleOf(entry.rule);
    return parsed !== null && 'section' in parsed.then && parsed.then.section === sectionKey;
  });
  if (alreadyConditioned) return null;

  // --- Le pilote existe-t-il ici, et est-ce bien LA MEME variable ? -----------------------
  const driver = fields.find((field) => field.fieldKey === activation.field);
  if (!driver || !sourceDriver) return refuse('driver_missing');
  if (driver.scope !== sourceDriver.scope) return refuse('driver_scope');
  if (driver.type !== sourceDriver.type) return refuse('driver_type');
  // `isMultiple` est absent des instantanes anterieurs a L21 : absent vaut unitaire, des
  // deux cotes. Comparer `undefined` a `false` ferait un faux refus sur une copie ancienne.
  if ((driver.isMultiple ?? false) !== (sourceDriver.isMultiple ?? false)) return refuse('driver_multiple');

  // --- Le pilote est-il utilisable comme pilote d'affichage ? -----------------------------
  // Hors tronc commun, le bloc importe se viderait des que le bloc du pilote est masque.
  if (driver.section) return refuse('driver_in_block', driver.section);
  // Une variable calculee n'est jamais enregistree : elle masquerait la cible POUR TOUJOURS.
  if (isCalculatedField(driver)) return refuse('driver_calculated');
  const hidden = rules.some((entry) => {
    const parsed = visibilityRuleOf(entry.rule);
    return parsed !== null && 'field' in parsed.then && parsed.then.field === driver.fieldKey;
  });
  if (hidden) return refuse('driver_hidden');

  // --- Edition du referentiel et codes cites ----------------------------------------------
  // Une variable `terminology` n'enregistre pas sa propre edition : la SEULE edition ecrite
  // cote cible est celle de la configuration diagnostique L55 qui designe ce pilote. Sans
  // elle il n'y a ni edition a comparer, ni liste de codes a verifier — donc rien a affirmer.
  const entry = (input.diagnosis ?? []).find(
    (item) => item.scope === driver.scope && item.diagnosisFieldKey === driver.fieldKey,
  );
  const cited = citedCodes(activation.value);
  if (driver.type === 'terminology' && activation.operator === 'contains_any') {
    if (!entry?.terminologyReleaseId) return refuse('release_unknown');
    if (entry.terminologyReleaseId !== activation.terminologyReleaseId) return refuse('release_mismatch');
    const unknown = cited.filter((code) => !entry.recognizedCodes.includes(code));
    if (unknown.length > 0) return refuse('code_unknown', unknown.join(', '));
  } else if (driver.type === 'select' || driver.type === 'multiselect') {
    // Un code absent des options ferait une regle qui ne se declenche jamais : le bloc
    // resterait masque sans que rien ne l'explique. Le serveur ne verifie cela que pour
    // `contains_any` ; l'ecran refuse aussi la regle morte, qu'il ne creera pas tout seul.
    const known = optionKeys(fieldOptions(driver));
    const unknown = cited.filter((code) => !known.includes(code));
    if (unknown.length > 0) return refuse('code_unknown', unknown.join(', '));
  }

  // --- Contraintes propres au pilote diagnostique (L55) -----------------------------------
  if (entry) {
    // Une association diagnostique est canonique : `contains_any`, une seule regle par bloc.
    if (activation.operator !== 'contains_any') return refuse('diagnosis_noncanonical');
    const overlap = cited.filter((code) => entry.commonOnlyCodes.includes(code));
    if (overlap.length > 0) return refuse('common_only', overlap.join(', '));
  }

  // --- Le bloc lui-meme se laisse-t-il conditionner par ce pilote ? -----------------------
  const keys = blockSectionKeys(sectionKey, sections);
  const carried = fields.filter((field) => typeof field.section === 'string' && keys.has(field.section));
  // Refus atomique du serveur : un bloc ne peut pas etre a demi evalue parce qu'une de ses
  // variables appartient a l'autre fiche.
  if (carried.some((field) => field.scope !== driver.scope)) return refuse('block_scope');
  // Un bloc sans variable saisissable ne peut pas declarer un code couvert (L55).
  if (entry && !carried.some((field) => !isCalculatedField(field))) return refuse('block_empty');

  // --- La regle, par la forme exacte du moteur existant -----------------------------------
  // Reconstruite CLE PAR CLE : recopier la clause de la source telle quelle y laisserait
  // toute propriete inattendue, que `assert_rule_structure` refuse pour `contains_any`.
  const candidate = {
    if: {
      field: activation.field,
      operator: activation.operator,
      value: activation.value,
      ...(activation.terminologyReleaseId ? { terminologyReleaseId: activation.terminologyReleaseId } : {}),
    },
    then: { section: sectionKey, operator: 'visible' as const },
  };

  const parsed = parseRule(JSON.stringify(candidate));
  if (!parsed.ok) return refuse('invalid', parsed.error);
  const rule = visibilityRuleOf(parsed.value);
  if (!rule) return refuse('invalid', parsed.kind);

  // Pas de controle d'acyclicite ici, et ce n'est pas un oubli. La regle proposee n'ajoute
  // que des aretes « variable du bloc depend du pilote » ; un cycle exigerait donc que le
  // pilote depende lui-meme d'une variable du bloc, c'est-a-dire qu'il soit la cible d'une
  // regle d'affichage — ce que `driver_hidden` a deja refuse plus haut, avec un motif bien
  // plus parlant. `assert_visibility_acyclic` reste la garantie a l'ecriture.
  return { ok: true, rule };
}
