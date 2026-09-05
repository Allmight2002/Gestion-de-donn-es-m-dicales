import { useMemo, useState, type FormEvent } from 'react';
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
import type { RuleSeverity, TemplateField } from '../../data/types';
// Alias : `fieldOptions` designe deja, dans cet ecran, la liste des VARIABLES proposees.
import { fieldOptions as listOptionsOf } from '../../domain/fieldOptions';
import { calculatedOperandConflict, isCalculatedField } from '../../domain/fieldFormula';
import { Checkbox } from '../../components/Checkbox';

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
  return field?.type === 'date' || field?.type === 'datetime';
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

function operatorLabel(
  t: Translate,
  operator: ComparisonOperator | ConditionOperator,
  field: TemplateField | undefined,
) {
  if (operator === 'in') return t('rule.operator.in');
  return t(isDateField(field) ? DATE_OPERATOR_KEYS[operator] : OPERATOR_KEYS[operator]);
}

function fieldLabel(fields: TemplateField[], fieldKey: string) {
  return fields.find((field) => field.fieldKey === fieldKey)?.label ?? fieldKey;
}

function formatRuleValue(t: Translate, value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => formatRuleValue(t, item)).join(', ');
  if (value === true) return t('rule.value_true');
  if (value === false) return t('rule.value_false');
  if (typeof value === 'string') return `« ${value} »`;
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ruleSentence(t: Translate, rule: TemplateRule, fields: TemplateField[]) {
  if ('operator' in rule) {
    const left = fields.find((field) => field.fieldKey === rule.left_field);
    return `${fieldLabel(fields, rule.left_field)} ${operatorLabel(t, rule.operator, left)} ${fieldLabel(fields, rule.right_field)}.`;
  }

  const conditionField = fields.find((field) => field.fieldKey === rule.if.field);
  const verb = rule.then.operator === 'visible' ? t('rule.visible') : t('rule.required');
  return `${t('rule.if')} ${fieldLabel(fields, rule.if.field)} ${operatorLabel(t, rule.if.operator, conditionField)} ${formatRuleValue(t, rule.if.value)}, ${t('rule.then')} ${fieldLabel(fields, rule.then.field)} ${verb}.`;
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
  requiredField: string;
};

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
    conditionValue: Array.isArray(conditionValue) ? '' : inputValue(conditionValue),
    conditionChoices: Array.isArray(conditionValue) ? conditionValue.map(inputValue) : [],
    requiredField: parsed.value.then.field,
  };
}

export function RuleSummary({ rule, fields }: { rule: unknown; fields: TemplateField[] }) {
  const { t } = useI18n();
  const parsed = parseRule(serializeRule(rule));
  // L35 : une regle ENREGISTREE AVANT le garde-fou peut porter une variable calculee la ou
  // celle-ci ne peut pas fonctionner. Sa phrase se lit parfaitement et le controle n'a jamais
  // lieu : sans ce diagnostic, la liste affirmerait une garantie qui n'existe pas.
  const conflict = calculatedOperandConflict(rule, fields);

  if (!parsed.ok || !parsed.value) {
    return <p className="text-xs text-amber-700">{t('rule.unreadable')}</p>;
  }

  return (
    <div className="min-w-0">
      <p className="text-sm text-slate-700">{ruleSentence(t, parsed.value, fields)}</p>
      {conflict && (
        <p className="mt-1 text-xs text-amber-700">
          {t(CALCULATED_PROBLEM_KEYS[conflict.problem])} — {conflict.field.label}
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
  onSubmit,
  busy,
  existingRules = [],
  initialRule,
  initialMessage,
  initialSeverity,
  submitLabel,
  onCancel,
}: {
  fields: TemplateField[];
  onSubmit: (rule: unknown, message: string, severity: RuleSeverity) => void;
  busy?: boolean;
  /** Regles deja enregistrees sur cette version : sert a refuser un cycle d'affichage. */
  existingRules?: readonly { rule: unknown }[];
  /** Règle existante à relire dans le constructeur guidé, sans exposer son JSON. */
  initialRule?: unknown;
  initialMessage?: string | null;
  initialSeverity?: RuleSeverity;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const draft = useMemo(() => (initialRule === undefined ? null : ruleDraftOf(initialRule)), [initialRule]);
  const editing = initialRule !== undefined;

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
  const [kind, setKind] = useState<GuidedRuleKind>(draft?.kind ?? 'comparison');
  const [comparisonOperator, setComparisonOperator] = useState<ComparisonOperator | ''>(draft?.comparisonOperator ?? '');
  const [leftField, setLeftField] = useState(draft?.leftField ?? '');
  const [rightField, setRightField] = useState(draft?.rightField ?? '');
  const [conditionOperator, setConditionOperator] = useState<ConditionOperator | ''>(draft?.conditionOperator ?? '');
  const [conditionField, setConditionField] = useState(draft?.conditionField ?? '');
  const [conditionValue, setConditionValue] = useState(draft?.conditionValue ?? '');
  const [conditionChoices, setConditionChoices] = useState<string[]>(draft?.conditionChoices ?? []);
  const [requiredField, setRequiredField] = useState(draft?.requiredField ?? '');
  const [message, setMessage] = useState(initialMessage ?? '');
  const [severity, setSeverity] = useState<RuleSeverity>(initialSeverity ?? 'block');
  const [error, setError] = useState<string | null>(
    inheritedConflict
      ? `${t(CALCULATED_PROBLEM_KEYS[inheritedConflict.problem])} — ${inheritedConflict.field.label}`
      : null,
  );

  const fieldsByKey = useMemo(() => new Map(fields.map((field) => [field.fieldKey, field])), [fields]);
  const selectedLeftField = fieldsByKey.get(leftField);
  const selectedConditionField = fieldsByKey.get(conditionField);
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

  function optionLabel(field: TemplateField) {
    const scope = field.scope === 'patient' ? t('rule.scope_patient') : t('rule.scope_encounter');
    const technicalKey = (labelCounts.get(field.label) ?? 0) > 1 ? ` — ${field.fieldKey}` : '';
    return `${field.label} — ${scope}${technicalKey}`;
  }

  function resetRuleInputs() {
    setComparisonOperator('');
    setLeftField('');
    setRightField('');
    setConditionOperator('');
    setConditionField('');
    setConditionValue('');
    setConditionChoices([]);
    setRequiredField('');
  }

  function guidedJson() {
    if (kind === 'comparison') {
      return JSON.stringify({
        operator: comparisonOperator,
        left_field: leftField,
        right_field: rightField,
      });
    }

    const value = conditionOperator === 'in'
      ? (conditionOptions.length > 0 ? conditionChoices : conditionValue.split(',').map((item) => item.trim()).filter(Boolean))
        .map((item) => coerceValue(selectedConditionField, item))
      : coerceValue(selectedConditionField, conditionValue);

    return JSON.stringify({
      if: { field: conditionField, operator: conditionOperator, value },
      then: { field: requiredField, operator: kind === 'visibility' ? 'visible' : 'required' },
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    // Le constructeur guide produit le format historique. Le serveur reste la source
    // de verite et revalide la regle lors de l'enregistrement.
    const res = parseRule(guidedJson());
    if (!res.ok) {
      setError(`${t('admin.rule_invalid')} : ${res.error}`);
      return;
    }
    // Cycle d'affichage : refuse ici pour l'expliquer en clair, refuse a nouveau en base.
    const cycle = findVisibilityCycle([...existingRules.map((r) => r.rule), res.value]);
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
    setError(null);
    // Une regle d'affichage ne bloque ni n'avertit : sa severite n'a pas de sens et n'est pas
    // demandee. On enregistre la valeur par defaut de la colonne, que l'evaluation ignore.
    onSubmit(res.value, message, kind === 'visibility' ? 'block' : severity);
    if (!editing) {
      resetRuleInputs();
      setMessage('');
    }
  }

  /** Par defaut, les variables SAISIES seulement : une variable calculee ne se propose que la
   *  ou elle peut fonctionner, et l'appelant le dit explicitement. */
  function fieldOptions(list: TemplateField[] = enteredFields) {
    return list.map((field) => (
      <option key={field.id} value={field.fieldKey}>
        {optionLabel(field)}
      </option>
    ));
  }

  function conditionValueInput() {
    if (conditionOperator === 'in') {
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
          : 'text';
    return (
      <label className="flex flex-col text-xs text-slate-600">
        {t('rule.condition_value')}
        <input className="input mt-1" type={inputType} value={conditionValue} onChange={(e) => setConditionValue(e.target.value)} />
      </label>
    );
  }

  const preview = parseRule(guidedJson());
  const hasConditionValue = conditionOperator === 'in'
    ? (conditionOptions.length > 0 ? conditionChoices.length > 0 : conditionValue.trim() !== '')
    : conditionValue !== '';
  const canPreview = kind === 'comparison'
    ? comparisonOperator !== '' && leftField !== '' && rightField !== ''
    : conditionOperator !== '' && conditionField !== '' && hasConditionValue && requiredField !== '';
  const isVisibility = kind === 'visibility';

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
              {t('rule.visibility_hint')}
            </p>
          )}

          {kind === 'comparison' ? (
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col text-xs text-slate-600">
                {t('rule.left_field')}
                <select className="input mt-1" value={leftField} onChange={(e) => setLeftField(e.target.value)}>
                  <option value="">{t('rule.choose')}</option>
                  {fieldOptions()}
                </select>
              </label>
              <label className="flex flex-col text-xs text-slate-600">
                {t('rule.operator')}
                <select className="input mt-1" value={comparisonOperator} onChange={(e) => setComparisonOperator(e.target.value as ComparisonOperator | '')}>
                  <option value="">{t('rule.choose')}</option>
                  {COMPARISON_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>{operatorLabel(t, operator, selectedLeftField)}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-xs text-slate-600">
                {t('rule.right_field')}
                <select className="input mt-1" value={rightField} onChange={(e) => setRightField(e.target.value)}>
                  <option value="">{t('rule.choose')}</option>
                  {fieldOptions()}
                </select>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col text-xs text-slate-600">
                  {t('rule.condition_field')}
                  <select
                    className="input mt-1"
                    value={conditionField}
                    onChange={(e) => { setConditionField(e.target.value); setConditionValue(''); setConditionChoices([]); }}
                  >
                    <option value="">{t('rule.choose')}</option>
                    {fieldOptions()}
                  </select>
                </label>
                <label className="flex flex-col text-xs text-slate-600">
                  {t('rule.operator')}
                  <select
                    className="input mt-1"
                    value={conditionOperator}
                    onChange={(e) => { setConditionOperator(e.target.value as ConditionOperator | ''); setConditionValue(''); setConditionChoices([]); }}
                  >
                    <option value="">{t('rule.choose')}</option>
                    {CONDITION_OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>{operatorLabel(t, operator, selectedConditionField)}</option>
                    ))}
                  </select>
                </label>
              </div>
              {conditionValueInput()}
              <label className="flex flex-col text-xs text-slate-600">
                {isVisibility ? t('rule.visible_field') : t('rule.required_field')}
                <select className="input mt-1" value={requiredField} onChange={(e) => setRequiredField(e.target.value)}>
                  <option value="">{t('rule.choose')}</option>
                  {/* Seule position ou une variable calculee a un sens : on masque un resultat
                      affiche, il n'y a aucune valeur a saisir ni aucune fiche a refuser. */}
                  {fieldOptions(isVisibility ? fields : enteredFields)}
                </select>
              </label>
            </div>
          )}

          {/* L35 : ces variables sont absentes des listes ci-dessus. Sans cette phrase, elles
              seraient cherchees, puis supposees perdues. */}
          {calculatedLabels.length > 0 && (
            <p role="status" className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {t('rule.calculated_excluded')} <span className="font-medium">{calculatedLabels.join(', ')}</span>
            </p>
          )}

          {canPreview && preview.ok && preview.value && (
            <div className="rounded-lg bg-teal-50 px-3 py-2" aria-live="polite">
              <span className="text-xs font-medium text-teal-800">{t('rule.preview')}</span>
              <p className="text-sm text-teal-900">{ruleSentence(t, preview.value, fields)}</p>
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
