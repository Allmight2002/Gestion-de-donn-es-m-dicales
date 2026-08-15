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
  type TemplateRule,
} from '../../domain/templateRules';
import type { RuleSeverity, TemplateField } from '../../data/types';
// Alias : `fieldOptions` designe deja, dans cet ecran, la liste des VARIABLES proposees.
import { fieldOptions as listOptionsOf } from '../../domain/fieldOptions';
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

export function RuleSummary({ rule, fields }: { rule: unknown; fields: TemplateField[] }) {
  const { t } = useI18n();
  const parsed = parseRule(serializeRule(rule));

  if (!parsed.ok || !parsed.value) {
    return <p className="text-xs text-amber-700">{t('rule.unreadable')}</p>;
  }

  return <p className="min-w-0 text-sm text-slate-700">{ruleSentence(t, parsed.value, fields)}</p>;
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
}: {
  fields: TemplateField[];
  onSubmit: (rule: unknown, message: string, severity: RuleSeverity) => void;
  busy?: boolean;
  /** Regles deja enregistrees sur cette version : sert a refuser un cycle d'affichage. */
  existingRules?: readonly { rule: unknown }[];
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<GuidedRuleKind>('comparison');
  const [comparisonOperator, setComparisonOperator] = useState<ComparisonOperator | ''>('');
  const [leftField, setLeftField] = useState('');
  const [rightField, setRightField] = useState('');
  const [conditionOperator, setConditionOperator] = useState<ConditionOperator | ''>('');
  const [conditionField, setConditionField] = useState('');
  const [conditionValue, setConditionValue] = useState('');
  const [conditionChoices, setConditionChoices] = useState<string[]>([]);
  const [requiredField, setRequiredField] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<RuleSeverity>('block');
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    // Une regle d'affichage ne bloque ni n'avertit : sa severite n'a pas de sens et n'est pas
    // demandee. On enregistre la valeur par defaut de la colonne, que l'evaluation ignore.
    onSubmit(res.value, message, kind === 'visibility' ? 'block' : severity);
    resetRuleInputs();
    setMessage('');
  }

  function fieldOptions() {
    return fields.map((field) => (
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
                  {fieldOptions()}
                </select>
              </label>
            </div>
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
          {t('admin.add_rule')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
