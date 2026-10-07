import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import {
  COMPARISON_OPERATORS,
  CONDITION_OPERATORS,
  findVisibilityCycle,
  parseRule,
  type ComparisonOperator,
  type ConditionOperator,
  type RuleOperandProblem,
  type TemplateRule,
} from '../../domain/templateRules';
import { sectionLabel } from '../../domain/templateSections';
import { fieldTypeLabel } from '../../domain/templateLabels';
import type { RuleSeverity, TemplateField, TemplateSection } from '../../data/types';
// Alias : `fieldOptions` designe deja, dans cet ecran, la liste des VARIABLES proposees.
import { fieldOptions as listOptionsOf, optionLabel } from '../../domain/fieldOptions';
import { calculatedOperandConflict, isCalculatedField } from '../../domain/fieldFormula';
import { Checkbox } from '../../components/Checkbox';
import { FieldSelect } from './FieldSelect';
import { errorMessage } from '../../lib/errorMessage';
import { HelpDetails } from '../../components/HelpTip';
import {
  blockRuleVerdict,
  fieldRuleSpace,
  fieldRuleVerdict,
  ruleSpaceVerdict,
  type RuleSpaceProblem,
} from '../../domain/ruleSpaces';

type GuidedRuleKind = 'comparison' | 'conditional' | 'visibility';
type Translate = (key: MessageKey) => string;

const OPERATOR_KEYS: Record<ComparisonOperator, MessageKey> = {
  equals: 'rule.operator.equals',
  not_equals: 'rule.operator.not_equals',
  greater_than: 'rule.operator.greater_than',
  greater_or_equal: 'rule.operator.greater_or_equal',
  less_than: 'rule.operator.less_than',
  less_or_equal: 'rule.operator.less_or_equal',
};

const DATE_OPERATOR_KEYS: Record<ComparisonOperator, MessageKey> = {
  equals: 'rule.operator.date_equals',
  not_equals: 'rule.operator.date_not_equals',
  greater_than: 'rule.operator.date_greater_than',
  greater_or_equal: 'rule.operator.date_greater_or_equal',
  less_than: 'rule.operator.date_less_than',
  less_or_equal: 'rule.operator.date_less_or_equal',
};

function isDateField(field: TemplateField | undefined) {
  return field?.type === 'date' || field?.type === 'datetime' || field?.type === 'time';
}

/**
 * L35 x L32 : ce qu'une variable CALCULEE rend impossible, selon la position qu'elle occupe.
 * Memes cas et meme decoupage que `public.rule_calculated_operand_message` — l'ecran et la
 * base doivent donner le meme motif, sinon la correction du serveur arrive sans explication.
 */
const CALCULATED_PROBLEM_KEYS: Record<RuleOperandProblem, MessageKey> = {
  visible_driver: 'rule.calculated_visible_driver',
  required_driver: 'rule.calculated_required_driver',
  required_target: 'rule.calculated_required_target',
  comparison_operand: 'rule.calculated_comparison_operand',
};

/** L74d (D5) : pourquoi une regle ne peut jamais fonctionner, faute d'etre lue sur une seule fiche. */
const SPACE_PROBLEM_KEYS: Record<RuleSpaceProblem, MessageKey> = {
  visible_cross_space: 'rule.space_visible_cross_space',
  required_cross_space: 'rule.space_required_cross_space',
  comparison_cross_space: 'rule.space_comparison_cross_space',
  block_group_driver: 'rule.space_block_group_driver',
};

function operatorLabel(
  t: Translate,
  operator: ComparisonOperator | ConditionOperator,
  field: TemplateField | undefined,
) {
  if (operator === 'contains_any') return t('rule.operator.contains_any');
  if (operator === 'in') return t('rule.operator.in');
  return t(isDateField(field) ? DATE_OPERATOR_KEYS[operator] : OPERATOR_KEYS[operator]);
}

function fieldLabel(fields: TemplateField[], fieldKey: string) {
  return fields.find((field) => field.fieldKey === fieldKey)?.label ?? fieldKey;
}

function formatRuleValue(t: Translate, value: unknown, field: TemplateField | undefined): string {
  if (Array.isArray(value)) return value.map((item) => formatRuleValue(t, item, field)).join(', ');
  if (value === true) return t('rule.value_true');
  if (value === false) return t('rule.value_false');
  // Audit UI mobile, lot 0 : la regle stocke le CODE de l'option ; la phrase montre son libelle,
  // comme le formulaire qui l'a construite. Une valeur hors liste reste affichee telle quelle.
  if (typeof value === 'string') return `« ${optionLabel(field, value)} »`;
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

type ConditionRule = Exclude<TemplateRule, { left_field: string }>;

/** « Si Intervention réalisée est égal à « Oui » » : la condition seule, sans ponctuation. */
function conditionPhrase(t: Translate, rule: ConditionRule, fields: TemplateField[]) {
  const conditionField = fields.find((field) => field.fieldKey === rule.if.field);
  return `${t('rule.if')} ${fieldLabel(fields, rule.if.field)} ${operatorLabel(t, rule.if.operator, conditionField)} ${formatRuleValue(t, rule.if.value, conditionField)}`;
}

/**
 * « Bloc 01 est affichée » : l'effet seul. L74d : une condition lue sur la fiche patient pour
 * une variable de groupe le dit, car elle s'evalue sur une autre fiche que sa cible.
 */
function consequencePhrase(t: Translate, rule: ConditionRule, fields: TemplateField[], sections: readonly TemplateSection[]) {
  const verb = rule.then.operator === 'visible' ? t('rule.visible') : t('rule.required');
  const sectionKey = (rule.then as { section?: unknown }).section;
  const target = typeof sectionKey === 'string'
    ? sectionLabel(t, {
      sectionKey,
      label: sections.find((section) => section.sectionKey === sectionKey)?.label ?? sectionKey,
    })
    : fieldLabel(fields, (rule.then as { field: string }).field);
  const verdict = ruleSpaceVerdict(rule, fields, sections);
  const context = verdict.usable && verdict.patientContext ? ` ${t('rule.context_sentence')}` : '';
  return `${target} ${verb}${context}`;
}

function ruleSentence(
  t: Translate,
  rule: TemplateRule,
  fields: TemplateField[],
  sections: readonly TemplateSection[] = [],
) {
  if ('operator' in rule) {
    const left = fields.find((field) => field.fieldKey === rule.left_field);
    return `${fieldLabel(fields, rule.left_field)} ${operatorLabel(t, rule.operator, left)} ${fieldLabel(fields, rule.right_field)}.`;
  }
  return `${conditionPhrase(t, rule, fields)}, ${t('rule.then')} ${consequencePhrase(t, rule, fields, sections)}.`;
}

function conditionRuleOf(rule: unknown): ConditionRule | null {
  const parsed = parseRule(serializeRule(rule));
  return parsed.ok && parsed.value && !('operator' in parsed.value) ? parsed.value : null;
}

/**
 * Audit UI mobile, lot 6 (5.13-B) — cle de regroupement D'AFFICHAGE : la condition telle
 * qu'elle est stockee. Les valeurs d'une liste sont triees, l'ordre de saisie ne distinguant
 * pas deux conditions. Une comparaison, ou une regle illisible, n'a pas de condition : `null`.
 */
export function ruleConditionKey(rule: unknown): string | null {
  const condition = conditionRuleOf(rule);
  if (!condition) return null;
  const { field, operator, value, terminologyReleaseId } = condition.if;
  const normalized = Array.isArray(value) ? [...value].map((item) => JSON.stringify(item)).sort() : JSON.stringify(value);
  return JSON.stringify([field, operator, normalized, terminologyReleaseId ?? null]);
}

/** La condition d'une regle, en clair et avec les libelles d'options (en-tete d'un groupe). */
export function ruleConditionText(t: Translate, rule: unknown, fields: TemplateField[]): string | null {
  const condition = conditionRuleOf(rule);
  return condition ? conditionPhrase(t, condition, fields) : null;
}

/** La phrase complete d'une regle, ou `null` si elle est illisible (nom d'une ligne). */
export function ruleText(t: Translate, rule: unknown, fields: TemplateField[], sections: readonly TemplateSection[] = []): string | null {
  const parsed = parseRule(serializeRule(rule));
  return parsed.ok && parsed.value ? ruleSentence(t, parsed.value, fields, sections) : null;
}

/** Une regle d'affichage ne bloque ni n'avertit : afficher une severite la decrirait mal. */
export function ruleHasSeverity(rule: unknown): boolean {
  const parsed = parseRule(serializeRule(rule));
  return !parsed.ok || parsed.kind !== 'visibility';
}

function serializeRule(rule: unknown) {
  try {
    return JSON.stringify(rule);
  } catch {
    return '';
  }
}

type RuleDraft = {
  kind: GuidedRuleKind;
  comparisonOperator: ComparisonOperator | '';
  leftField: string;
  rightField: string;
  conditionOperator: ConditionOperator | '';
  conditionField: string;
  conditionValue: string;
  conditionChoices: string[];
  terminologyReleaseId?: string;
  requiredField: string;
  visibilityTarget: 'field' | 'section';
  sectionTarget: string;
};

type RuleFormValues = {
  kind: GuidedRuleKind;
  comparisonOperator: ComparisonOperator | '';
  leftField: string;
  rightField: string;
  conditionOperator: ConditionOperator | '';
  conditionField: string;
  conditionValue: string;
  conditionChoices: string[];
  terminologyReleaseId: string;
  requiredField: string;
  visibilityTarget: 'field' | 'section';
  sectionTarget: string;
  message: string;
  severity: RuleSeverity;
};

function ruleFormSnapshot(values: RuleFormValues): string {
  return JSON.stringify(values);
}

function inputValue(value: unknown): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function ruleDraftOf(rule: unknown): RuleDraft | null {
  const parsed = parseRule(serializeRule(rule));
  if (!parsed.ok || !parsed.value) return null;
  if ('operator' in parsed.value) {
    return {
      kind: 'comparison',
      comparisonOperator: parsed.value.operator,
      leftField: parsed.value.left_field,
      rightField: parsed.value.right_field,
      conditionOperator: '',
      conditionField: '',
      conditionValue: '',
      conditionChoices: [],
      requiredField: '',
      visibilityTarget: 'field',
      sectionTarget: '',
    };
  }
  const conditionValue = parsed.value.if.value;
  return {
    kind: parsed.value.then.operator === 'visible' ? 'visibility' : 'conditional',
    comparisonOperator: '',
    leftField: '',
    rightField: '',
    conditionOperator: parsed.value.if.operator,
    conditionField: parsed.value.if.field,
    conditionValue: Array.isArray(conditionValue) ? conditionValue.map(inputValue).join(', ') : inputValue(conditionValue),
    terminologyReleaseId: parsed.value.if.terminologyReleaseId,
    conditionChoices: Array.isArray(conditionValue) ? conditionValue.map(inputValue) : [],
    requiredField: 'field' in parsed.value.then ? parsed.value.then.field : '',
    visibilityTarget: parsed.value.then.operator === 'visible' && 'section' in parsed.value.then ? 'section' : 'field',
    sectionTarget: 'section' in parsed.value.then ? parsed.value.then.section : '',
  };
}

export function RuleSummary({ rule, fields, sections = [], consequenceOnly = false }: {
  rule: unknown; fields: TemplateField[]; sections?: readonly TemplateSection[] | null;
  /** Lot 6 (5.13-B) : dans un groupe, la condition commune est ecrite une fois en tete ;
   *  chaque regle n'y dit plus que son effet. */
  consequenceOnly?: boolean;
}) {
  const { t } = useI18n();
  const parsed = parseRule(serializeRule(rule));
  // L35 : une regle ENREGISTREE AVANT le garde-fou peut porter une variable calculee la ou
  // celle-ci ne peut pas fonctionner. Sa phrase se lit parfaitement et le controle n'a jamais
  // lieu : sans ce diagnostic, la liste affirmerait une garantie qui n'existe pas.
  const conflict = calculatedOperandConflict(rule, fields);
  // L74d (D5) : une regle enregistree avant le refus a l'ecriture peut etre lue sur deux
  // fiches et ne jamais fonctionner. Elle est SIGNALEE, jamais bloquee : la version reste
  // modifiable et la regle garde son comportement actuel (inerte).
  const space = ruleSpaceVerdict(rule, fields, sections);

  if (!parsed.ok || !parsed.value) {
    return <p className="text-xs text-amber-700">{t('rule.unreadable')}</p>;
  }

  return (
    <div className="min-w-0">
      <p className="text-sm text-slate-700">
        {consequenceOnly && !('operator' in parsed.value)
          ? `→ ${consequencePhrase(t, parsed.value, fields, sections ?? [])}`
          : ruleSentence(t, parsed.value, fields, sections ?? [])}
      </p>
      {conflict && (
        <p className="mt-1 text-xs text-amber-700">
          {t(CALCULATED_PROBLEM_KEYS[conflict.problem])} — {conflict.field.label}
        </p>
      )}
      {!space.usable && (
        <p className="mt-1 text-xs text-amber-700">
          {t(SPACE_PROBLEM_KEYS[space.problem])} <HelpDetails>{t('rule.space_details')}</HelpDetails>
        </p>
      )}
    </div>
  );
}

function coerceValue(field: TemplateField | undefined, raw: string): unknown {
  if (field?.type === 'number' || field?.type === 'integer') {
    if (raw.trim() === '') return '';
    const numericValue = Number(raw);
    return Number.isFinite(numericValue) ? numericValue : raw;
  }
  if (field?.type === 'boolean') return raw === '' ? '' : raw === 'true';
  return raw;
}

export function RuleForm({
  fields,
  sections,
  onSubmit,
  onDirtyChange,
  busy,
  existingRules = [],
  initialRule,
  initialMessage,
  initialSeverity,
  initialSectionTarget,
  submitLabel,
  onCancel,
}: {
  fields: TemplateField[];
  /** Sections de la version ; seules les sections racines sont proposées comme cible. */
  sections?: readonly TemplateSection[] | null;
  onSubmit: (rule: unknown, message: string, severity: RuleSeverity) => void | Promise<unknown>;
  /** Notifie le parent uniquement de l'etat local reel de la saisie. */
  onDirtyChange?: (dirty: boolean) => void;
  busy?: boolean;
  /** Regles deja enregistrees sur cette version : sert a refuser un cycle d'affichage. */
  existingRules?: readonly { rule: unknown }[];
  /** Règle existante à relire dans le constructeur guidé, sans exposer son JSON. */
  initialRule?: unknown;
  initialMessage?: string | null;
  initialSeverity?: RuleSeverity;
  /** L59 : bloc a conditionner, propose apres un import. Ne fait qu'ouvrir le
   *  constructeur sur la bonne cible ; le pilote, lui, reste choisi par l'utilisateur.
   *  Ignore des qu'une regle existante est editee, qui porte deja sa propre cible. */
  initialSectionTarget?: string | null;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const draft = useMemo(() => (initialRule === undefined ? null : ruleDraftOf(initialRule)), [initialRule]);

  // L35 x L32 : le resultat d'un calcul n'est jamais enregistre. Une variable calculee ne peut
  // donc ni porter une condition, ni etre rendue obligatoire, ni etre comparee — elle n'est
  // proposee QUE la ou elle fonctionne : comme variable affichee sous condition.
  const enteredFields = useMemo(() => fields.filter((field) => !isCalculatedField(field)), [fields]);
  const calculatedLabels = useMemo(
    () => fields.filter(isCalculatedField).map((field) => field.label),
    [fields],
  );
  // Une regle HERITEE, ecrite avant le garde-fou, porte une variable absente des listes
  // ci-dessous : sans ce message, le selecteur s'ouvrirait vide et l'ecran laisserait croire
  // a un oubli. Le motif est affiche d'entree.
  const inheritedConflict = useMemo(
    () => (initialRule === undefined ? null : calculatedOperandConflict(initialRule, fields)),
    [initialRule, fields],
  );
  // L59 : la graine ne sert QUE si aucune regle existante n'est editee — une regle en
  // cours de modification porte deja sa cible, et la lui reprendre serait une surprise.
  const seededSection = draft ? null : (initialSectionTarget || null);
  const initialValues = useMemo<RuleFormValues>(() => ({
    kind: draft?.kind ?? (seededSection ? 'visibility' : 'comparison'),
    comparisonOperator: draft?.comparisonOperator ?? '',
    leftField: draft?.leftField ?? '',
    rightField: draft?.rightField ?? '',
    conditionOperator: draft?.conditionOperator ?? '',
    conditionField: draft?.conditionField ?? '',
    conditionValue: draft?.conditionValue ?? '',
    conditionChoices: [...(draft?.conditionChoices ?? [])],
    terminologyReleaseId: draft?.terminologyReleaseId ?? '',
    requiredField: draft?.requiredField ?? '',
    visibilityTarget: draft?.visibilityTarget ?? (seededSection ? 'section' : 'field'),
    sectionTarget: draft?.sectionTarget ?? seededSection ?? '',
    message: initialMessage ?? '',
    severity: initialSeverity ?? 'block',
  }), [draft, initialMessage, initialSeverity, seededSection]);
  const [kind, setKind] = useState<GuidedRuleKind>(initialValues.kind);
  const [comparisonOperator, setComparisonOperator] = useState<ComparisonOperator | ''>(initialValues.comparisonOperator);
  const [leftField, setLeftField] = useState(initialValues.leftField);
  const [rightField, setRightField] = useState(initialValues.rightField);
  const [conditionOperator, setConditionOperator] = useState<ConditionOperator | ''>(initialValues.conditionOperator);
  const [conditionField, setConditionField] = useState(initialValues.conditionField);
  const [conditionValue, setConditionValue] = useState(initialValues.conditionValue);
  const [conditionChoices, setConditionChoices] = useState<string[]>(initialValues.conditionChoices);
  const [terminologyReleaseId, setTerminologyReleaseId] = useState(initialValues.terminologyReleaseId);
  const [requiredField, setRequiredField] = useState(initialValues.requiredField);
  const [visibilityTarget, setVisibilityTarget] = useState<'field' | 'section'>(initialValues.visibilityTarget);
  const [sectionTarget, setSectionTarget] = useState(initialValues.sectionTarget);
  const [message, setMessage] = useState(initialValues.message);
  const [severity, setSeverity] = useState<RuleSeverity>(initialValues.severity);
  const baselineSnapshot = useRef(ruleFormSnapshot(initialValues));
  // L74d (D5) : meme logique pour une regle heritee lue sur deux fiches.
  const inheritedSpace = useMemo(
    () => (initialRule === undefined ? null : ruleSpaceVerdict(initialRule, fields, sections)),
    [initialRule, fields, sections],
  );
  const [error, setError] = useState<string | null>(
    inheritedConflict
      ? `${t(CALCULATED_PROBLEM_KEYS[inheritedConflict.problem])} — ${inheritedConflict.field.label}`
      : inheritedSpace && !inheritedSpace.usable ? t(SPACE_PROBLEM_KEYS[inheritedSpace.problem]) : null,
  );

  const currentSnapshot = useMemo(() => ruleFormSnapshot({
    kind,
    comparisonOperator,
    leftField,
    rightField,
    conditionOperator,
    conditionField,
    conditionValue,
    conditionChoices,
    terminologyReleaseId,
    requiredField,
    visibilityTarget,
    sectionTarget,
    message,
    severity,
  }), [
    kind, comparisonOperator, leftField, rightField, conditionOperator, conditionField,
    conditionValue, conditionChoices, terminologyReleaseId, requiredField, visibilityTarget,
    sectionTarget, message, severity,
  ]);
  const dirty = currentSnapshot !== baselineSnapshot.current;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const fieldsByKey = useMemo(() => new Map(fields.map((field) => [field.fieldKey, field])), [fields]);
  const selectedLeftField = fieldsByKey.get(leftField);
  const selectedConditionField = fieldsByKey.get(conditionField);
  const rootSections = useMemo(
    () => (sections ?? []).filter((section) => !section.parentSectionKey),
    [sections],
  );
  // L74d (D2, D5) : les pilotes proposes dependent de la cible deja choisie. Une variable de
  // groupe ne peut etre pilotee que depuis son groupe, ou depuis la fiche patient pour le seul
  // verbe « afficher » ; un bloc portant un groupe, que depuis la fiche patient. Le pilote deja
  // choisi reste propose : filtrer ne doit jamais effacer une reponse donnee — l'enregistrement,
  // lui, explique le refus.
  const verb = kind === 'visibility' ? 'visible' as const : 'required' as const;
  const targetField = kind !== 'comparison' && !(kind === 'visibility' && visibilityTarget === 'section')
    ? fieldsByKey.get(requiredField) : undefined;
  const targetSection = kind === 'visibility' && visibilityTarget === 'section' && sectionTarget ? sectionTarget : null;
  const driverOptions = useMemo(() => {
    if (!targetField && !targetSection) return enteredFields;
    return enteredFields.filter((candidate) => {
      if (candidate.fieldKey === conditionField) return true;
      const driver = fieldRuleSpace(candidate, sections);
      const verdict = targetSection
        ? blockRuleVerdict(driver, targetSection, sections)
        : fieldRuleVerdict(verb, driver, fieldRuleSpace(targetField!, sections));
      return verdict.usable;
    });
  }, [enteredFields, targetField, targetSection, verb, conditionField, sections]);
  const patientContext = !!targetField && !!selectedConditionField && verb === 'visible'
    && (() => {
      const verdict = fieldRuleVerdict('visible', fieldRuleSpace(selectedConditionField, sections), fieldRuleSpace(targetField, sections));
      return verdict.usable && verdict.patientContext;
    })();
  const labelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const field of fields) counts.set(field.label, (counts.get(field.label) ?? 0) + 1);
    return counts;
  }, [fields]);

  // L30 : la regle compare la valeur STOCKEE, c'est-a-dire le code de l'option. C'est le
  // libelle qui est propose au medecin. Confondre les deux ferait une regle qui ne se
  // declenche jamais, sans erreur visible.
  const conditionOptions = useMemo(() => {
    if (selectedConditionField?.type === 'boolean') return [{ value: 'true' }, { value: 'false' }];
    return listOptionsOf(selectedConditionField).map((o) => ({ value: o.valueKey, label: o.label }));
  }, [selectedConditionField]);
  const conditionOptionLabel = (option: { value: string; label?: string }) =>
    option.value === 'true' ? t('rule.value_true')
      : option.value === 'false' ? t('rule.value_false')
        : option.label ?? option.value;

  // UX-14(b) : deux libelles proches se distinguent par leur section, leur type et leur portee.
  // La cle technique reste reservee aux libelles reellement en doublon.
  function optionLabel(field: TemplateField) {
    const scope = field.scope === 'patient' ? t('rule.scope_patient') : t('rule.scope_encounter');
    const section = sectionLabel(t, {
      sectionKey: field.section,
      label: sections?.find((candidate) => candidate.sectionKey === field.section)?.label ?? field.sectionLabel,
    });
    const technicalKey = (labelCounts.get(field.label) ?? 0) > 1 ? ` — ${field.fieldKey}` : '';
    return `${field.label} — ${section} · ${fieldTypeLabel(t, field.type)} · ${scope}${technicalKey}`;
  }

  /** Etiquettes communes aux quatre selecteurs de variables. */
  const pickerLabels = {
    searchLabel: t('rule.search_variable'),
    chooseLabel: t('rule.choose'),
    emptyLabel: t('rule.search_no_match'),
    countLabel: (shown: number, total: number) =>
      t('rule.search_count').replace('{shown}', String(shown)).replace('{total}', String(total)),
  };

  function guidedJson() {
    if (kind === 'comparison') {
      return JSON.stringify({
        operator: comparisonOperator,
        left_field: leftField,
        right_field: rightField,
      });
    }

    const value = (conditionOperator === 'in' || conditionOperator === 'contains_any')
      ? (conditionOptions.length > 0 ? conditionChoices : conditionValue.split(',').map((item) => item.trim()).filter(Boolean))
        .map((item) => coerceValue(selectedConditionField, item))
      : coerceValue(selectedConditionField, conditionValue);

    return JSON.stringify({
      if: { field: conditionField, operator: conditionOperator, value,
        ...(conditionOperator === 'contains_any' && selectedConditionField?.type === 'terminology'
          ? { terminologyReleaseId } : {}),
      },
      then: kind === 'visibility' && visibilityTarget === 'section'
        ? { section: sectionTarget, operator: 'visible' }
        : { field: requiredField, operator: kind === 'visibility' ? 'visible' : 'required' },
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Le constructeur guide produit le format historique. Le serveur reste la source
    // de verite et revalide la regle lors de l'enregistrement.
    if (conditionOperator === 'contains_any' && kind !== 'comparison'
      && !['select', 'multiselect', 'terminology'].includes(selectedConditionField?.type ?? '')) {
      setError(t('rule.contains_any_driver')); return;
    }
    const res = parseRule(guidedJson());
    if (!res.ok) {
      setError(`${t('admin.rule_invalid')} : ${res.error}`);
      return;
    }
    // Cycle d'affichage : refuse ici pour l'expliquer en clair, refuse a nouveau en base.
    const cycle = findVisibilityCycle([...existingRules.map((r) => r.rule), res.value], fields, sections);
    if (cycle) {
      setError(`${t('rule.cycle')} ${cycle.map((key) => fieldLabel(fields, key)).join(' → ')}`);
      return;
    }
    // Variable calculee a une position ou elle ne peut pas fonctionner. Les listes ne la
    // proposent plus, mais une regle relue depuis la base peut encore en porter une : le
    // filet est ici, avec le meme motif que le refus du serveur.
    const conflict = calculatedOperandConflict(res.value, fields);
    if (conflict) {
      setError(`${t(CALCULATED_PROBLEM_KEYS[conflict.problem])} — ${conflict.field.label}`);
      return;
    }
    // L74d (D5) : une regle lue sur deux fiches ne fonctionnerait jamais. Refusee ici avec son
    // motif ; le serveur la refusera aussi a l'ecriture (L74e).
    const space = ruleSpaceVerdict(res.value, fields, sections);
    if (!space.usable) {
      setError(t(SPACE_PROBLEM_KEYS[space.problem]));
      return;
    }
    setError(null);
    // Une regle d'affichage ne bloque ni n'avertit : sa severite n'a pas de sens et n'est pas
    // demandee. On enregistre la valeur par defaut de la colonne, que l'evaluation ignore.
    // Le constructeur ne vide jamais la saisie avant l'accuse de succes. Les callbacks
    // historiques retournent `void`; ceux qui retournent une promesse peuvent toutefois
    // transmettre l'accuse et permettre de nettoyer le baseline ici.
    try {
      const result = onSubmit(res.value, message, kind === 'visibility' ? 'block' : severity);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        await result;
        baselineSnapshot.current = currentSnapshot;
        onDirtyChange?.(false);
      }
    } catch (submitError) {
      setError(errorMessage(submitError, t('common.error')));
    }
  }



  function conditionValueInput() {
    if (conditionOperator === 'in' || conditionOperator === 'contains_any') {
      if (conditionOptions.length > 0) {
        return (
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs text-slate-600">{t('rule.condition_values')}</legend>
            <div className="flex flex-wrap gap-3">
              {conditionOptions.map((option) => (
                <Checkbox
                    key={option.value}
                    label={conditionOptionLabel(option)}
                    checked={conditionChoices.includes(option.value)}
                    onChange={(e) => setConditionChoices((current) => (
                      e.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value)
                    ))}
                />
              ))}
            </div>
          </fieldset>
        );
      }
      return (
        <label className="flex flex-col text-xs text-slate-600">
          {t('rule.condition_values')}
          <input
            className="input mt-1"
            value={conditionValue}
            placeholder={t('rule.values_hint')}
            onChange={(e) => setConditionValue(e.target.value)}
          />
        </label>
      );
    }

    if (conditionOptions.length > 0) {
      return (
        <label className="flex flex-col text-xs text-slate-600">
          {t('rule.condition_value')}
          <select className="input mt-1" value={conditionValue} onChange={(e) => setConditionValue(e.target.value)}>
            <option value="">{t('rule.choose')}</option>
            {conditionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {conditionOptionLabel(option)}
              </option>
            ))}
          </select>
        </label>
      );
    }

    const inputType = selectedConditionField?.type === 'number' || selectedConditionField?.type === 'integer'
      ? 'number'
      : selectedConditionField?.type === 'date'
        ? 'date'
        : selectedConditionField?.type === 'datetime'
          ? 'datetime-local'
          : selectedConditionField?.type === 'time'
            ? 'time'
            : 'text';
    return (
      <label className="flex flex-col text-xs text-slate-600">
        {t('rule.condition_value')}
        <input className="input mt-1" type={inputType} value={conditionValue} onChange={(e) => setConditionValue(e.target.value)} />
      </label>
    );
  }

  const preview = parseRule(guidedJson());
  const hasConditionValue = (conditionOperator === 'in' || conditionOperator === 'contains_any')
    ? (conditionOptions.length > 0 ? conditionChoices.length > 0 : conditionValue.trim() !== '')
    : conditionValue !== '';
  const isVisibility = kind === 'visibility';
  const canPreview = kind === 'comparison'
    ? comparisonOperator !== '' && leftField !== '' && rightField !== ''
    : conditionOperator !== '' && conditionField !== '' && hasConditionValue
      && (isVisibility && visibilityTarget === 'section' ? sectionTarget !== '' : requiredField !== '');

  return (
    <form onSubmit={submit} className="card space-y-4 p-4">
      <p className="max-w-2xl text-sm text-slate-600">{t('rule.builder_intro')}</p>

      <div className="space-y-3">
          <label className="flex flex-col text-xs text-slate-600">
            {t('rule.kind')}
            <select className="input mt-1" value={kind} onChange={(e) => { setKind(e.target.value as GuidedRuleKind); setError(null); }}>
              <option value="comparison">{t('rule.kind_comparison')}</option>
              <option value="conditional">{t('rule.kind_conditional')}</option>
              <option value="visibility">{t('rule.kind_visibility')}</option>
            </select>
          </label>

          {isVisibility && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {t('rule.visibility_hint')} <HelpDetails>{t('rule.visibility_hint_details')}</HelpDetails>
            </p>
          )}

          {kind === 'comparison' ? (
            <div className="grid gap-3 md:grid-cols-3">
              <FieldSelect {...pickerLabels} label={t('rule.left_field')} value={leftField}
                options={enteredFields} optionLabel={optionLabel} onChange={setLeftField} />
              <label className="flex flex-col text-xs text-slate-600">
                {t('rule.operator')}
                <select className="input mt-1" value={comparisonOperator} onChange={(e) => setComparisonOperator(e.target.value as ComparisonOperator | '')}>
                  <option value="">{t('rule.choose')}</option>
                  {COMPARISON_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>{operatorLabel(t, operator, selectedLeftField)}</option>
                  ))}
                </select>
              </label>
              <FieldSelect {...pickerLabels} label={t('rule.right_field')} value={rightField}
                options={enteredFields} optionLabel={optionLabel} onChange={setRightField} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <FieldSelect
                  {...pickerLabels}
                  label={t('rule.condition_field')}
                  value={conditionField}
                  options={driverOptions}
                  optionLabel={optionLabel}
                  onChange={(next) => { setConditionField(next); setConditionValue(''); setConditionChoices([]); setTerminologyReleaseId(''); }}
                />
                <label className="flex flex-col text-xs text-slate-600">
                  {t('rule.operator')}
                  <select
                    className="input mt-1"
                    value={conditionOperator}
                    onChange={(e) => { setConditionOperator(e.target.value as ConditionOperator | ''); setConditionValue(''); setConditionChoices([]); }}
                  >
                    <option value="">{t('rule.choose')}</option>
                    {CONDITION_OPERATORS.filter((operator) => operator !== 'contains_any'
                      || ['select', 'multiselect', 'terminology'].includes(selectedConditionField?.type ?? '')).map((operator) => (
                      <option key={operator} value={operator}>{operatorLabel(t, operator, selectedConditionField)}</option>
                    ))}
                  </select>
                </label>
              </div>
              {patientContext && (
                <p role="status" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                  {t('rule.context_patient_driver')} <HelpDetails>{t('rule.context_patient_driver_details')}</HelpDetails>
                </p>
              )}
              {conditionOperator === 'contains_any' && selectedConditionField?.type === 'terminology' && (
                <label className="flex flex-col text-xs text-slate-600">
                  {t('rule.terminology_release')}
                  <input className="input mt-1" value={terminologyReleaseId} required
                    placeholder={t('rule.terminology_release_hint')}
                    onChange={(e) => setTerminologyReleaseId(e.target.value)} />
                </label>
              )}
              {conditionValueInput()}
              {isVisibility && rootSections.length > 0 && (
                <label className="flex flex-col text-xs text-slate-600">
                  {t('rule.visibility_target')}
                  <select
                    className="input mt-1"
                    value={visibilityTarget}
                    onChange={(e) => {
                      const next = e.target.value as 'field' | 'section';
                      setVisibilityTarget(next);
                      if (next === 'section') setRequiredField('');
                      else setSectionTarget('');
                    }}
                  >
                    <option value="field">{t('rule.visibility_target_field')}</option>
                    <option value="section">{t('rule.visibility_target_section')}</option>
                  </select>
                </label>
              )}
              {/* Cible de visibilite : un bloc entier, ou une variable. La variable calculee n'a
                  de sens qu'ici — on masque un resultat affiche, il n'y a aucune valeur a saisir
                  ni aucune fiche a refuser. */}
              {isVisibility && visibilityTarget === 'section' ? (
                <label className="flex flex-col text-xs text-slate-600">
                  {t('rule.visible_section')}
                  <select className="input mt-1" value={sectionTarget} onChange={(e) => setSectionTarget(e.target.value)}>
                    <option value="">{t('rule.choose')}</option>
                    {rootSections.map((section) => (
                      <option key={section.id} value={section.sectionKey}>{sectionLabel(t, section)}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <FieldSelect
                  {...pickerLabels}
                  label={isVisibility ? t('rule.visible_field') : t('rule.required_field')}
                  value={requiredField}
                  options={isVisibility ? fields : enteredFields}
                  optionLabel={optionLabel}
                  onChange={setRequiredField}
                />
              )}
            </div>
          )}

          {/* L35 : ces variables sont absentes des listes ci-dessus. Sans cette phrase, elles
              seraient cherchees, puis supposees perdues. */}
          {calculatedLabels.length > 0 && (
            <p role="status" className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {t('rule.calculated_excluded')} <span className="font-medium">{calculatedLabels.join(', ')}</span>{' '}
            <HelpDetails>{t('rule.calculated_excluded_details')}</HelpDetails>
            </p>
          )}

          {canPreview && preview.ok && preview.value && (
            <div className="rounded-lg bg-teal-50 px-3 py-2" aria-live="polite">
              <span className="text-xs font-medium text-teal-800">{t('rule.preview')}</span>
              <p className="text-sm text-teal-900">{ruleSentence(t, preview.value, fields, sections ?? [])}</p>
            </div>
          )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col text-xs text-slate-600">
          {t('admin.message')}
          <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        {!isVisibility && (
          <label className="flex flex-col text-xs text-slate-600">
            {t('admin.severity')}
            <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as RuleSeverity)}>
              <option value="block">{t('severity.block')}</option>
              <option value="warn">{t('severity.warn')}</option>
            </select>
          </label>
        )}
        <button type="submit" disabled={busy} className="btn-primary">
          {submitLabel ?? t('admin.add_rule')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            {t('admin.cancel')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
