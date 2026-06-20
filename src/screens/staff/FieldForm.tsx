import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import type { FieldScope, FieldSection, FieldType, NewField } from '../../data/types';

const SCOPES: FieldScope[] = ['patient', 'encounter'];
const SECTIONS: FieldSection[] = ['clinique', 'biologie', 'paraclinique'];
const TYPES: FieldType[] = ['number', 'integer', 'text', 'date', 'datetime', 'boolean', 'select', 'multiselect'];

const inputCls = 'input';

export function FieldForm({ onSubmit, busy }: { onSubmit: (f: NewField) => void; busy?: boolean }) {
  const { t } = useI18n();
  const [fieldKey, setFieldKey] = useState('');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<FieldScope>('encounter');
  const [section, setSection] = useState<FieldSection>('clinique');
  const [type, setType] = useState<FieldType>('text');
  const [required, setRequired] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!fieldKey.trim() || !label.trim()) return;
    onSubmit({ fieldKey: fieldKey.trim(), label: label.trim(), scope, section, type, required });
    setFieldKey('');
    setLabel('');
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-2 p-4">
      <label className="flex flex-col text-xs text-slate-600">
        {t('admin.field_key')}
        <input className={inputCls} value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} required />
      </label>
      <label className="flex flex-col text-xs text-slate-600">
        {t('admin.label')}
        <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} required />
      </label>
      <label className="flex flex-col text-xs text-slate-600">
        {t('admin.scope')}
        <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value as FieldScope)}>
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
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as FieldType)}>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {ty}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        {t('admin.required')}
      </label>
      <button type="submit" disabled={busy} className="btn-primary">
        {t('admin.add_field')}
      </button>
    </form>
  );
}
