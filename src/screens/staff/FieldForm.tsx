import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { VALUE_SET_LIBRARY, mergeValues, parseAllowedValues } from '../../domain/valueSetLibrary';
import type { FieldScope, FieldSection, FieldType, NewField } from '../../data/types';

const SCOPES: FieldScope[] = ['patient', 'encounter'];
const SECTIONS: FieldSection[] = ['clinique', 'biologie', 'paraclinique'];
const TYPES: FieldType[] = ['number', 'integer', 'text', 'date', 'datetime', 'boolean', 'select', 'multiselect'];
const ENCOUNTER_TYPES = ['consultation', 'hospitalisation', 'suivi', 'autre'] as const;

const inputCls = 'input';

export function FieldForm({
  onSubmit,
  busy,
  initial,
  lockStructural = false,
  submitLabel,
  onCancel,
}: {
  onSubmit: (f: NewField) => void;
  busy?: boolean;
  /** Pre-remplissage en mode edition (null/absent = creation). */
  initial?: NewField | null;
  /** Variable deja utilisee : nom interne / portee / type verrouilles (seul le libelle change). */
  lockStructural?: boolean;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const editing = !!initial;
  const [fieldKey, setFieldKey] = useState(initial?.fieldKey ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [scope, setScope] = useState<FieldScope>(initial?.scope ?? 'encounter');
  const [section, setSection] = useState<FieldSection>(initial?.section ?? 'clinique');
  const [type, setType] = useState<FieldType>(initial?.type ?? 'text');
  const [required, setRequired] = useState(initial?.required ?? false);
  const [encounterTypes, setEncounterTypes] = useState<string[]>(initial?.encounterTypes ?? []);
  // Une valeur par ligne : lisible au-dela de quelques items, et seul format qui autorise
  // une valeur contenant une virgule (cf. parseAllowedValues).
  const [allowedValues, setAllowedValues] = useState((initial?.allowedValues ?? []).join('\n'));
  const [valueSetId, setValueSetId] = useState('');
  const [minValue, setMinValue] = useState(initial?.minValue != null ? String(initial.minValue) : '');
  const [maxValue, setMaxValue] = useState(initial?.maxValue != null ? String(initial.maxValue) : '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [allowMissingCodes, setAllowMissingCodes] = useState(initial?.allowMissingCodes ?? false);

  const isChoice = type === 'select' || type === 'multiselect';
  const isNumber = type === 'number' || type === 'integer';
  const toggleEncType = (x: string) =>
    setEncounterTypes((prev) => (prev.includes(x) ? prev.filter((y) => y !== x) : [...prev, x]));
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
  const parsedValues = parseAllowedValues(allowedValues);

  // Insertion par COPIE : les valeurs sont recopiees dans le champ, jamais referencees.
  // Modifier la bibliotheque plus tard ne peut donc pas changer le sens de donnees deja
  // saisies. Fusion sans doublon pour ne jamais ecraser ce que l'utilisateur a deja tape.
  function insertValueSet() {
    const set = VALUE_SET_LIBRARY.find((s) => s.id === valueSetId);
    if (!set) return;
    setAllowedValues(mergeValues(parsedValues, set.values).join('\n'));
    setValueSetId('');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!fieldKey.trim() || !label.trim()) return;
    const values = parsedValues;
    onSubmit({
      fieldKey: fieldKey.trim(), label: label.trim(), scope, section, type, required,
      // Champ de rencontre uniquement ; liste vide = tous les types (null cote base).
      encounterTypes: scope === 'encounter' && encounterTypes.length > 0 ? encounterTypes : null,
      allowedValues: isChoice && values.length > 0 ? values : null,
      minValue: isNumber ? numOrNull(minValue) : null,
      maxValue: isNumber ? numOrNull(maxValue) : null,
      unit: isNumber && unit.trim() ? unit.trim() : null,
      allowMissingCodes,
    });
    if (!editing) {
      setFieldKey('');
      setLabel('');
      setEncounterTypes([]);
      setAllowedValues('');
      setMinValue('');
      setMaxValue('');
      setUnit('');
      setAllowMissingCodes(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-2 p-4">
      <label className="flex flex-col text-xs text-slate-600">
        {t('admin.field_key')}
        <input
          className={inputCls}
          value={fieldKey}
          onChange={(e) => setFieldKey(e.target.value)}
          disabled={lockStructural}
          required
        />
      </label>
      <label className="flex flex-col text-xs text-slate-600">
        {t('admin.label')}
        <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} required />
      </label>
      <label className="flex flex-col text-xs text-slate-600">
        {t('admin.scope')}
        <select
          className={inputCls}
          value={scope}
          onChange={(e) => setScope(e.target.value as FieldScope)}
          disabled={lockStructural}
        >
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {t(`scope.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-slate-600">
        {t('admin.section')}
        <select className={inputCls} value={section} onChange={(e) => setSection(e.target.value as FieldSection)}>
          {SECTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`section.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-slate-600">
        {t('admin.type')}
        <select
          className={inputCls}
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
          disabled={lockStructural}
        >
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {ty}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" checked={required} disabled={lockStructural} onChange={(e) => setRequired(e.target.checked)} />
        {t('admin.required')}
      </label>

      {isChoice && (
        <div className="flex w-full flex-col gap-2">
          <label className="flex flex-col text-xs text-slate-600">
            {t('admin.allowed_values')}
            <textarea
              className={inputCls}
              rows={4}
              value={allowedValues}
              onChange={(e) => setAllowedValues(e.target.value)}
              disabled={lockStructural}
              placeholder={t('admin.allowed_values_ph')}
            />
          </label>
          <p className="text-xs text-slate-500">{parsedValues.length} {t('admin.values_count')}</p>
          {!lockStructural && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs text-slate-600">
                {t('admin.value_set')}
                <select className={inputCls} value={valueSetId} onChange={(e) => setValueSetId(e.target.value)}>
                  <option value="">{t('admin.value_set_none')}</option>
                  {VALUE_SET_LIBRARY.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.domain} · {s.name} ({s.values.length})
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={insertValueSet} disabled={!valueSetId} className="btn-secondary">
                {t('admin.value_set_insert')}
              </button>
              <p className="text-xs text-slate-500">{t('admin.value_set_hint')}</p>
            </div>
          )}
        </div>
      )}
      {isNumber && (
        <>
          <label className="flex flex-col text-xs text-slate-600">
            {t('admin.min')}
            <input className={inputCls + ' w-24'} type="number" value={minValue} disabled={lockStructural} onChange={(e) => setMinValue(e.target.value)} />
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            {t('admin.max')}
            <input className={inputCls + ' w-24'} type="number" value={maxValue} disabled={lockStructural} onChange={(e) => setMaxValue(e.target.value)} />
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            {t('admin.unit')}
            <input className={inputCls + ' w-24'} value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
        </>
      )}
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" checked={allowMissingCodes} disabled={lockStructural} onChange={(e) => setAllowMissingCodes(e.target.checked)} />
        {t('admin.allow_missing')}
      </label>

      {scope === 'encounter' && (
        <div className="flex w-full flex-col gap-1 text-xs text-slate-600">
          <span>{t('admin.encounter_types')}</span>
          <div className="flex flex-wrap gap-3">
            {ENCOUNTER_TYPES.map((x) => (
              <label key={x} className="flex items-center gap-1">
                <input type="checkbox" checked={encounterTypes.includes(x)} disabled={lockStructural} onChange={() => toggleEncType(x)} />
                {t(`encountertype.${x}`)}
              </label>
            ))}
          </div>
        </div>
      )}
      <button type="submit" disabled={busy} className="btn-primary">
        {submitLabel ?? t('admin.add_field')}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
          {t('admin.cancel')}
        </button>
      )}
      {editing && lockStructural && (
        <p className="w-full text-xs text-amber-700">{t('admin.field_locked_hint')}</p>
      )}
    </form>
  );
}
